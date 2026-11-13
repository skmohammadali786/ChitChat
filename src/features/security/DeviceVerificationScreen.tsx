import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import { palette, radius, spacing } from "../../theme/tokens";
import { chitchatCore, type DevicePublicBundle, type VerifiedDeviceFingerprint } from "../../native/chitchatCore";
import {
  listPeerDevices,
  trustPeerDevice,
  untrustPeerDevice,
  type PeerDevice,
} from "./devices";

type Props = {
  conversationId: string;
  peerUserId: string;
  peerLabel: string;
  onBack: () => void;
};

export function DeviceVerificationScreen({ conversationId, peerUserId, peerLabel, onBack }: Props) {
  const [devices, setDevices] = useState<PeerDevice[]>([]);
  const [verified, setVerified] = useState<Record<string, VerifiedDeviceFingerprint | null>>({});
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const rows = await listPeerDevices(conversationId, peerUserId);
      setDevices(rows);
      const checked = await Promise.all(rows.map(async device => {
        if (!device.fingerprint || !chitchatCore.deviceIdentityAvailable) {
          return [device.device_id, null] as const;
        }
        try {
          const bundle: DevicePublicBundle = {
            device_id: device.device_id,
            user_id: device.user_id,
            identity_key_public: device.identity_key_public,
            signed_prekey_public: device.signed_prekey_public,
            signed_prekey_signature: device.signed_prekey_signature,
            fingerprint: device.fingerprint,
            key_version: device.key_version,
          };
          const result = await chitchatCore.verifyDeviceBundle(bundle);
          return [device.device_id, result] as const;
        } catch {
          return [device.device_id, null] as const;
        }
      }));
      setVerified(Object.fromEntries(checked));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load peer devices.");
    } finally {
      setLoading(false);
    }
  }, [conversationId, peerUserId]);

  useEffect(() => { void refresh(); }, [refresh]);

  function confirmTrust(device: PeerDevice, fingerprint: VerifiedDeviceFingerprint) {
    Alert.alert(
      "Verify this security code?",
      `Compare these ten digits with ${peerLabel} using another trusted channel. Only confirm if both devices show exactly the same code. A signature proves key consistency, not the person's identity.`,
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Codes match",
          onPress: () => {
            void (async () => {
              setWorkingId(device.device_id);
              setError("");
              setNotice("");
              try {
                await trustPeerDevice(device.device_id, fingerprint.digits);
                setNotice("Device marked as trusted. A future key change will remove this trust state.");
                await refresh();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not trust this device.");
              } finally {
                setWorkingId(null);
              }
            })();
          },
        },
      ],
    );
  }

  function confirmUntrust(device: PeerDevice) {
    Alert.alert(
      "Remove device trust?",
      "You will need to compare the fingerprint again before trusting this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove trust",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setWorkingId(device.device_id);
              setError("");
              try {
                await untrustPeerDevice(device.device_id);
                setNotice("Device trust removed.");
                await refresh();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not remove device trust.");
              } finally {
                setWorkingId(null);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Verify security code</Text>
          <Text style={styles.subtitle}>{peerLabel}</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void refresh()} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.info}>
          <Text style={styles.infoTitle}>Compare on both devices</Text>
          <Text style={styles.infoText}>A signed device key can be checked cryptographically. To confirm who owns it, compare the ten-digit security code on both devices using a separate trusted channel, such as in person or a call you initiated.</Text>
        </View>

        {!chitchatCore.deviceIdentityAvailable ? (
          <Text style={styles.warning}>The Rust native verifier is not linked in this build. Device fingerprints cannot be authenticated here, so trust controls are disabled.</Text>
        ) : null}
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        {loading ? <ActivityIndicator color={palette.brand} style={{ marginTop: 28 }} /> : devices.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No active devices found</Text>
            <Text style={styles.emptyText}>This account has not registered a verifiable device yet.</Text>
          </View>
        ) : devices.map(device => {
          const result = verified[device.device_id];
          const busy = workingId === device.device_id;
          const isTrusted = Boolean(device.trusted && device.trusted_at && device.fingerprint);
          return (
            <View key={device.device_id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceName}>{device.device_label}</Text>
                  <Text style={styles.meta}>{device.platform.toUpperCase()} · Added {new Date(device.created_at).toLocaleDateString()}</Text>
                  <Text style={styles.meta}>Last active {new Date(device.last_seen_at).toLocaleString()}</Text>
                </View>
                <View style={[styles.status, isTrusted ? styles.trustedStatus : styles.pendingStatus]}>
                  <Text style={[styles.statusText, isTrusted ? styles.trustedText : styles.pendingText]}>{isTrusted ? "TRUSTED" : "NOT TRUSTED"}</Text>
                </View>
              </View>

              {result ? (
                <>
                  <Text style={styles.signatureValid}>Signature valid</Text>
                  <Text selectable style={styles.fingerprint}>{result.digits.match(/.{1,5}/g)?.join(" ") ?? result.digits}</Text>
                  <Text style={styles.meta}>Compare this code with {peerLabel} before confirming.</Text>
                </>
              ) : (
                <Text style={styles.warningSmall}>
                  {!device.fingerprint ? "This device has no signed fingerprint. It must be re-registered." : "The signature could not be verified on this build."}
                </Text>
              )}

              {result && chitchatCore.deviceIdentityAvailable ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => isTrusted ? confirmUntrust(device) : confirmTrust(device, result)}
                  style={[styles.action, isTrusted ? styles.untrustButton : styles.trustButton, busy && { opacity: 0.5 }]}
                >
                  {busy ? <ActivityIndicator color={isTrusted ? "#B42318" : "#FFFFFF"} /> : (
                    <Text style={[styles.actionText, isTrusted ? styles.untrustText : styles.trustText]}>
                      {isTrusted ? "Remove trust" : "I compared the code"}
                    </Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  header: { minHeight: 78, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: 9 },
  back: { width: 38, height: 44, justifyContent: "center" },
  backText: { color: palette.ink, fontSize: 30 },
  title: { color: palette.ink, fontSize: 17, fontWeight: "800" },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 3 },
  refresh: { padding: 10 },
  refreshText: { color: palette.brand, fontSize: 11, fontWeight: "800" },
  body: { padding: spacing.lg, paddingBottom: 44, gap: spacing.md },
  info: { backgroundColor: "#EEEAFE", borderRadius: radius.lg, padding: spacing.lg },
  infoTitle: { color: "#51458F", fontSize: 13, fontWeight: "800" },
  infoText: { color: "#5E5B70", fontSize: 11, lineHeight: 17, marginTop: 6 },
  warning: { color: "#9A5B00", backgroundColor: "#FFF5DE", borderRadius: radius.md, padding: spacing.md, fontSize: 11, lineHeight: 16 },
  warningSmall: { color: "#9A5B00", fontSize: 11, lineHeight: 16, marginTop: spacing.md },
  notice: { color: "#167A55", fontSize: 11, lineHeight: 16 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 17 },
  card: { backgroundColor: palette.white, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, padding: spacing.lg },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  deviceName: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  meta: { color: palette.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  status: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  trustedStatus: { backgroundColor: "#EAF6EF" },
  pendingStatus: { backgroundColor: "#FFF5DE" },
  statusText: { fontSize: 9, fontWeight: "900" },
  trustedText: { color: "#167A55" },
  pendingText: { color: "#9A5B00" },
  signatureValid: { color: "#167A55", fontSize: 11, fontWeight: "800", marginTop: spacing.md },
  fingerprint: { color: palette.ink, fontSize: 22, fontWeight: "900", letterSpacing: 2, marginTop: 6 },
  action: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, marginTop: spacing.lg },
  trustButton: { backgroundColor: palette.brand },
  untrustButton: { borderWidth: 1, borderColor: "#F0CACA", backgroundColor: "#FFF5F5" },
  actionText: { fontSize: 12, fontWeight: "800" },
  trustText: { color: "#FFFFFF" },
  untrustText: { color: "#B42318" },
  empty: { backgroundColor: palette.white, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center" },
  emptyTitle: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  emptyText: { color: palette.muted, fontSize: 11, textAlign: "center", marginTop: 6 },
});
