import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";

export type PickedMediaKind = "image" | "video" | "audio" | "file";

export type PickedMedia = {
  uri: string;
  name: string;
  mimeType: string;
  kind: PickedMediaKind;
  sizeBytes: number;
};

export const MAX_PICKED_MEDIA_BYTES = 50 * 1024 * 1024 - 16;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

async function getFileSize(uri: string, knownSize?: number | null): Promise<number> {
  if (typeof knownSize === "number" && Number.isFinite(knownSize) && knownSize >= 0) {
    return knownSize;
  }
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

function inferKind(mimeType: string): PickedMediaKind {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return "file";
}

async function checkMediaSize(uri: string, sizeHint?: number | null, maxBytes = MAX_PICKED_MEDIA_BYTES): Promise<number> {
  const size = await getFileSize(uri, sizeHint);
  if (size > maxBytes) throw new Error(`The selected file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  if (size === 0) throw new Error("The selected file size could not be verified. Choose a different file.");
  return size;
}

export async function pickImageOrVideo(): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow photo library access to attach an image or video.");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsEditing: false,
    quality: 1,
    videoMaxDuration: 300,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const kind: PickedMediaKind = asset.type === "video" ? "video" : "image";
  const mimeType = asset.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg");
  const sizeBytes = await checkMediaSize(asset.uri, asset.fileSize);
  return {
    uri: asset.uri,
    name: asset.fileName || `chitchat-${Date.now()}.${kind === "video" ? "mp4" : "jpg"}`,
    mimeType,
    kind,
    sizeBytes,
  };
}

export async function pickAudioOrFile(): Promise<PickedMedia | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const mimeType = asset.mimeType || "application/octet-stream";
  const sizeBytes = await checkMediaSize(asset.uri, asset.size);
  return {
    uri: asset.uri,
    name: asset.name || `chitchat-file-${Date.now()}`,
    mimeType,
    kind: inferKind(mimeType),
    sizeBytes,
  };
}

export async function pickAvatarImage(): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow photo library access to choose a profile avatar.");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.82,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const sizeBytes = await checkMediaSize(asset.uri, asset.fileSize, MAX_AVATAR_BYTES);
  return {
    uri: asset.uri,
    name: asset.fileName || `chitchat-avatar-${Date.now()}.jpg`,
    mimeType: asset.mimeType || "image/jpeg",
    kind: "image",
    sizeBytes,
  };
}
