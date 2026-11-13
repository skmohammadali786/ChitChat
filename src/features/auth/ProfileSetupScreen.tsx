import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import type { User } from "@supabase/supabase-js";
import { supabase, type ChitChatProfile } from "../../lib/supabase";
import { chitchatCore } from "../../native/chitchatCore";
import { palette, radius, spacing, typeScale } from "../../theme/tokens";

type Props = {
  user: User;
  onSaved: (profile: ChitChatProfile) => void;
  onSignOut: () => void;
};

export function ProfileSetupScreen({ user, onSaved, onSignOut }: Props) {
  const metadata = user.user_metadata ?? {};
  const [displayName, setDisplayName] = useState(String(metadata.display_name ?? metadata.full_name ?? ""));
  const [username, setUsername] = useState(String(metadata.username ?? "").toLowerCase());
  const [bio, setBio] = useState("");
  const [discoverable, setDiscoverable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    const cleanDisplayName = displayName.trim();
    const cleanUsername = username.trim().toLowerCase();

    if (cleanDisplayName.length < 2 || cleanDisplayName.length > 40) {
      setError("Display name must be between 2 and 40 characters.");
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      setError("Username must be 3 to 20 characters using letters, numbers, or underscores.");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    const profileDraft = {
      username: cleanUsername,
      display_name: cleanDisplayName,
      bio: bio.trim().slice(0, 160),
      discoverable,
    };

    if (chitchatCore.available) {
      try {
        await chitchatCore.validateProfile(profileDraft);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The Rust profile validator rejected these details.");
        return;
      }
    }

    setBusy(true);
    try {
      const payload = {
        id: user.id,
        username: cleanUsername,
        display_name: cleanDisplayName,
        bio: bio.trim().slice(0, 160),
        discoverable,
      };
      const { data, error: saveError } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" })
        .select("id, username, display_name, bio, avatar_path, discoverable")
        .single();

      if (saveError) {
        if (saveError.code === "23505") throw new Error("That username is already taken. Try another.");
        if (saveError.code === "42P01" || saveError.code === "PGRST205") {
          throw new Error("The ChitChat profiles table is not set up yet. Follow docs/SUPABASE_SETUP.md in the repository.");
        }
        throw saveError;
      }
      onSaved(data as ChitChatProfile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not save your profile. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>c.</Text></View>
        <Text style={styles.eyebrow}>ONE LAST THING</Text>
        <Text style={styles.title}>Make it yours.</Text>
        <Text style={styles.description}>Set up the profile people will see when they connect with you.</Text>

        <Text style={styles.label}>Display name</Text>
        <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={palette.muted} style={styles.field} maxLength={40} />
        <Text style={styles.label}>Username</Text>
        <View style={styles.usernameField}>
          <Text style={styles.at}>@</Text>
          <TextInput value={username} onChangeText={value => setUsername(value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} placeholder="yourusername" placeholderTextColor={palette.muted} style={styles.usernameInput} autoCapitalize="none" autoCorrect={false} maxLength={20} />
        </View>
        <Text style={styles.label}>A little about you <Text style={styles.optional}>(optional)</Text></Text>
        <TextInput value={bio} onChangeText={setBio} placeholder="A short line about yourself" placeholderTextColor={palette.muted} style={[styles.field, styles.bio]} multiline maxLength={160} textAlignVertical="top" />
        <Text style={styles.counter}>{bio.length}/160</Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: discoverable }}
          onPress={() => setDiscoverable(value => !value)}
          style={styles.discoveryRow}
        >
          <View style={[styles.checkbox, discoverable && styles.checkboxSelected]}>
            {discoverable ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          <View style={styles.discoveryCopy}>
            <Text style={styles.discoveryTitle}>Let people find me by username</Text>
            <Text style={styles.discoveryHint}>Only your username, display name, and profile photo can appear in exact username lookup. Your email stays private.</Text>
          </View>
        </Pressable>


        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={[styles.primary, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Save profile</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signout}>
          <Text style={styles.signoutText}>Sign out</Text>
        </Pressable>
        <Text style={styles.email}>{user.email ?? ""}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, paddingVertical: spacing.xxxl },
  brandMark: { width: 48, height: 48, borderRadius: 17, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginBottom: spacing.xl },
  brandMarkText: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", marginTop: -3 },
  eyebrow: { color: palette.brand, fontSize: 10, letterSpacing: 1.4, fontWeight: "800" },
  title: { color: palette.ink, fontSize: typeScale.display, fontWeight: "900", letterSpacing: -1, marginTop: spacing.sm },
  description: { color: palette.muted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm, marginBottom: spacing.xl },
  label: { color: palette.inkSoft, fontSize: 12, fontWeight: "700", marginTop: spacing.md, marginBottom: 7 },
  optional: { color: palette.muted, fontWeight: "400" },
  field: { minHeight: 49, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, color: palette.ink, backgroundColor: palette.white, fontSize: 14 },
  usernameField: { minHeight: 49, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", backgroundColor: palette.white },
  at: { color: palette.brand, fontSize: 16, fontWeight: "800", marginRight: 5 },
  usernameInput: { flex: 1, color: palette.ink, fontSize: 14, paddingVertical: 0 },
  bio: { minHeight: 92, paddingTop: 13 },
  counter: { color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 5 },
  discoveryRow: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginTop: spacing.xl },
  checkbox: { width: 21, height: 21, borderRadius: 6, borderWidth: 1.5, borderColor: "#C8CBD5", alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxSelected: { backgroundColor: palette.brand, borderColor: palette.brand },
  checkmark: { color: "#FFFFFF", fontWeight: "900", fontSize: 14, lineHeight: 17 },
  discoveryCopy: { flex: 1 },
  discoveryTitle: { color: palette.inkSoft, fontSize: 12, fontWeight: "700" },
  discoveryHint: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  primary: { minHeight: 50, borderRadius: radius.md, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.xl },
  primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.65 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  signout: { alignSelf: "center", padding: spacing.lg, marginTop: spacing.sm },
  signoutText: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  email: { color: palette.muted, fontSize: 11, textAlign: "center" }
});
