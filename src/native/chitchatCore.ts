import { NativeModules, Platform } from "react-native";

type CoreModule = {
  validateProfile(payload: string): Promise<string>;
  validateEnvelope(payload: string): Promise<string>;
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
