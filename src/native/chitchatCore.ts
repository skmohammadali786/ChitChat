import { NativeModules, Platform } from "react-native";

type CoreModule = {
  validateProfile(payload: string): Promise<string>;
  validateEnvelope(payload: string): Promise<string>;
};

const nativeCore = NativeModules.ChitChatCore as CoreModule | undefined;

/**
 * Rust bridge contract. Native implementations are provided by the Android
 * UniFFI/JNI and iOS Swift bridge targets when the development client is built.
 * Expo Go does not contain this custom native module.
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
