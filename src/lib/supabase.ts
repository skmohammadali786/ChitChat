import "react-native-url-polyfill/auto";
import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

type SessionStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/**
 * Store Supabase's serialized session in the platform secure store.
 * Values are split into conservative-size chunks because some iOS Keychain
 * versions reject large individual values. A manifest is written last so a
 * partially completed write never becomes the active session.
 */
class SecureSessionStorage implements SessionStorage {
  private readonly chunkSize = 600;

  private baseKey(key: string): string {
    return `chitchat.${key.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  }

  private async readManifest(key: string): Promise<{ prefix: string; count: number } | null> {
    const raw = await SecureStore.getItemAsync(`${this.baseKey(key)}.manifest`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { prefix?: unknown; count?: unknown };
      if (
        typeof parsed.prefix !== "string" ||
        typeof parsed.count !== "number" ||
        !Number.isInteger(parsed.count) ||
        parsed.count < 1 ||
        parsed.count > 64
      ) return null;
      return { prefix: parsed.prefix, count: parsed.count };
    } catch {
      return null;
    }
  }

  private async deleteChunks(prefix: string, count: number): Promise<void> {
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        SecureStore.deleteItemAsync(`${prefix}.${index}`).catch(() => undefined)
      )
    );
  }

  async getItem(key: string): Promise<string | null> {
    const manifest = await this.readManifest(key);
    if (!manifest) return null;

    const chunks = await Promise.all(
      Array.from({ length: manifest.count }, (_, index) =>
        SecureStore.getItemAsync(`${manifest.prefix}.${index}`)
      )
    );
    if (chunks.some(chunk => chunk === null)) return null;
    return chunks.join("");
  }

  async setItem(key: string, value: string): Promise<void> {
    const base = this.baseKey(key);
    const manifestKey = `${base}.manifest`;
    const previous = await this.readManifest(key);
    const prefix = `${base}.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
    const chunks = value.match(new RegExp(`[\\s\\S]{1,${this.chunkSize}}`, "g")) ?? [""];

    try {
      await Promise.all(
        chunks.map((chunk, index) =>
          SecureStore.setItemAsync(`${prefix}.${index}`, chunk)
        )
      );
      await SecureStore.setItemAsync(
        manifestKey,
        JSON.stringify({ prefix, count: chunks.length })
      );
    } catch (error) {
      await this.deleteChunks(prefix, chunks.length);
      throw error;
    }

    if (previous) await this.deleteChunks(previous.prefix, previous.count);
  }

  async removeItem(key: string): Promise<void> {
    const base = this.baseKey(key);
    const manifest = await this.readManifest(key);
    if (manifest) await this.deleteChunks(manifest.prefix, manifest.count);
    await SecureStore.deleteItemAsync(`${base}.manifest`);
  }
}

const authStorage: SessionStorage = Platform.OS === "web"
  ? createAsyncStorage("chitchat-auth")
  : new SecureSessionStorage();

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        storage: authStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export type ChitChatProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
};
