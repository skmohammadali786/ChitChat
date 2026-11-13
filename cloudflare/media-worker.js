const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;

function response(body, status, request) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": request.headers.get("origin") || "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-chitchat-media-kind, x-chitchat-crypto-version, x-content-sha256, x-chitchat-key-envelope, x-chitchat-object-id",
    "access-control-expose-headers": "etag, x-content-sha256, x-chitchat-crypto-version, x-chitchat-key-envelope, x-chitchat-media-kind",
    "vary": "Origin",
  });
  return new Response(JSON.stringify(body), { status, headers });
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function supabaseRequest(env, token, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.SUPABASE_PUBLISHABLE_KEY);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}${path}`, { ...init, headers });
}

async function authenticate(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const result = await supabaseRequest(env, token, "/auth/v1/user");
  if (!result.ok) return null;
  const user = await result.json();
  if (!user?.id || typeof user.id !== "string") return null;
  return { id: user.id, token };
}

async function isConversationMember(env, token, userId, conversationId) {
  const query = new URLSearchParams({
    select: "conversation_id",
    conversation_id: `eq.${conversationId}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const result = await supabaseRequest(env, token, `/rest/v1/conversation_members?${query}`);
  if (!result.ok) return false;
  const rows = await result.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function getMediaRow(env, token, id) {
  const query = new URLSearchParams({
    select: "id,owner_id,conversation_id,media_kind,object_key,size_bytes,content_sha256,crypto_version,key_envelope,created_at",
    id: `eq.${id}`,
    limit: "1",
  });
  const result = await supabaseRequest(env, token, `/rest/v1/media_objects?${query}`);
  if (!result.ok) return null;
  const rows = await result.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

function limitedStream(body, maxBytes) {
  let received = 0;
  const limitError = () => {
    const error = new Error(`Upload exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
    error.name = "UploadLimitError";
    return error;
  };
  const stream = body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        controller.error(limitError());
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  return { stream, getBytes: () => received };
}

async function upload(request, env, user, conversationId, mediaKind) {
  const digest = (request.headers.get("x-content-sha256") || "").toLowerCase();
  if (!SHA256_RE.test(digest)) return response({ error: "A SHA-256 digest of the encrypted bytes is required." }, 400, request);
  const cryptoVersion = Number(request.headers.get("x-chitchat-crypto-version") || "0");
  if (!Number.isInteger(cryptoVersion) || cryptoVersion < 1) return response({ error: "A valid Rust media crypto version is required." }, 400, request);
  const keyEnvelope = request.headers.get("x-chitchat-key-envelope") || "";
  if (keyEnvelope.length < 32 || keyEnvelope.length > 8_192 || !/^[A-Za-z0-9_+\\/=.-]+$/.test(keyEnvelope)) return response({ error: "A valid encrypted media key envelope is required." }, 400, request);
  if (!request.body) return response({ error: "The upload body is empty." }, 400, request);
  const maxBytes = mediaKind === "avatar" ? MAX_AVATAR_BYTES : MAX_UPLOAD_BYTES;
  const maxMegabytes = Math.floor(maxBytes / 1024 / 1024);
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > maxBytes) {
    return response({ error: `${mediaKind === "avatar" ? "Avatar" : "Media"} uploads are limited to ${maxMegabytes} MB.` }, 413, request);
  }
  if (mediaKind !== "avatar" && !conversationId) return response({ error: "A conversation is required." }, 400, request);
  if (conversationId && !await isConversationMember(env, user.token, user.id, conversationId)) {
    return response({ error: "You are not a member of this conversation." }, 403, request);
  }

  const suppliedId = request.headers.get("x-chitchat-object-id") || "";
  const id = suppliedId || crypto.randomUUID();
  if (!UUID_RE.test(id)) return response({ error: "A valid media object ID is required." }, 400, request);
  const objectKey = mediaKind === "avatar"
    ? `avatars/${user.id}/${id}.bin`
    : `conversations/${conversationId}/${user.id}/${id}.bin`;
  const limited = limitedStream(request.body, maxBytes);
  let stored = false;
  try {
    await env.MEDIA.put(objectKey, limited.stream, {
      httpMetadata: {
        contentType: "application/octet-stream",
        cacheControl: "private, no-store",
      },
    });
    stored = true;
    const actualBytes = limited.getBytes();
    if (actualBytes < 1 || actualBytes > maxBytes) throw new Error(`Invalid ${mediaKind} size.`);

    const row = {
      id,
      owner_id: user.id,
      conversation_id: conversationId,
      media_kind: mediaKind,
      object_key: objectKey,
      content_type: "application/octet-stream",
      size_bytes: actualBytes,
      content_sha256: digest,
      crypto_version: cryptoVersion,
      key_envelope: keyEnvelope,
      encrypted: true,
    };
    const insert = await supabaseRequest(env, user.token, "/rest/v1/media_objects", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!insert.ok) {
      const detail = await insert.text();
      throw new Error(`Supabase rejected media metadata (${insert.status}): ${detail.slice(0, 300)}`);
    }

    if (mediaKind === "avatar") {
      const query = new URLSearchParams({ id: `eq.${user.id}` });
      const profileUpdate = await supabaseRequest(env, user.token, `/rest/v1/profiles?${query}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({ avatar_path: id }),
      });
      if (!profileUpdate.ok) {
        await supabaseRequest(env, user.token, `/rest/v1/media_objects?id=eq.${id}`, { method: "DELETE" });
        throw new Error("Supabase could not update the profile avatar.");
      }
    }

    return response({
      id,
      media_kind: mediaKind,
      size_bytes: actualBytes,
      encrypted: true,
      crypto_version: cryptoVersion,
      storage: "cloudflare-r2",
    }, 201, request);
  } catch (error) {
    if (stored) await env.MEDIA.delete(objectKey).catch(() => undefined);
    const limitExceeded = error instanceof Error && error.name === "UploadLimitError";
    return response(
      { error: error instanceof Error ? error.message : "Media upload failed." },
      limitExceeded ? 413 : 500,
      request,
    );
  }
}

