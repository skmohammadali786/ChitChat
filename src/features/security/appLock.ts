import * as LocalAuthentication from "expo-local-authentication";

export async function ensureDeviceAuthenticationAvailable(): Promise<void> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    throw new Error("Set up a device PIN, password, pattern, fingerprint, or face unlock before enabling ChitChat app lock.");
  }
}

export async function authenticateForAppLock(promptMessage = "Unlock ChitChat"): Promise<void> {
  await ensureDeviceAuthenticationAvailable();
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  if (!result.success) {
    if (result.error === "user_cancel" || result.error === "system_cancel" || result.error === "app_cancel") {
      throw new Error("Unlock cancelled.");
    }
    if (result.error === "lockout") {
      throw new Error("Device authentication is temporarily locked. Use your device settings and try again.");
    }
    throw new Error("Device authentication failed. ChitChat remains locked.");
  }
}
