import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import { Avatar } from "../../components/Avatar";
import { palette, radius, spacing } from "../../theme/tokens";
import {
  loadMyGroupInvitations,
  respondToGroupInvitation,
  type MyGroupInvitation,
} from "./groups";

type Props = {
  onBack: () => void;
  onAccepted: (conversationId: string, title: string) => void;
};

export function GroupInvitationsScreen({ onBack, onAccepted }: Props) {
  const [items, setItems] = useState<MyGroupInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setItems(await loadMyGroupInvitations());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load group invitations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function respond(item: MyGroupInvitation, accept: boolean) {
    if (busyId) return;
    setBusyId(item.invitation_id);
    setError("");
    try {
      const result = await respondToGroupInvitation(item.invitation_id, accept);
      setItems(current => current.filter(entry => entry.invitation_id !== item.invitation_id));
      if (result === "expired") {
        setError("That invitation has expired. Ask a group admin to send a new one.");
      } else if (result === "accepted") {
        onAccepted(item.conversation_id, item.conversation_title?.trim() || "Group conversation");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this invitation.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Group invitations</Text>
          <Text style={styles.subtitle}>Review invitations before joining a group.</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void refresh()} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={palette.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {items.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No pending invitations</Text>
              <Text style={styles.emptyText}>New group invitations will appear here.</Text>
            </View>
          ) : items.map(item => {
            const title = item.conversation_title?.trim() || "Group conversation";
            const inviter = item.inviter_display_name || item.inviter_username || "A ChitChat member";
            const initials = title.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "GR";
            const busy = busyId === item.invitation_id;
            return (
              <View key={item.invitation_id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Avatar initials={initials} color="#D8D1FF" size={48} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.groupName}>{title}</Text>
                    <Text style={styles.inviter}>Invited by {inviter}{item.inviter_username ? ` · @${item.inviter_username}` : ""}</Text>
                    <Text style={styles.expires}>Expires {new Date(item.expires_at).toLocaleString()}</Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void respond(item, false)} style={styles.decline}>
                    <Text style={styles.declineText}>Decline</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void respond(item, true)} style={styles.accept}>
                    {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.acceptText}>Accept invitation</Text>}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  header: { minHeight: 78, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: 9 },
  back: { width: 38, height: 44, justifyContent: "center" },
  backText: { color: palette.ink, fontSize: 30 },
  title: { color: palette.ink, fontSize: 18, fontWeight: "800" },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 3 },
  refresh: { padding: 10 },
  refreshText: { color: palette.brand, fontSize: 11, fontWeight: "800" },
  list: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  emptyTitle: { color: palette.ink, fontSize: 16, fontWeight: "800", textAlign: "center" },
  emptyText: { color: palette.muted, fontSize: 12, marginTop: 7, textAlign: "center" },
  card: { backgroundColor: palette.white, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, padding: spacing.lg },
  cardTop: { flexDirection: "row", alignItems: "center" },
  groupName: { color: palette.ink, fontSize: 14, fontWeight: "800" },
  inviter: { color: palette.inkSoft, fontSize: 11, marginTop: 5 },
  expires: { color: palette.muted, fontSize: 10, marginTop: 4 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  decline: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: palette.line },
  declineText: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  accept: { flex: 1.3, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: palette.brand },
  acceptText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18 },
});