async function download(request, env, user, id) {
  const row = await getMediaRow(env, user.token, id);
  if (!row) return response({ error: "Media not found or access denied." }, 404, request);
  const object = await env.MEDIA.get(row.object_key);
  if (!object) return response({ error: "Media object is missing from storage." }, 404, request);

  const headers = new Headers({
    "content-type": "application/octet-stream",
    "content-length": String(object.size),
    "cache-control": "private, no-store",
    "x-content-sha256": row.content_sha256,
    "x-chitchat-crypto-version": String(row.crypto_version),
    "x-chitchat-key-envelope": row.key_envelope || "",
    "x-chitchat-media-kind": row.media_kind,
    "etag": object.httpEtag,
    "access-control-allow-origin": request.headers.get("origin") || "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-chitchat-media-kind, x-chitchat-crypto-version, x-content-sha256, x-chitchat-key-envelope",
    "access-control-expose-headers": "etag, x-content-sha256, x-chitchat-crypto-version, x-chitchat-key-envelope, x-chitchat-media-kind",
    "vary": "Origin",
  });
  return new Response(object.body, { status: 200, headers });
}

async function removeMedia(request, env, user, id) {
  const row = await getMediaRow(env, user.token, id);
  if (!row || row.owner_id !== user.id) return response({ error: "Media not found or you do not own it." }, 404, request);
  const deleted = await supabaseRequest(env, user.token, `/rest/v1/media_objects?id=eq.${id}&owner_id=eq.${user.id}`, { method: "DELETE" });
  if (!deleted.ok) return response({ error: "Supabase could not delete the media record." }, 502, request);
  await env.MEDIA.delete(row.object_key);
  return response({ deleted: true, id }, 200, request);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": request.headers.get("origin") || "*",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-chitchat-media-kind, x-chitchat-crypto-version, x-content-sha256, x-chitchat-key-envelope",
        "access-control-max-age": "86400",
        "vary": "Origin",
      },
    });

    const user = await authenticate(request, env);
    if (!user) return response({ error: "A valid ChitChat session is required." }, 401, request);

    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    if (request.method === "POST" && parts.length === 4 && parts[0] === "v1" && parts[1] === "conversations" && parts[3] === "media") {
      if (!UUID_RE.test(parts[2])) return response({ error: "Invalid conversation ID." }, 400, request);
      const kind = request.headers.get("x-chitchat-media-kind");
      if (!["image", "video", "audio", "file"].includes(kind || "")) return response({ error: "Unsupported media kind." }, 400, request);
      return upload(request, env, user, parts[2], kind);
    }
    if (request.method === "POST" && parts.join("/") === "v1/avatars") {
      return upload(request, env, user, null, "avatar");
    }
    if (parts.length === 3 && parts[0] === "v1" && parts[1] === "media" && UUID_RE.test(parts[2])) {
      if (request.method === "GET") return download(request, env, user, parts[2]);
      if (request.method === "DELETE") return removeMedia(request, env, user, parts[2]);
    }
    return response({ error: "Route not found." }, 404, request);
  },
};
