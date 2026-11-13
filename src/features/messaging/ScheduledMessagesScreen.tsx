import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { palette, radius, spacing } from "../../theme/tokens";
import { cancelScheduledMessage, loadScheduledMessages, type ScheduledMessage } from "./scheduledMessages";

type Props = {
  onBack: () => void;
  dark: boolean;
  accentColor: string;
};

export function ScheduledMessagesScreen({ onBack, dark, accentColor }: Props) {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const background = dark ? palette.darkBg : palette.paper;
  const surface = dark ? palette.darkSurface : palette.white;
  const textColor = dark ? palette.darkText : palette.ink;
  const muted = dark ? palette.darkMuted : palette.muted;
  const line = dark ? palette.darkLine : palette.line;

  const refresh = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const records = await loadScheduledMessages();
      setItems(records);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load scheduled messages.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function confirmCancel(item: ScheduledMessage) {
    Alert.alert(
      "Cancel scheduled message?",
      "This removes the pending encrypted envelope. It cannot be undone.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel message",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusyId(item.id);
              setError("");
              try {
                await cancelScheduledMessage(item.id);
                setItems(current => current.filter(entry => entry.id !== item.id));
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not cancel this message.");
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <View style={[styles.header, { borderBottomColor: line }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
          <Text style={{ color: textColor, fontSize: 29 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: textColor }]}>Scheduled messages</Text>
          <Text style={[styles.subtitle, { color: muted }]}>Messages waiting for their send time.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh scheduled messages" onPress={() => void refresh(true)} disabled={refreshing} style={styles.refresh}>
          <Text style={{ color: accentColor, fontSize: 12, fontWeight: "800" }}>{refreshing ? "…" : "Refresh"}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={accentColor} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyTitle, { color: textColor }]}>Nothing scheduled</Text>
              <Text style={[styles.emptyText, { color: muted }]}>Your pending scheduled messages will appear here. Creating a scheduled message will become available when the secure message composer is enabled.</Text>
            </View>
          }
          ListHeaderComponent={error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: surface, borderColor: line }]}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: textColor }]}>Encrypted message envelope</Text>
                  <Text style={[styles.meta, { color: muted }]}>Conversation · {item.conversation_id.slice(0, 8)}</Text>
                </View>
                <View style={[styles.status, { backgroundColor: dark ? "#283A33" : "#EAF6EF" }]}>
                  <Text style={{ color: dark ? "#9DE0BC" : "#28734E", fontSize: 10, fontWeight: "800" }}>PENDING</Text>
                </View>
              </View>
              <Text style={[styles.date, { color: textColor }]}>{new Date(item.send_at).toLocaleString()}</Text>
              <View style={styles.cardBottom}>
                <Text style={[styles.meta, { color: muted }]}>Created {new Date(item.created_at).toLocaleDateString()}</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={busyId === item.id}
                  onPress={() => confirmCancel(item)}
                  style={[styles.cancel, { borderColor: line }, busyId === item.id && { opacity: 0.5 }]}
                >
                  {busyId === item.id
                    ? <ActivityIndicator size="small" color={accentColor} />
                    : <Text style={{ color: accentColor, fontSize: 11, fontWeight: "800" }}>Cancel</Text>}
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 78, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, gap: 8 },
  back: { width: 34, height: 44, justifyContent: "center" },
  refresh: { padding: 10 },
  title: { fontSize: 18, fontWeight: "800" },
  subtitle: { fontSize: 11, marginTop: 3 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  emptyList: { flexGrow: 1, padding: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: 17, fontWeight: "800", textAlign: "center" },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8, maxWidth: 320 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginBottom: spacing.md },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  cardTitle: { fontSize: 13, fontWeight: "800" },
  meta: { fontSize: 10, marginTop: 4 },
  status: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  date: { fontSize: 14, fontWeight: "700", marginTop: spacing.lg },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  cancel: { minWidth: 78, minHeight: 34, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
