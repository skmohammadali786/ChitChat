import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
  Text, TextInput, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import { EncryptedAvatar } from "../../components/EncryptedAvatar";
import { palette, radius, spacing, typeScale } from "../../theme/tokens";
import { createDirectConversation, lookupProfileByUsername, type DiscoverableProfile } from "./service";

type Props = {
  hasAccount: boolean;
  onBack: () => void;
  onSignIn: () => void;
  onConversationCreated: (conversationId: string, profile: DiscoverableProfile) => void;
};

export function NewChatScreen({ hasAccount, onBack, onSignIn, onConversationCreated }: Props) {
  const [username, setUsername] = useState("");
  const [result, setResult] = useState<DiscoverableProfile | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function lookup() {
    setError("");
    setResult(null);
    setSearched(false);
    if (!hasAccount) return;

    setSearching(true);
    try {
      const profile = await lookupProfileByUsername(username);
      setResult(profile);
      setSearched(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Username lookup failed.");
    } finally {
      setSearching(false);
    }
  }

  async function startConversation() {
    if (!result) return;
    setError("");
    setCreating(true);
    try {
      const conversationId = await createDirectConversation(result.id);
      onConversationCreated(conversationId, result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the conversation.");
    } finally {
      setCreating(false);
    }
  }

  const initials = result?.display_name
    .split(" ")
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "??";

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>New conversation</Text>
          <Text style={styles.headerSubtitle}>Find someone by their exact username.</Text>
        </View>
      </View>

      {!hasAccount ? (
        <View style={styles.accountPrompt}>
          <View style={styles.iconWrap}><Text style={styles.icon}>＠</Text></View>
          <Text style={styles.title}>Sign in to find people.</Text>
          <Text style={styles.description}>Username discovery is available to signed-in ChitChat accounts. Demo conversations stay on this device.</Text>
          <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.primary}>
            <Text style={styles.primaryText}>Sign in</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={styles.label}>Username</Text>
          <View style={styles.searchField}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={username}
              onChangeText={value => {
                setUsername(value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase());
                setResult(null);
                setSearched(false);
                setError("");
              }}
              placeholder="enter_username"
              placeholderTextColor={palette.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              returnKeyType="search"
              onSubmitEditing={lookup}
            />
            <Pressable accessibilityRole="button" disabled={searching || username.trim().length < 3} onPress={lookup} style={[styles.searchButton, (searching || username.trim().length < 3) && styles.disabled]}>
              {searching ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.searchButtonText}>Find</Text>}
            </Pressable>
          </View>
          <Text style={styles.hint}>Search matches one exact username. Email addresses and phone numbers are never returned.</Text>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

          {result ? (
            <View style={styles.profileCard}>
              <EncryptedAvatar initials={initials} color="#D8D1FF" size={58} mediaId={result.avatar_path} />
              <View style={styles.profileCopy}>
                <Text style={styles.profileName}>{result.display_name}</Text>
                <Text style={styles.profileUsername}>@{result.username}</Text>
              </View>
              <View style={styles.found}><Text style={styles.foundText}>FOUND</Text></View>
              <Pressable accessibilityRole="button" disabled={creating} onPress={startConversation} style={[styles.primary, styles.startButton, creating && styles.disabled]}>
                {creating ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Start conversation</Text>}
              </Pressable>
            </View>
          ) : null}

          {searched && !result ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No discoverable account found.</Text>
              <Text style={styles.emptyCopy}>Check the spelling, or ask the person to enable username discovery in their profile settings.</Text>
            </View>
          ) : null}

          {!result && !searched && !error ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyGlyph}>⌕</Text>
              <Text style={styles.emptyTitle}>Who are you looking for?</Text>
              <Text style={styles.emptyCopy}>Enter their ChitChat username to start a private conversation.</Text>
            </View>
          ) : null}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  header: { minHeight: 78, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: 9 },
  back: { width: 38, height: 44, justifyContent: "center" },
  backText: { color: palette.ink, fontSize: 30, lineHeight: 34 },
  headerTitle: { color: palette.ink, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  headerSubtitle: { color: palette.muted, fontSize: 11, marginTop: 3 },
  body: { padding: spacing.lg },
  label: { color: palette.inkSoft, fontWeight: "700", fontSize: 12, marginBottom: 8 },
  searchField: { minHeight: 52, borderRadius: radius.md, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, paddingLeft: 14, paddingRight: 5, flexDirection: "row", alignItems: "center" },
  at: { color: palette.brand, fontWeight: "800", fontSize: 16, marginRight: 5 },
  input: { flex: 1, fontSize: 14, color: palette.ink, paddingVertical: 0 },
  searchButton: { minWidth: 66, height: 42, borderRadius: radius.sm, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  searchButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 12 },
  disabled: { opacity: 0.55 },
  hint: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  profileCard: { backgroundColor: palette.white, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: palette.line, flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: spacing.xl },
  profileCopy: { flex: 1, minWidth: 120, marginLeft: 12 },
  profileName: { color: palette.ink, fontSize: 15, fontWeight: "800" },
  profileUsername: { color: palette.muted, fontSize: 12, marginTop: 3 },
  found: { backgroundColor: "#E7F7EF", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 5 },
  foundText: { color: "#167A55", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  primary: { minHeight: 49, borderRadius: radius.md, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  startButton: { flexBasis: "100%" },
  primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  emptyState: { alignItems: "center", marginTop: 90, paddingHorizontal: spacing.xl },
  emptyGlyph: { color: palette.brand, fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: palette.ink, fontSize: 16, fontWeight: "800", textAlign: "center" },
  emptyCopy: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7 },
  emptyCard: { marginTop: spacing.xl, borderRadius: radius.lg, backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, padding: spacing.lg },
  accountPrompt: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl },
  iconWrap: { width: 62, height: 62, backgroundColor: palette.brandSoft, borderRadius: 22, justifyContent: "center", alignItems: "center", marginBottom: spacing.lg },
  icon: { fontSize: 30, fontWeight: "800", color: palette.brand },
  title: { color: palette.ink, fontSize: typeScale.heading, fontWeight: "800", textAlign: "center" },
  description: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: spacing.sm, maxWidth: 300 }
});
