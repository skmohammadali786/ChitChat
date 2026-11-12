import { NativeModules, Platform } from "react-native";

type CoreModule = {
  validateProfile(payload: string): Promise<string>;
  validateEnvelope(payload: string): Promise<string>;
};

const nativeCore = NativeModules.ChitChatCore as CoreModule | undefined;

/**
 * Rust bridge contract. The Android and iOS native module implementations
 * have not been linked yet. When they are added, they must register this
 * module name and match the typed methods below. Expo Go cannot load it.
 */
export const chitchatCore = {
  get available(): boolean {
    return Platform.OS !== "web" && Boolean(nativeCore);
  },

  async validateProfile(payload: unknown): Promise<void> {
    if (!nativeCore) throw new Error("ChitChat Rust core is not linked. Use a custom development build.");
    await nativeCore.validateProfile(JSON.stringify(payload));
  },

  async validateEnvelope(payload: unknown): Promise<void> {
    if (!nativeCore) throw new Error("ChitChat Rust core is not linked. Secure messaging is disabled.");
    await nativeCore.validateEnvelope(JSON.stringify(payload));
  },
};
