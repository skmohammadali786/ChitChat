import { supabase } from "../../lib/supabase";

export type PresenceMember = {
  user_id: string;
  online: boolean;
  typing: boolean;
  last_active_at?: string;
};

export type PresencePrivacy = {
  showOnlineStatus: boolean;
  showTypingStatus: boolean;
  showLastSeen: boolean;
};

export function subscribeToConversationPresence(
  conversationId: string,
  userId: string,
  onPresence: (members: Record<string, PresenceMember[]>) => void,
  onTyping: (payload: { userId: string; typing: boolean }) => void,
  privacy: PresencePrivacy = {
    showOnlineStatus: true,
    showTypingStatus: true,
    showLastSeen: true,
  },
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const channel = supabase.channel(`conversation:${conversationId}`, {
    config: { private: true, presence: { key: userId }, broadcast: { self: false } },
  });

  if (privacy.showOnlineStatus) {
    channel.on("presence", { event: "sync" }, () => {
      if (!stopped) onPresence(channel.presenceState() as Record<string, PresenceMember[]>);
    });
  }
  if (privacy.showTypingStatus) {
    channel.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (stopped) return;
      const value = payload as { userId?: string; typing?: boolean };
      if (value.userId && typeof value.typing === "boolean" && value.userId !== userId) {
        onTyping({ userId: value.userId, typing: value.typing });
      }
    });
  }

  let stopped = false;
  let readyResolved = false;
  let resolveReady!: (ready: boolean) => void;
  const subscriptionReady = new Promise<boolean>(resolve => { resolveReady = resolve; });
  const finishReady = (ready: boolean) => {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady(ready);
  };

  void supabase.realtime.setAuth().then(() => {
    if (stopped) {
      finishReady(false);
      return;
    }
    channel.subscribe(status => {
      if (status === "SUBSCRIBED" && !stopped) {
        finishReady(true);
        if (privacy.showOnlineStatus) {
          const state: PresenceMember = {
            user_id: userId,
            online: true,
            typing: false,
            ...(privacy.showLastSeen ? { last_active_at: new Date().toISOString() } : {}),
          };
          void channel.track(state);
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        finishReady(false);
      }
    });
  }).catch(() => finishReady(false));

  return {
    async setTyping(typing: boolean) {
      if (!privacy.showTypingStatus || stopped) return;
      const ready = await subscriptionReady;
      if (!ready || stopped) return;
      const result = await channel.send({
        type: "broadcast",
        event: "typing",
        payload: { userId, typing },
      });
      if (result !== "ok" || stopped) return;
      if (privacy.showOnlineStatus) {
        const state: PresenceMember = {
          user_id: userId,
          online: true,
          typing,
          ...(privacy.showLastSeen ? { last_active_at: new Date().toISOString() } : {}),
        };
        await channel.track(state);
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      finishReady(false);
      if (privacy.showOnlineStatus) await channel.untrack().catch(() => undefined);
      await supabase?.removeChannel(channel);
    },
  };
}
