import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import { palette, radius, spacing } from "../../theme/tokens";
import { chitchatCore } from "../../native/chitchatCore";
import {
  endCallSession,
  listMyCallSessions,
  respondToCallSession,
  subscribeToCallInbox,
  subscribeToCallSignals,
  type CallSession,
} from "./calls";

type ConversationOption = {
  conversationId: string;
  peerUserId: string;
  label: string;
};

type Props = {
  userId: string | null;
  conversations: ConversationOption[];
  highlightCallId?: string | null;
};

function statusLabel(call: CallSession, userId: string | null): string {
  if (call.status === "ringing") return call.callee_id === userId ? "Incoming call" : "Calling";
  if (call.status === "accepted") return "Accepted, media connection unavailable";
  if (call.status === "missed") return "Missed";
  if (call.status === "rejected") return "Declined";
  if (call.status === "cancelled") return "Cancelled";
  if (call.status === "expired") return "Expired";
  return "Ended";
}

export function CallsScreen({ userId, conversations, highlightCallId = null }: Props) {
  const [calls, setCalls] = useState<CallSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("CLOSED");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setCalls(await listMyCallSessions());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load call history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    return subscribeToCallInbox(userId, () => {
      void refresh();
      setNotice("Incoming call request received. Voice and video media are not available in this build yet.");
    }, setRealtimeStatus);
  }, [refresh, userId]);

  useEffect(() => {
    if (highlightCallId) setNotice("Opened from an incoming-call notification. Check the call status below.");
  }, [highlightCallId]);

  useEffect(() => {
    const activeCalls = calls.filter(call => call.status === "ringing" || call.status === "accepted");
    const subscriptions = activeCalls.map(call =>
      subscribeToCallSignals(call.id, event => {
        if (event === "call-state") void refresh();
      }),
    );
    return () => subscriptions.forEach(unsubscribe => unsubscribe());
  }, [calls, refresh]);

  const labelsByConversation = useMemo(
    () => new Map(conversations.map(item => [item.conversationId, item])),
    [conversations],
  );

  async function decline(callId: string) {
    setBusyId(callId);
    setError("");
    setNotice("");
    try {
      await respondToCallSession(callId, false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not decline this call.");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(callId: string) {
    setBusyId(callId);
    setError("");
    try {
      await endCallSession(callId, "caller_cancelled");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel this call.");
    } finally {
      setBusyId(null);
    }
  }

  const incoming = calls.filter(call => call.callee_id === userId && call.status === "ringing");
  const recent = calls.filter(call => !incoming.includes(call));

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Calls</Text>
          <Text style={styles.subtitle}>Private call requests and recent activity.</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void refresh()} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.info}>
          <Text style={styles.infoTitle}>Media engine not linked</Text>
          <Text style={styles.infoCopy}>Authenticated call sessions, private signaling, and a short-lived TURN credential endpoint are available. The coturn server secrets are not configured, and the native WebRTC microphone, camera, and peer-connection runtime is not linked. Calls cannot connect until both are configured and tested.</Text>
          <Text style={styles.statusMeta}>Realtime inbox: {realtimeStatus}</Text>
        </View>

        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        <Text style={styles.section}>Incoming calls</Text>
        {loading ? <ActivityIndicator color={palette.brand} style={{ marginTop: 20 }} /> : incoming.length === 0 ? (
          <Text style={styles.emptyText}>No incoming calls.</Text>
        ) : incoming.map(call => {
          const conversation = labelsByConversation.get(call.conversation_id);
          const label = conversation?.label ?? "ChitChat contact";
          return (
            <View key={call.id} style={[styles.card, call.id === highlightCallId && styles.highlighted]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{label}</Text>
                <Text style={styles.cardMeta}>{call.call_type === "video" ? "Video" : "Audio"} request · {new Date(call.created_at).toLocaleString()}</Text>
              </View>
              <Pressable accessibilityRole="button" disabled={busyId === call.id} onPress={() => void decline(call.id)} style={styles.decline}>
                {busyId === call.id ? <ActivityIndicator color="#B42318" size="small" /> : <Text style={styles.declineText}>Decline</Text>}
              </Pressable>
              <Text style={styles.notReady}>Accept requires the WebRTC engine</Text>
            </View>
          );
        })}

        <Text style={styles.section}>Recent calls</Text>
        {recent.length === 0 && !loading ? <Text style={styles.emptyText}>Your recent calls will appear here.</Text> : recent.map(call => {
          const conversation = labelsByConversation.get(call.conversation_id);
          const label = conversation?.label ?? "ChitChat contact";
          const outgoing = call.caller_id === userId;
          return (
            <View key={call.id} style={[styles.card, call.id === highlightCallId && styles.highlighted]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{label}</Text>
                <Text style={styles.cardMeta}>{outgoing ? "Outgoing" : "Incoming"} · {call.call_type === "video" ? "Video" : "Audio"} · {new Date(call.created_at).toLocaleDateString()}</Text>
                <Text style={styles.cardStatus}>{statusLabel(call, userId)}</Text>
              </View>
              {call.status === "ringing" && outgoing ? (
                <Pressable accessibilityRole="button" disabled={busyId === call.id} onPress={() => void cancel(call.id)} style={styles.decline}>
                  {busyId === call.id ? <ActivityIndicator color="#B42318" size="small" /> : <Text style={styles.declineText}>Cancel</Text>}
                </Pressable>
              ) : null}
            </View>
          );
        })}

        <Text style={styles.section}>Start a call</Text>
        {conversations.length === 0 ? (
          <Text style={styles.emptyText}>Create a direct conversation before starting a call.</Text>
        ) : conversations.map(conversation => (
          <View key={conversation.conversationId} style={styles.conversationRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{conversation.label}</Text>
              <Text style={styles.cardMeta}>Direct conversation</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={!chitchatCore.webrtcAvailable}
              onPress={() => setNotice("The WebRTC engine must be linked before starting calls. No call request was sent.")}
              style={[styles.disabledCall, !chitchatCore.webrtcAvailable && styles.disabled]}
            >
              <Text style={styles.disabledCallText}>Audio</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!chitchatCore.webrtcAvailable}
              onPress={() => setNotice("The WebRTC engine must be linked before starting calls. No call request was sent.")}
              style={[styles.disabledCall, !chitchatCore.webrtcAvailable && styles.disabled]}
            >
              <Text style={styles.disabledCallText}>Video</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  header: { minHeight: 74, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: palette.ink, fontSize: 19, fontWeight: "900" },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 2 },
  refresh: { padding: 10 },
  refreshText: { color: palette.brand, fontSize: 11, fontWeight: "800" },
  body: { padding: spacing.lg, paddingBottom: 120 },
  info: { padding: spacing.lg, backgroundColor: "#FFF5DE", borderRadius: radius.lg, marginBottom: spacing.lg },
  infoTitle: { color: "#8D5A00", fontSize: 13, fontWeight: "900" },
  infoCopy: { color: "#725C38", fontSize: 11, lineHeight: 17, marginTop: 6 },
  statusMeta: { color: "#8D5A00", fontSize: 10, fontWeight: "800", marginTop: 8 },
  notice: { color: "#167A55", fontSize: 11, lineHeight: 16, marginBottom: spacing.md },
  error: { color: "#B42318", fontSize: 11, lineHeight: 16, marginBottom: spacing.md },
  section: { color: palette.ink, fontSize: 13, fontWeight: "900", marginTop: spacing.lg, marginBottom: spacing.sm },
  emptyText: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  card: { backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  highlighted: { borderColor: palette.brand, borderWidth: 2 },
  cardTitle: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  cardMeta: { color: palette.muted, fontSize: 10, marginTop: 3 },
  cardStatus: { color: palette.brand, fontSize: 10, fontWeight: "800", marginTop: 5 },
  decline: { minWidth: 68, minHeight: 38, borderWidth: 1, borderColor: "#E7B7B7", borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  declineText: { color: "#B42318", fontSize: 10, fontWeight: "800" },
  notReady: { width: "100%", color: palette.muted, fontSize: 10 },
  conversationRow: { minHeight: 66, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.line, gap: 8 },
  disabledCall: { borderRadius: radius.sm, backgroundColor: palette.brandSoft, minWidth: 52, minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  disabledCallText: { color: palette.brand, fontSize: 10, fontWeight: "900" },
  disabled: { opacity: 0.4 },
});
