import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View
} from "react-native";
import { supabase } from "../../lib/supabase";
import { palette, radius, spacing, typeScale } from "../../theme/tokens";

type Props = { onDone: () => void };

export function PasswordRecoveryScreen({ onDone }: Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function updatePassword() {
    setError("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Password update failed. Request a new reset link and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.mark}><Text style={styles.markText}>c.</Text></View>
        <Text style={styles.eyebrow}>ACCOUNT RECOVERY</Text>
        <Text style={styles.title}>{success ? "Password updated." : "Choose a new password."}</Text>
        <Text style={styles.description}>
          {success
            ? "Your password has been changed. Sign in again with your new password."
            : "Choose a strong password you have not used for another account."}
        </Text>

        {!success ? (
          <>
            <Text style={styles.label}>New password</Text>
            <TextInput value={password} onChangeText={setPassword} placeholder="At least 8 characters" placeholderTextColor={palette.muted} style={styles.field} secureTextEntry autoCapitalize="none" textContentType="newPassword" />
            <Text style={styles.label}>Confirm new password</Text>
            <TextInput value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter it again" placeholderTextColor={palette.muted} style={styles.field} secureTextEntry autoCapitalize="none" textContentType="newPassword" onSubmitEditing={updatePassword} returnKeyType="done" />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy} onPress={updatePassword} style={[styles.primary, busy && styles.disabled]}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Update password</Text>}
            </Pressable>
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.primary}>
            <Text style={styles.primaryText}>Return to sign in</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, paddingVertical: spacing.xxxl },
  mark: { width: 48, height: 48, borderRadius: 17, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginBottom: spacing.xl },
  markText: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", marginTop: -3 },
  eyebrow: { color: palette.brand, fontSize: 10, letterSpacing: 1.4, fontWeight: "800" },
  title: { color: palette.ink, fontSize: typeScale.display, fontWeight: "900", letterSpacing: -1, marginTop: spacing.sm },
  description: { color: palette.muted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm, marginBottom: spacing.xl },
  label: { color: palette.inkSoft, fontSize: 12, fontWeight: "700", marginTop: spacing.md, marginBottom: 7 },
  field: { minHeight: 49, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, color: palette.ink, backgroundColor: palette.white, fontSize: 14 },
  primary: { minHeight: 50, borderRadius: radius.md, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.xl },
  primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.65 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: spacing.md }
});
