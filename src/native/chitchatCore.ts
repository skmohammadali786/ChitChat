import { NativeModules, Platform } from "react-native";

export type DevicePublicBundle = {
  device_id: string;
  user_id: string;
  identity_key_public: string;
  signed_prekey_public: string;
  signed_prekey_signature: string;
  key_version: number;
  fingerprint: string;
};

export type VerifiedDeviceFingerprint = {
  device_id: string;
  user_id: string;
  digits: string;
};

type CoreModule = {
  validateProfile(payload: string): Promise<string>;
  validateEnvelope(payload: string): Promise<string>;
  createDeviceIdentity?: (userId: string) => Promise<string>;
  verifyDeviceBundle?: (payload: string) => Promise<string>;
};

const nativeCore = NativeModules.ChitChatCore as CoreModule | undefined;

/**
 * Native Rust bridge contract.
 *
 * The module is only present in ChitChat development/production builds. Expo
 * Go intentionally does not contain custom native modules. Never silently
 * substitute JS crypto or plaintext when this module is missing.
 */
export const chitchatCore = {
  get available(): boolean {
    return Platform.OS !== "web" && Boolean(nativeCore);
  },

  get deviceIdentityAvailable(): boolean {
    return Platform.OS !== "web"
      && typeof nativeCore?.createDeviceIdentity === "function"
      && typeof nativeCore?.verifyDeviceBundle === "function";
  },

  async createDeviceIdentity(userId: string): Promise<DevicePublicBundle> {
    if (!userId || !chitchatCore.deviceIdentityAvailable || !nativeCore?.createDeviceIdentity) {
      throw new Error("The protected Rust device identity module is not linked in this build.");
    }
    const raw = await nativeCore.createDeviceIdentity(userId);
    const value = JSON.parse(raw) as DevicePublicBundle;
    if (
      value.user_id !== userId ||
      !value.device_id ||
      !value.identity_key_public ||
      !value.signed_prekey_public ||
      !value.signed_prekey_signature ||
      value.key_version !== 1 ||
      !/^\\d{10}$/.test(value.fingerprint)
    ) {
      throw new Error("The native device identity returned an invalid public bundle.");
    }
    return value;
  },

  async verifyDeviceBundle(bundle: DevicePublicBundle): Promise<VerifiedDeviceFingerprint> {
    if (!chitchatCore.deviceIdentityAvailable || !nativeCore?.verifyDeviceBundle) {
      throw new Error("The Rust device verification module is not linked in this build.");
    }
    const raw = await nativeCore.verifyDeviceBundle(JSON.stringify(bundle));
    const result = JSON.parse(raw) as VerifiedDeviceFingerprint;
    if (result.user_id !== bundle.user_id || result.device_id !== bundle.device_id || result.digits !== bundle.fingerprint) {
      throw new Error("The Rust device verifier returned a mismatched fingerprint.");
    }
    return result;
  },

  async validateProfile(payload: unknown): Promise<void> {
    if (!nativeCore) {
      throw new Error("ChitChat Rust core is not linked. Use a custom native development build.");
    }
    await nativeCore.validateProfile(JSON.stringify(payload));
  },

  async validateEnvelope(payload: unknown): Promise<void> {
    if (!nativeCore) {
      throw new Error("Secure messaging is disabled because the Rust core is unavailable.");
    }
    await nativeCore.validateEnvelope(JSON.stringify(payload));
  },
};
