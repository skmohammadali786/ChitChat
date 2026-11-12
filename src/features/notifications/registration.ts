import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";
import { registerPushDevice, unregisterPushDevice, type PushPlatform } from "./pushDevices";

function nativePlatform(): PushPlatform {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    throw new Error("Push notifications are available on Android and iOS devices.");
  }
  return Platform.OS;
}

function easProjectId(): string {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("Set EXPO_PUBLIC_EAS_PROJECT_ID after linking this app to an Expo EAS project.");
  }
  return projectId;
}

export async function enablePushNotifications(): Promise<string> {
  const platform = nativePlatform();
  const projectId = easProjectId();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (platform === "android") {
    await Notifications.setNotificationChannelAsync("messages", {
      name: "Messages",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: "#7665D8",
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let permission = existing;
  if (!existing.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Notification permission was not granted. Enable it in your device settings to receive messages.");
  }

  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerPushDevice(result.data, platform);
  return result.data;
}

export async function disablePushNotifications(): Promise<void> {
  const platform = nativePlatform();
  if (!supabase) throw new Error("Supabase is not configured.");
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) {
    const projectId = easProjectId();
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    await unregisterPushDevice(result.data);
  }
  await Notifications.unregisterForNotificationsAsync();
}

export function listenForPushTokenChanges() {
  const platform = nativePlatform();
  const projectId = easProjectId();
  return Notifications.addPushTokenListener(() => {
    void Notifications.getExpoPushTokenAsync({ projectId })
      .then(result => registerPushDevice(result.data, platform))
      .catch(error => console.warn("ChitChat could not refresh its push token.", error));
  });
}
