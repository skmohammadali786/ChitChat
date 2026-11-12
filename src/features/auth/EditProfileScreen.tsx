import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View
} from "react-native";
import type { ChitChatProfile } from "../../lib/supabase";
import { supabase } from "../../lib/supabase";
import { chitchatCore } from "../../native/chitchatCore";
import { palette, radius, spacing, typeScale } from "../../theme/tokens";

type Props = {
  profile: ChitChatProfile;
  onBack: () => void;
  onSaved: (profile: ChitChatProfile) => void;
};

export function EditProfileScreen({ profile, onBack, onSaved }: Props) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    const cleanDisplayName = displayName.trim();
    const cleanUsername = username.trim().toLowerCase();
    const cleanBio = bio.trim();

    if (cleanDisplayName.length < 2 || cleanDisplayName.length > 40) {
      setError("Display name must be between 2 and 40 characters.");
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      setError("Username must be 3 to 20 characters using letters, numbers, or underscores.");
      return;
    }
    if (cleanBio.length > 160) {
      setError("Bio must be 160 characters or fewer.");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (chitchatCore.available) {
      try {
        await chitchatCore.validateProfile({
          username: cleanUsername,
          display_name: cleanDisplayName,
          bio: cleanBio,
          discoverable: profile.discoverable,
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The Rust profile validator rejected these details.");
        return;
      }
    }

    setBusy(true);
    try {
      const { data, error: updateError } = await supabase
        .from("profiles")
        .update({
          username: cleanUsername,
          display_name: cleanDisplayName,
          bio: cleanBio,
        })
        .eq("id", profile.id)
        .select("id, username, display_name, bio, avatar_path, discoverable")
        .single();

      if (updateError) {
        if (updateError.code === "23505") throw new Error("That username is already taken.");
        throw updateError;
      }
      onSaved(data as ChitChatProfile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Edit profile</Text>
            <Text style={styles.headerSubtitle}>Keep your details up to date.</Text>
          </View>
        </View>

        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {displayName.trim().split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "CH"}
          </Text>
        </View>
        <Text style={styles.eyebrow}>YOUR PROFILE</Text>
        <Text style={styles.title}>Make it yours.</Text>
        <Text style={styles.description}>Your email address is never shown in username discovery.</Text>

        <Text style={styles.label}>Display name</Text>
        <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={palette.muted} style={styles.field} maxLength={40} />
        <Text style={styles.label}>Username</Text>
        <View style={styles.usernameField}>
          <Text style={styles.at}>@</Text>
          <TextInput value={username} onChangeText={value => setUsername(value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} placeholder="yourusername" placeholderTextColor={palette.muted} style={styles.usernameInput} autoCapitalize="none" autoCorrect={false} maxLength={20} />
        </View>
        <Text style={styles.label}>Bio</Text>
        <TextInput value={bio} onChangeText={setBio} placeholder="A short line about yourself" placeholderTextColor={palette.muted} style={[styles.field, styles.bio]} multiline maxLength={160} textAlignVertical="top" />
        <Text style={styles.counter}>{bio.length}/160</Text>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={[styles.primary, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Save changes</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  scroll: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxxl },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.xl },
  back: { width: 36, height: 40, justifyContent: "center" },
  backText: { color: palette.ink, fontSize: 30, lineHeight: 34 },
  headerTitle: { color: palette.ink, fontSize: 17, fontWeight: "800" },
  headerSubtitle: { color: palette.muted, fontSize: 11, marginTop: 2 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#D8D1FF", alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  avatarText: { color: "#453A91", fontSize: 20, fontWeight: "900" },
  eyebrow: { color: palette.brand, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: palette.ink, fontSize: typeScale.display, fontWeight: "900", letterSpacing: -1, marginTop: spacing.sm },
  description: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm, marginBottom: spacing.lg },
  label: { color: palette.inkSoft, fontSize: 12, fontWeight: "700", marginTop: spacing.md, marginBottom: 7 },
  field: { minHeight: 49, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, color: palette.ink, backgroundColor: palette.white, fontSize: 14 },
  usernameField: { minHeight: 49, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", backgroundColor: palette.white },
  at: { color: palette.brand, fontSize: 16, fontWeight: "800", marginRight: 5 },
  usernameInput: { flex: 1, color: palette.ink, fontSize: 14, paddingVertical: 0 },
  bio: { minHeight: 92, paddingTop: 13 },
  counter: { color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 5 },
  primary: { minHeight: 50, borderRadius: radius.md, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.xl },
  primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.65 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: spacing.md }
});
