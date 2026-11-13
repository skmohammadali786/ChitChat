import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { radius, spacing } from "../../theme/tokens";
import { reportConversation, type ConversationReportReason } from "./reporting";

type Props = {
  visible: boolean;
  conversationId: string;
  targetUserId?: string | null;
  targetLabel: string;
  dark: boolean;
  accentColor: string;
  onClose: () => void;
  onSubmitted: () => void;
};

const reasons: Array<{ value: ConversationReportReason; label: string }> = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "threats", label: "Threats" },
  { value: "nudity", label: "Nudity" },
  { value: "impersonation", label: "Impersonation" },
  { value: "unsafe_content", label: "Unsafe content" },
  { value: "other", label: "Other" },
];

export function ReportConversationModal({
  visible,
  conversationId,
  targetUserId,
  targetLabel,
  dark,
  accentColor,
  onClose,
  onSubmitted,
}: Props) {
  const [reason, setReason] = useState<ConversationReportReason>("spam");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const colors = {
    backdrop: "rgba(0,0,0,0.62)",
    surface: dark ? "#191E29" : "#FFFFFF",
    raised: dark ? "#222938" : "#F0F1F5",
    text: dark ? "#F4F5F7" : "#11151D",
    muted: dark ? "#9AA3B2" : "#89919E",
    line: dark ? "#333B4B" : "#E8EBEF",
    selected: dark ? "#302A55" : "#EEEAFE",
    danger: "#D04444",
  };

  useEffect(() => {
    if (!visible) return;
    setReason("spam");
    setDetails("");
    setError("");
    setSubmitting(false);
  }, [visible, conversationId, targetUserId]);

  async function submit() {
    if (submitting) return;
    if (!conversationId) {
      setError("This conversation is not available for reporting.");
      return;
    }
    if (targetLabel === "account" && !targetUserId) {
      setError("The account details are unavailable. Close this form and reopen the conversation.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await reportConversation({
        conversationId,
        targetUserId: targetUserId ?? null,
        reason,
        details: details.trim(),
      });
      onSubmitted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit your report. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.overlay, { backgroundColor: colors.backdrop }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close report form" onPress={onClose} style={StyleSheet.absoluteFill} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.handle, { backgroundColor: colors.line }]} />
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text }]}>Report {targetLabel}</Text>
                <Text style={[styles.subtitle, { color: colors.muted }]}>Reports are private. Choose the closest reason.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={styles.close}>
                <Text style={{ color: colors.muted, fontSize: 23 }}>×</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.md }}>
              <Text style={[styles.label, { color: colors.text }]}>Reason</Text>
              <View style={styles.reasons}>
                {reasons.map(item => {
                  const selected = reason === item.value;
                  return (
                    <Pressable
                      key={item.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setReason(item.value)}
                      style={[
                        styles.reason,
                        {
                          backgroundColor: selected ? colors.selected : colors.raised,
                          borderColor: selected ? accentColor : colors.line,
                        },
                      ]}
                    >
                      <Text style={{ color: selected ? accentColor : colors.text, fontSize: 12, fontWeight: "700" }}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.detailsHeader}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>Additional details</Text>
                <Text style={{ color: colors.muted, fontSize: 10 }}>{details.length}/1000</Text>
              </View>
              <TextInput
                value={details}
                onChangeText={value => { setDetails(value); setError(""); }}
                placeholder="Add context to help review this report. Do not include passwords or private keys."
                placeholderTextColor={colors.muted}
                maxLength={1000}
                multiline
                textAlignVertical="top"
                editable={!submitting}
                style={[styles.input, { color: colors.text, backgroundColor: colors.raised, borderColor: colors.line }]}
              />

              {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
              <Text style={[styles.privacy, { color: colors.muted }]}>Do not use reports for emergencies. This form sends the report to the ChitChat moderation store, not to emergency services.</Text>

              <View style={styles.actions}>
                <Pressable accessibilityRole="button" disabled={submitting} onPress={onClose} style={[styles.cancel, { borderColor: colors.line }]}>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: "800" }}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: submitting }}
                  disabled={submitting}
                  onPress={() => void submit()}
                  style={[styles.submit, { backgroundColor: accentColor }, submitting && { opacity: 0.6 }]}
                >
                  {submitting ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "800" }}>Submit report</Text>}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  keyboard: { width: "100%" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  handle: { width: 42, height: 4, borderRadius: radius.pill, alignSelf: "center", marginBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.xl },
  title: { fontSize: 19, fontWeight: "800" },
  subtitle: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  close: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 12, fontWeight: "800", marginBottom: spacing.sm },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  reason: { minHeight: 38, paddingHorizontal: 12, borderWidth: 1, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  detailsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm },
  input: { minHeight: 104, maxHeight: 168, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, fontSize: 12, lineHeight: 18 },
  error: { fontSize: 11, lineHeight: 16, marginTop: spacing.md },
  privacy: { fontSize: 10, lineHeight: 15, marginTop: spacing.md },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  cancel: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  submit: { flex: 1.4, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
