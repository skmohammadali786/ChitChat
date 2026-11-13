import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import { Avatar } from "../../components/Avatar";
import { palette, radius, spacing } from "../../theme/tokens";
import { supabase } from "../../lib/supabase";
import {
  addGroupMembers, loadGroupMembers, removeGroupMember, renameGroupConversation,
  transferGroupOwnership, type GroupMember
} from "./groups";
import { lookupProfileByUsername } from "./service";

type Props = {
  conversationId: string;
  initialTitle: string;
  onBack: () => void;
  onLeft: () => void;
  onRenamed: (title: string) => void;
};

export function GroupManagementScreen({ conversationId, initialTitle, onBack, onLeft, onRenamed }: Props) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [newUsername, setNewUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const currentMember = members.find(member => member.user_id === currentUserId);
  const canManage = currentMember?.member_role === "owner" || currentMember?.member_role === "admin";

  const refresh = useCallback(async () => {
    setError("");
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!data.user) throw new Error("Sign in to manage this group.");
      setCurrentUserId(data.user.id);
      const rows = await loadGroupMembers(conversationId);
      setMembers(rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load group members.");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<void>) {
    setError("");
    setWorking(true);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The group update failed.");
    } finally {
      setWorking(false);
    }
  }

  async function saveTitle() {
    const next = title.trim();
    if (next.length < 1 || next.length > 80) {
      setError("Group name must be 1 to 80 characters.");
      return;
    }
    await run(async () => {
      await renameGroupConversation(conversationId, next);
      onRenamed(next);
    });
  }

  async function addMember() {
    const username = newUsername.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      setError("Enter a valid exact username.");
      return;
    }
    await run(async () => {
      const profile = await lookupProfileByUsername(username);
      if (!profile) throw new Error("No discoverable account found.");
      await addGroupMembers(conversationId, [profile.id]);
      setNewUsername("");
    });
  }

  function confirmRemove(member: GroupMember) {
    const isSelf = member.user_id === currentUserId;
    Alert.alert(
      isSelf ? "Leave this group?" : "Remove this member?",
      isSelf ? "You will leave this conversation." : `Remove @${member.username ?? "member"} from this group?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isSelf ? "Leave group" : "Remove",
          style: "destructive",
          onPress: () => {
            if (!isSelf) {
              void run(() => removeGroupMember(conversationId, member.user_id));
              return;
            }
            setWorking(true);
            void removeGroupMember(conversationId, member.user_id)
              .then(onLeft)
              .catch(caught => setError(caught instanceof Error ? caught.message : "Could not leave this group."))
              .finally(() => setWorking(false));
          },
        },
      ],
    );
  }

  function confirmTransfer(member: GroupMember) {
    Alert.alert(
      "Transfer group ownership?",
      `@${member.username ?? member.display_name ?? "This member"} will become the group owner. You will become an admin.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Transfer", onPress: () => void run(() => transferGroupOwnership(conversationId, member.user_id)) },
      ],
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Group details</Text>
          <Text style={styles.subtitle}>{members.length} members</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator color={palette.brand} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Group name</Text>
          <View style={styles.titleRow}>
            <TextInput value={title} onChangeText={setTitle} editable={canManage && !working} maxLength={80} placeholder="Group name" placeholderTextColor={palette.muted} style={styles.titleInput} />
            {canManage ? (
              <Pressable accessibilityRole="button" disabled={working || !title.trim()} onPress={() => void saveTitle()} style={styles.smallButton}>
                <Text style={styles.smallButtonText}>Save</Text>
              </Pressable>
            ) : null}
          </View>

          {canManage ? (
            <>
              <Text style={[styles.label, { marginTop: 22 }]}>Add a member</Text>
              <View style={styles.titleRow}>
                <Text style={styles.at}>@</Text>
                <TextInput value={newUsername} onChangeText={value => setNewUsername(value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} maxLength={20} autoCapitalize="none" autoCorrect={false} placeholder="username" placeholderTextColor={palette.muted} style={styles.titleInput} returnKeyType="done" onSubmitEditing={addMember} />
                <Pressable accessibilityRole="button" disabled={working || newUsername.length < 3} onPress={() => void addMember()} style={[styles.smallButton, (working || newUsername.length < 3) && styles.disabled]}>
                  <Text style={styles.smallButtonText}>Add</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          <Text style={[styles.label, { marginTop: 24, marginBottom: 10 }]}>Members</Text>
          <View style={styles.memberCard}>
            {members.map(member => {
              const self = member.user_id === currentUserId;
              const name = member.display_name || member.username || "ChitChat member";
              const initials = name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
              const canRemove = self || (canManage && member.member_role !== "owner");
              return (
                <View key={member.user_id} style={styles.memberRow}>
                  <Avatar initials={initials || "CH"} color="#D8D1FF" size={42} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.memberName}>{name}{self ? " (you)" : ""}</Text>
                    <Text style={styles.memberUsername}>{member.username ? `@${member.username} · ` : ""}{member.member_role}</Text>
                  </View>
                  {currentMember?.member_role === "owner" && !self && member.member_role !== "owner" ? (
                    <Pressable accessibilityRole="button" onPress={() => confirmTransfer(member)} style={styles.memberAction}>
                      <Text style={styles.transferText}>Make owner</Text>
                    </Pressable>
                  ) : null}
                  {canRemove ? (
                    <Pressable accessibilityRole="button" onPress={() => confirmRemove(member)} style={styles.memberAction}>
                      <Text style={styles.removeText}>{self ? "Leave" : "Remove"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {working ? <ActivityIndicator color={palette.brand} style={{ marginTop: 16 }} /> : null}
          <Text style={styles.footnote}>Only group members can view these details. Encrypted group messages remain disabled until group key rotation and device key distribution are implemented.</Text>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  header: { minHeight: 78, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: 9 },
  back: { width: 38, height: 44, justifyContent: "center" },
  backText: { color: palette.ink, fontSize: 30, lineHeight: 34 },
  heading: { color: palette.ink, fontSize: 18, fontWeight: "800" },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 3 },
  body: { padding: spacing.lg, paddingBottom: 44 },
  label: { color: palette.inkSoft, fontSize: 12, fontWeight: "800", marginBottom: 8 },
  titleRow: { minHeight: 50, flexDirection: "row", alignItems: "center", backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 12 },
  titleInput: { flex: 1, color: palette.ink, fontSize: 13, paddingVertical: 0 },
  at: { color: palette.brand, fontSize: 15, fontWeight: "800", marginRight: 7 },
  smallButton: { minWidth: 54, height: 38, alignItems: "center", justifyContent: "center", backgroundColor: palette.brand, borderRadius: radius.sm, paddingHorizontal: 10 },
  smallButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  memberCard: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, paddingHorizontal: 12 },
  memberRow: { minHeight: 66, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.line },
  memberName: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  memberUsername: { color: palette.muted, fontSize: 10, marginTop: 3 },
  memberAction: { paddingHorizontal: 7, paddingVertical: 9 },
  removeText: { color: "#B42318", fontSize: 10, fontWeight: "800" },
  transferText: { color: palette.brand, fontSize: 10, fontWeight: "800" },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: 14 },
  footnote: { color: palette.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 18, paddingHorizontal: 8 },
});
