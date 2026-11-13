import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import { Avatar } from "../../components/Avatar";
import { palette, radius, spacing } from "../../theme/tokens";
import { createGroupConversation } from "./groups";
import { lookupProfileByUsername, type DiscoverableProfile } from "./service";

type Props = {
  onBack: () => void;
  onCreated: (conversationId: string, title: string) => void;
};

export function GroupCreationScreen({ onBack, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [members, setMembers] = useState<DiscoverableProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function addMember() {
    setError("");
    setNotice("");
    const normalized = username.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      setError("Enter an exact username with 3 to 20 letters, numbers, or underscores.");
      return;
    }
    if (members.some(member => member.username === normalized)) {
      setError("That person is already in this group.");
      return;
    }
    setSearching(true);
    try {
      const profile = await lookupProfileByUsername(normalized);
      if (!profile) {
        setError("No discoverable account found for that username.");
      } else {
        setMembers(current => [...current, profile]);
        setUsername("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not find that account.");
    } finally {
      setSearching(false);
    }
  }

  async function create() {
    setError("");
    const cleanTitle = title.trim();
    if (cleanTitle.length < 1 || cleanTitle.length > 80) {
      setError("Group name must be 1 to 80 characters.");
      return;
    }
    if (members.length < 1) {
      setError("Add at least one other person.");
      return;
    }
    setCreating(true);
    try {
      const conversationId = await createGroupConversation(cleanTitle, members.map(member => member.id));
      onCreated(conversationId, cleanTitle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the group.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Create a group</Text>
          <Text style={styles.subtitle}>Add people by their exact ChitChat username.</Text>
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text style={styles.label}>Group name</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Weekend plans"
          placeholderTextColor={palette.muted}
          maxLength={80}
          style={styles.field}
        />

        <Text style={[styles.label, { marginTop: 20 }]}>Add members</Text>
        <View style={styles.searchRow}>
          <Text style={styles.at}>@</Text>
          <TextInput
            value={username}
            onChangeText={value => setUsername(value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
            placeholder="username"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            returnKeyType="done"
            onSubmitEditing={addMember}
            style={styles.searchInput}
          />
          <Pressable accessibilityRole="button" disabled={searching || username.length < 3} onPress={addMember} style={[styles.addButton, (searching || username.length < 3) && styles.disabled]}>
            {searching ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.addText}>Add</Text>}
          </Pressable>
        </View>
        <Text style={styles.helper}>Only profiles with username discovery enabled can be added.</Text>

        {members.length ? (
          <View style={styles.memberCard}>
            {members.map(member => (
              <View key={member.id} style={styles.memberRow}>
                <Avatar initials={member.display_name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase()} color="#D8D1FF" size={42} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.memberName}>{member.display_name}</Text>
                  <Text style={styles.memberUsername}>@{member.username}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${member.username}`} onPress={() => setMembers(current => current.filter(item => item.id !== member.id))} style={styles.remove}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No members added yet</Text>
            <Text style={styles.helper}>A group needs at least two people, including you.</Text>
          </View>
        )}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Pressable accessibilityRole="button" disabled={creating} onPress={create} style={[styles.createButton, creating && styles.disabled]}>
          {creating ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.createText}>Create group</Text>}
        </Pressable>
        <Text style={styles.footnote}>Group creation is connected to Supabase. Encrypted group messaging remains disabled until group key distribution is implemented.</Text>
      </ScrollView>
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
  body: { padding: spacing.lg, paddingBottom: 40 },
  label: { color: palette.inkSoft, fontSize: 12, fontWeight: "800", marginBottom: 8 },
  field: { minHeight: 50, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white, borderRadius: radius.md, paddingHorizontal: 14, color: palette.ink, fontSize: 14 },
  searchRow: { minHeight: 52, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white, borderRadius: radius.md, paddingLeft: 14, paddingRight: 5, flexDirection: "row", alignItems: "center" },
  at: { color: palette.brand, fontSize: 16, fontWeight: "800", marginRight: 5 },
  searchInput: { flex: 1, color: palette.ink, fontSize: 14, paddingVertical: 0 },
  addButton: { minWidth: 64, height: 42, borderRadius: radius.sm, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  addText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  helper: { color: palette.muted, fontSize: 11, lineHeight: 17, marginTop: 7 },
  memberCard: { marginTop: 18, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, paddingHorizontal: 14 },
  memberRow: { minHeight: 64, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.line },
  memberName: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  memberUsername: { color: palette.muted, fontSize: 11, marginTop: 3 },
  remove: { paddingHorizontal: 9, paddingVertical: 8 },
  removeText: { color: "#B42318", fontSize: 11, fontWeight: "800" },
  empty: { alignItems: "center", marginTop: 30, padding: 20, backgroundColor: palette.white, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line },
  emptyTitle: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: 14 },
  notice: { color: "#167A55", fontSize: 12, marginTop: 14 },
  createButton: { minHeight: 50, borderRadius: radius.md, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginTop: 24 },
  createText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  footnote: { color: palette.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 12, paddingHorizontal: 10 }
});
