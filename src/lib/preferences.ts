import { createAsyncStorage } from "@react-native-async-storage/async-storage";

const storage = createAsyncStorage("chitchat-preferences");

export async function loadPreferences(): Promise<{ dark: boolean; autoReveal: boolean }> {
  const [dark, autoReveal] = await Promise.all([
    storage.getItem("appearance.dark"),
    storage.getItem("messages.autoReveal"),
  ]);
  return {
    dark: dark === "true",
    autoReveal: autoReveal === "true",
  };
}

export async function savePreference(key: "appearance.dark" | "messages.autoReveal", value: boolean): Promise<void> {
  await storage.setItem(key, String(value));
}
