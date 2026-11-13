import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View
} from "react-native";
import { MotionPressable as Pressable } from "../../components/MotionPressable";
import { palette, radius, spacing } from "../../theme/tokens";
import {
  chitchatCore,
  type DevicePublicBundle,
  type VerifiedDeviceFingerprint,
} from "../../native/chitchatCore";
import {
  listMyDevices,
  registerMyDevice,
  revokeMyDevice,
  type RegisteredDevice,
} from "./devices";

type Props = { onBack: () => void };

export function DeviceManagementScreen({ onBack }: Props) {
  const [items, setItems] = useState<RegisteredDevice[]>([]);
  const [fingerprints, setFingerprints] = useState<Record<string, VerifiedDeviceFingerprint | null>>({});
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const devices = await listMyDevices();
      setItems(devices);
      if (chitchatCore.deviceVerificationAvailable) {
        const checks = await Promise.all(devices.map(async device => {
          if (!device.fingerprint) return [device.id, null] as const;
          try {
            const bundle: DevicePublicBundle = {
              device_id: device.id,
              user_id: device.user_id,
              identity_key_public: device.identity_key_public,
              signed_prekey_public: device.signed_prekey_public,
              signed_prekey_signature: device.signed_prekey_signature,
              key_version: device.key_version,
              fingerprint: device.fingerprint,
            };
            const verified = await chitchatCore.verifyDeviceBundle(bundle);
            return [device.id, verified] as const;
          } catch {
            return [device.id, null] as const;
          }
        }));
        setFingerprints(Object.fromEntries(checks));
      } else {
        setFingerprints({});
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load registered devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function registerThisDevice() {
    if (!chitchatCore.deviceIdentityAvailable || registering) {
      setError("Protected device registration requires the native Rust module and platform keystore.");
      return;
    }
    setRegistering(true);
    setError("");
    setNotice("");
    try {
      const { supabase } = await import("../../lib/supabase");
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!data.user) throw new Error("Sign in to register this device.");
      const bundle = await chitchatCore.createDeviceIdentity(data.user.id);
      await registerMyDevice(bundle);
      setNotice("This device has been registered. Compare its fingerprint with another device before trusting it.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not register this device.");
    } finally {
      setRegistering(false);
    }
  }

  function confirmRevoke(device: RegisteredDevice) {
    Alert.alert(
      "Revoke this device?",
      "This removes the device from your active registry. The device's local private keys must also be deleted by the native app.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusyId(device.id);
              setError("");
              try {
                await revokeMyDevice(device.id);
                setItems(current => current.filter(item => item.id !== device.id));
                setFingerprints(current => {
                  const next = { ...current };
                  delete next[device.id];
                  return next;
                });
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not revoke this device.");
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
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Your devices</Text>
          <Text style={styles.subtitle}>Manage devices registered to your account.</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Device verification</Text>
          <Text style={styles.infoCopy}>Each device has an identity key and a signed prekey. Compare the ten-digit fingerprint with the person or device you trust using a second channel. A valid signature alone does not prove who owns a device.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!chitchatCore.deviceIdentityAvailable || registering}
          onPress={() => void registerThisDevice()}
          style={[styles.registerButton, (!chitchatCore.deviceIdentityAvailable || registering) && styles.disabled]}
        >
          {registering ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.registerText}>{chitchatCore.deviceIdentityAvailable ? "Register this device" : "Native device security unavailable"}</Text>}
        </Pressable>
        {!chitchatCore.deviceIdentityAvailable ? (
          <Text style={styles.helper}>This build does not contain the Rust device identity and Android Keystore/iOS Keychain bridge yet. Existing registered devices can still be viewed or revoked.</Text>
        ) : null}
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Text style={styles.sectionTitle}>Active devices</Text>

        {loading ? <ActivityIndicator color={palette.brand} style={{ marginTop: 26 }} /> : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No active devices registered</Text>
            <Text style={styles.emptyCopy}>Register a device after installing a build with the native identity module.</Text>
          </View>
        ) : items.map(device => {
          const fingerprint = fingerprints[device.id];
          return (
            <View key={device.id} style={styles.deviceCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{device.device_label}</Text>
                <Text style={styles.deviceMeta}>{device.platform.toUpperCase()} · Added {new Date(device.created_at).toLocaleDateString()}</Text>
                <Text style={styles.deviceMeta}>Last active {new Date(device.last_seen_at).toLocaleString()}</Text>
                {fingerprint ? (
                  <>
                    <Text style={styles.verified}>Signature valid</Text>
                    <Text selectable style={styles.fingerprint}>Security code {fingerprint.digits}</Text>
                  </>
                ) : (
                  <Text style={styles.unverified}>{chitchatCore.deviceVerificationAvailable ? "Signature not verified" : "Local verification unavailable"}</Text>
                )}
              </View>
              <Pressable accessibilityRole="button" disabled={busyId === device.id} onPress={() => confirmRevoke(device)} style={styles.revoke}>
                {busyId === device.id ? <ActivityIndicator color="#B42318" size="small" /> : <Text style={styles.revokeText}>Revoke</Text>}
              </Pressable>
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
  title: { color: palette.ink, fontSize: 18, fontWeight: "800" },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 3 },
  body: { padding: spacing.lg, paddingBottom: 40 },
  infoCard: { backgroundColor: "#EEEAFE", borderRadius: radius.lg, padding: spacing.lg },
  infoTitle: { color: "#51458F", fontSize: 13, fontWeight: "800" },
  infoCopy: { color: "#5E5B70", fontSize: 11, lineHeight: 17, marginTop: 6 },
  registerButton: { minHeight: 48, borderRadius: radius.md, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  registerText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  helper: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  notice: { color: "#167A55", fontSize: 11, lineHeight: 16, marginTop: 12 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: 12 },
  sectionTitle: { color: palette.ink, fontSize: 13, fontWeight: "800", marginTop: spacing.xl, marginBottom: spacing.sm },
  deviceCard: { backgroundColor: palette.white, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, padding: spacing.md, marginBottom: spacing.sm, flexDirection: "row", alignItems: "center" },
  deviceName: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  deviceMeta: { color: palette.muted, fontSize: 10, marginTop: 4 },
  verified: { color: "#167A55", fontSize: 10, fontWeight: "800", marginTop: 8 },
  unverified: { color: "#A65B00", fontSize: 10, fontWeight: "800", marginTop: 8 },
  fingerprint: { color: palette.ink, fontSize: 15, fontWeight: "900", letterSpacing: 2, marginTop: 3 },
  revoke: { paddingHorizontal: 10, paddingVertical: 10 },
  revokeText: { color: "#B42318", fontSize: 11, fontWeight: "800" },
  empty: { backgroundColor: palette.white, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", marginTop: spacing.sm },
  emptyTitle: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  emptyCopy: { color: palette.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 7 },
});
