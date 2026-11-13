import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import * as Linking from "expo-linking";
import { palette, radius, spacing, typeScale } from "../../theme/tokens";
import { supabase } from "../../lib/supabase";

type Props = { onContinueDemo: () => void };

export function AuthScreen({ onContinueDemo }: Props) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signup");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit() {
    setError("");
    setNotice("");

    const cleanEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!isReset && password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (isSignup) {
      const cleanUsername = username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
        setError("Username must be 3 to 20 characters. Use letters, numbers, and underscores.");
        return;
      }
      if (displayName.trim().length < 2) {
        setError("Enter a display name with at least 2 characters.");
        return;
      }
    }
    if (!supabase) {
      setError("Supabase is not configured. Add your project URL and publishable key to the app environment.");
      return;
    }

    setBusy(true);
    try {
      if (isReset) {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: Linking.createURL("auth/callback"),
        });
        if (resetError) throw resetError;
        setNotice("If an account exists for this email, a password reset link will arrive shortly.");
      } else if (isSignup) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: Linking.createURL("auth/callback"),
            data: {
              username: username.trim().toLowerCase(),
              display_name: displayName.trim(),
            },
          },
        });
        if (authError) throw authError;
        if (data.session) {
          setNotice("Account created. Complete your profile to continue.");
        } else {
          setNotice("Check your email to confirm your account. Then return to ChitChat and sign in.");
          setMode("signin");
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (authError) throw authError;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";
  const isReset = mode === "reset";
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <View style={styles.mark}><Text style={styles.markText}>c.</Text></View>
          <Text style={styles.brand}>ChitChat</Text>
          <Text style={styles.tagline}>A little more personal.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.eyebrow}>{isSignup ? "YOUR PRIVATE SPACE" : isReset ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</Text>
          <Text style={styles.title}>{isSignup ? "Make room for real conversations." : isReset ? "Get back into your account." : "Good to see you again."}</Text>
          <Text style={styles.description}>
            {isSignup ? "Create your account and choose a username people can find you by." : isReset ? "Enter your email and we will send a secure password reset link." : "Sign in to pick up where your conversations left off."}
          </Text>

          {isSignup ? (
            <>
              <Text style={styles.label}>Display name</Text>
              <TextInput value={displayName} onChangeText={setDisplayName} placeholder="What should people call you?" placeholderTextColor={palette.muted} style={styles.field} autoCapitalize="words" maxLength={40} returnKeyType="next" />
              <Text style={styles.label}>Username</Text>
              <View style={styles.usernameField}>
                <Text style={styles.at}>@</Text>
                <TextInput value={username} onChangeText={value => setUsername(value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} placeholder="yourusername" placeholderTextColor={palette.muted} style={styles.usernameInput} autoCapitalize="none" autoCorrect={false} maxLength={20} returnKeyType="next" />
              </View>
            </>
          ) : null}

          <Text style={styles.label}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={palette.muted} style={styles.field} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
          {!isReset ? (
            <>
              <Text style={styles.label}>Password</Text>
              <TextInput value={password} onChangeText={setPassword} placeholder="At least 8 characters" placeholderTextColor={palette.muted} style={styles.field} secureTextEntry autoCapitalize="none" textContentType={isSignup ? "newPassword" : "password"} returnKeyType="done" onSubmitEditing={submit} />
            </>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}

          <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={[styles.primary, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{isSignup ? "Create account" : isReset ? "Send reset link" : "Sign in"}</Text>}
          </Pressable>

          {mode === "signin" ? (
            <Pressable onPress={() => { setMode("reset"); setError(""); setNotice(""); }} style={{ alignSelf: "center", paddingTop: spacing.md }}>
              <Text style={styles.switchAction}>Forgot password?</Text>
            </Pressable>
          ) : null}
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>{isSignup ? "Already have an account?" : isReset ? "Remembered your password?" : "New to ChitChat?"}</Text>
            <Pressable onPress={() => { setMode(isSignup || isReset ? "signin" : "signup"); setError(""); setNotice(""); }}>
              <Text style={styles.switchAction}>{isSignup || isReset ? " Sign in" : " Create account"}</Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={onContinueDemo} style={styles.demoButton}>
          <Text style={styles.demoText}>Explore the local demo</Text>
        </Pressable>
        <Text style={styles.footnote}>Your messages should belong to you. Privacy is part of the product, not an upgrade.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  top: { alignItems: "center", marginBottom: spacing.xxl },
  mark: { width: 54, height: 54, borderRadius: 19, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-7deg" }] },
  markText: { color: "#FFFFFF", fontSize: 34, fontWeight: "900", marginTop: -3 },
  brand: { color: palette.ink, fontSize: typeScale.display, fontWeight: "900", letterSpacing: -1.3, marginTop: spacing.md },
  tagline: { color: palette.muted, fontSize: 13, marginTop: 3 },
  card: { backgroundColor: palette.white, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: palette.line },
  eyebrow: { color: palette.brand, fontWeight: "800", letterSpacing: 1.4, fontSize: 10, marginBottom: spacing.sm },
  title: { color: palette.ink, fontSize: 25, fontWeight: "800", lineHeight: 31, letterSpacing: -0.7 },
  description: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm, marginBottom: spacing.lg },
  label: { color: palette.inkSoft, fontSize: 12, fontWeight: "700", marginTop: spacing.md, marginBottom: 7 },
  field: { minHeight: 49, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, color: palette.ink, backgroundColor: "#FBFBFC", fontSize: 14 },
  usernameField: { minHeight: 49, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", backgroundColor: "#FBFBFC" },
  at: { color: palette.brand, fontSize: 16, fontWeight: "800", marginRight: 5 },
  usernameInput: { flex: 1, color: palette.ink, fontSize: 14, paddingVertical: 0 },
  primary: { minHeight: 50, borderRadius: radius.md, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.xl },
  primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.65 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  notice: { color: "#167A55", fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.lg, flexWrap: "wrap" },
  switchText: { color: palette.muted, fontSize: 12 },
  switchAction: { color: palette.brand, fontSize: 12, fontWeight: "800" },
  demoButton: { alignSelf: "center", padding: spacing.lg, marginTop: spacing.sm },
  demoText: { color: palette.brand, fontWeight: "700", fontSize: 13 },
  footnote: { color: palette.muted, textAlign: "center", fontSize: 11, lineHeight: 17, paddingHorizontal: spacing.lg, marginTop: spacing.sm }
});
