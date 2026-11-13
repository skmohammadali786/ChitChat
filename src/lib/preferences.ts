import { createAsyncStorage } from "@react-native-async-storage/async-storage";

const storage = createAsyncStorage("chitchat-preferences");

export type ThemeMode = "system" | "light" | "dark";
export type AccentPalette = "violet" | "ocean" | "emerald" | "rose" | "amber" | "graphite";

const accentPaletteNames: AccentPalette[] = ["violet", "ocean", "emerald", "rose", "amber", "graphite"];

export async function loadPreferences(): Promise<{
  theme: ThemeMode;
  accentPalette: AccentPalette;
  autoReveal: boolean;
}> {
  const [themeValue, legacyDark, accentValue, autoReveal] = await Promise.all([
    storage.getItem("appearance.theme"),
    storage.getItem("appearance.dark"),
    storage.getItem("appearance.accentPalette"),
    storage.getItem("messages.autoReveal"),
  ]);
  const theme: ThemeMode = themeValue === "light" || themeValue === "dark" || themeValue === "system"
    ? themeValue
    : legacyDark === "true" ? "dark" : "system";
  const accentPalette = accentPaletteNames.includes(accentValue as AccentPalette)
    ? accentValue as AccentPalette
    : "violet";
  return { theme, accentPalette, autoReveal: autoReveal === "true" };
}

export function savePreference(key: "appearance.theme", value: ThemeMode): Promise<void>;
export function savePreference(key: "appearance.accentPalette", value: AccentPalette): Promise<void>;
export function savePreference(key: "messages.autoReveal", value: boolean): Promise<void>;
export async function savePreference(
  key: "appearance.theme" | "appearance.accentPalette" | "messages.autoReveal",
  value: ThemeMode | AccentPalette | boolean,
): Promise<void> {
  await storage.setItem(key, String(value));
}
