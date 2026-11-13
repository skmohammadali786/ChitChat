import { supabase } from "../../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type CallKind = "audio" | "video";
export type CallStatus = "ringing" | "accepted" | "rejected" | "cancelled" | "ended" | "missed" | "expired";

export type CallSession = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  call_type: CallKind;
  status: CallStatus;
  created_at: string;
  expires_at: string;
  answered_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
};

export type CallInboxEvent = {
  call_id: string;
  conversation_id: string;
  call_type: CallKind;
  created_at: string;
};

export type CallSignalEvent = "offer" | "answer" | "ice-candidate" | "hangup" | "call-state";

function client() {
  if (!supabase) throw new Error("ChitChat Supabase is not configured.");
  return supabase;
}

async function waitUntilSubscribed(channel: RealtimeChannel): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Realtime call channel subscription timed out."));
    }, 12_000);

    channel.subscribe(status => {
      if (settled) return;
      if (status === "SUBSCRIBED") {
        settled = true;
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Realtime call channel failed: ${status}.`));
      }
    });
  });
}

async function sendInboxEvent(calleeId: string, payload: CallInboxEvent): Promise<void> {
  const supabaseClient = client();
  const channel = supabaseClient.channel(`user-calls:${calleeId}`, {
    config: { private: true, broadcast: { self: false } },
  });
  try {
    await supabaseClient.realtime.setAuth();
    await waitUntilSubscribed(channel);
    const result = await channel.send({ type: "broadcast", event: "incoming-call", payload });
    if (result !== "ok") throw new Error("The incoming call alert could not be delivered.");
  } finally {
    await supabaseClient.removeChannel(channel);
  }
}

export async function createCallSession(
  conversationId: string,
  calleeId: string,
  callType: CallKind,
): Promise<string> {
  if (!conversationId || !calleeId) throw new Error("A direct conversation and recipient are required.");
  if (callType !== "audio" && callType !== "video") throw new Error("Unsupported call type.");
  const { data, error } = await client().rpc("create_call_session", {
    target_conversation_id: conversationId,
    target_callee_id: calleeId,
    requested_call_type: callType,
  });
  if (error) throw error;
  if (typeof data !== "string" || !data) throw new Error("Supabase returned an invalid call ID.");

  try {
    await sendInboxEvent(calleeId, {
      call_id: data,
      conversation_id: conversationId,
      call_type: callType,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    try {
      await client().rpc("end_call_session", {
        target_call_id: data,
        requested_reason: "ring_delivery_failed",
      });
    } catch {
      // The server-side 45-second expiry marks undelivered calls as missed.
    }
    throw error;
  }
  // Realtime handles foreground devices. This generic push wakes devices
  // whose app is backgrounded or terminated. Push failure must not cancel
  // an otherwise valid ringing session.
  void client().functions.invoke("notify-call", {
    body: { call_id: data },
  }).then(({ error: pushError }) => {
    if (pushError) console.warn("ChitChat incoming-call notification failed.", pushError.message);
  }).catch(error => {
    console.warn("ChitChat incoming-call notification request failed.", error);
  });

  return data;
}

export async function listMyCallSessions(): Promise<CallSession[]> {
  const { data, error } = await client().rpc("list_my_call_sessions");
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CallSession[];
}

export async function respondToCallSession(
  callId: string,
  accept: boolean,
): Promise<"accepted" | "rejected" | "missed"> {
  if (!callId) throw new Error("Choose an incoming call.");
  const { data, error } = await client().rpc("respond_call_session", {
    target_call_id: callId,
    accept_call: accept,
  });
  if (error) throw error;
  if (data !== "accepted" && data !== "rejected" && data !== "missed") {
    throw new Error("Supabase returned an invalid call response.");
  }
  return data;
}

export async function endCallSession(callId: string, reason = "hangup"): Promise<void> {
  if (!callId) throw new Error("Choose an active call.");
  if (!/^[a-z0-9_]{1,80}$/.test(reason)) throw new Error("Invalid call end reason.");
  const { error } = await client().rpc("end_call_session", {
    target_call_id: callId,
    requested_reason: reason,
  });
  if (error) throw error;
}

export function subscribeToCallInbox(
  userId: string,
  onIncoming: (event: CallInboxEvent) => void,
  onState: (status: string) => void = () => undefined,
): () => void {
  const supabaseClient = client();
  if (!userId) throw new Error("A signed-in user is required for call notifications.");
  let stopped = false;
  const channel = supabaseClient
    .channel(`user-calls:${userId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    .on("broadcast", { event: "incoming-call" }, ({ payload }) => {
      if (stopped || !payload || typeof payload !== "object") return;
      const value = payload as Partial<CallInboxEvent>;
      if (
        typeof value.call_id === "string" &&
        typeof value.conversation_id === "string" &&
        (value.call_type === "audio" || value.call_type === "video") &&
        typeof value.created_at === "string"
      ) {
        onIncoming(value as CallInboxEvent);
      }
    });

  void supabaseClient.realtime.setAuth().then(() => {
    if (!stopped) channel.subscribe(status => {
      if (!stopped) onState(status);
    });
  }).catch(() => onState("CHANNEL_ERROR"));

  return () => {
    stopped = true;
    void supabaseClient.removeChannel(channel);
  };
}

export function subscribeToCallSignals(
  callId: string,
  onSignal: (event: CallSignalEvent, payload: unknown) => void,
  onState: (status: string) => void = () => undefined,
): () => void {
  const supabaseClient = client();
  if (!callId) throw new Error("A call ID is required.");
  let stopped = false;
  const channel = supabaseClient
    .channel(`call:${callId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    .on("broadcast", { event: "offer" }, ({ payload }) => { if (!stopped) onSignal("offer", payload); })
    .on("broadcast", { event: "answer" }, ({ payload }) => { if (!stopped) onSignal("answer", payload); })
    .on("broadcast", { event: "ice-candidate" }, ({ payload }) => { if (!stopped) onSignal("ice-candidate", payload); })
    .on("broadcast", { event: "hangup" }, ({ payload }) => { if (!stopped) onSignal("hangup", payload); })
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "call_sessions",
        filter: `id=eq.${callId}`,
      },
      payload => { if (!stopped) onSignal("call-state", payload.new); },
    );

  void supabaseClient.realtime.setAuth().then(() => {
    if (!stopped) channel.subscribe(status => {
      if (!stopped) onState(status);
    });
  }).catch(() => onState("CHANNEL_ERROR"));

  return () => {
    stopped = true;
    void supabaseClient.removeChannel(channel);
  };
}

/**
 * Broadcast transient SDP/ICE data through the participant-authorized call
 * topic. Never write session descriptions or candidates to Postgres, logs,
 * notifications, or analytics.
 */
export async function sendCallSignal(
  callId: string,
  event: CallSignalEvent,
  payload: unknown,
): Promise<void> {
  if (!callId) throw new Error("A call ID is required.");
  if (!["offer", "answer", "ice-candidate", "hangup"].includes(event) || event === "call-state") {
    throw new Error("Unsupported call signaling event.");
  }
  const encoded = JSON.stringify(payload);
  if (encoded.length < 2 || encoded.length > 64_000) {
    throw new Error("Call signaling payload is empty or too large.");
  }

  const supabaseClient = client();
  const channel = supabaseClient.channel(`call:${callId}`, {
    config: { private: true, broadcast: { self: false },
    },
  });
  try {
    await supabaseClient.realtime.setAuth();
    await waitUntilSubscribed(channel);
    const result = await channel.send({ type: "broadcast", event, payload });
    if (result !== "ok") throw new Error("Call signaling data could not be delivered.");
  } finally {
    await supabaseClient.removeChannel(channel);
  }
}
