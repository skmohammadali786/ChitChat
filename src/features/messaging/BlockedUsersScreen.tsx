import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import { Avatar } from "../../components/Avatar";
import { palette, radius, spacing } from "../../theme/tokens";
import { loadBlockedUsers, unblockUser, type BlockedProfile } from "./service";

type Props = { onBack: () => void };

export function BlockedUsersScreen({ onBack }: Props) {
  const [items, setItems] = useState<BlockedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const records = await loadBlockedUsers();
      setItems(records);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your block list.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function unblock(id: string) {
    setBusyId(id);
    setError("");
    try {
      await unblockUser(id);
      setItems(old => old.filter(item => item.blocked_id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unblock this account.");
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
          <Text style={styles.title}>Blocked accounts</Text>
          <Text style={styles.subtitle}>People you have chosen not to hear from.</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={palette.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {items.length === 0 && !error ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>Your block list is clear.</Text>
              <Text style={styles.emptyText}>Accounts you block will appear here. You can unblock them at any time.</Text>
            </View>
          ) : null}
          {items.map(item => {
            const displayName = item.display_name || item.username || "ChitChat member";
            const initials = displayName.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "CH";
            return (
              <View key={item.blocked_id} style={styles.row}>
                <Avatar initials={initials} color="#D8D1FF" size={46} />
                <View style={styles.copy}>
                  <Text style={styles.name}>{displayName}</Text>
                  <Text style={styles.username}>{item.username ? `@${item.username}` : "Username unavailable"}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={busyId === item.blocked_id}
                  onPress={() => { void unblock(item.blocked_id); }}
                  style={[styles.unblock, busyId === item.blocked_id && { opacity: 0.55 }]}
                >
                  {busyId === item.blocked_id
                    ? <ActivityIndicator size="small" color={palette.brand} />
                    : <Text style={styles.unblockText}>Unblock</Text>}
                </Pressable>
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
  backText: { color: palette.ink, fontSize: 30, lineHeight: 34 },
  title: { color: palette.ink, fontSize: 18, fontWeight: "800" },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 3 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  row: { minHeight: 76, borderBottomWidth: 1, borderBottomColor: palette.line, flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1 },
  name: { color: palette.ink, fontWeight: "700", fontSize: 14 },
  username: { color: palette.muted, fontSize: 11, marginTop: 4 },
  unblock: { minWidth: 70, minHeight: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderWidth: 1, borderColor: "#DAD2FF", backgroundColor: "#F4F1FF" },
  unblockText: { color: palette.brand, fontSize: 11, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  emptyTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  emptyText: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7, maxWidth: 280 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, paddingVertical: spacing.md }
});
