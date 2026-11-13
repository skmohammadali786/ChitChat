import React, { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { getDecryptedAvatarUri } from "../features/messaging/mediaService";

type Props = {
  initials: string;
  color: string;
  mediaId?: string | null;
  size?: number;
  online?: boolean;
};

export function EncryptedAvatar({ initials, color, mediaId, size = 52, online = false }: Props) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUri(null);
    if (!mediaId) return () => { active = false; };

    void getDecryptedAvatarUri(mediaId)
      .then(value => {
        if (active) setUri(value);
      })
      .catch(() => {
        // Keep the initials fallback when the avatar cannot be decrypted.
      });

    return () => { active = false; };
  }, [mediaId]);

  return <Avatar initials={initials} color={color} size={size} online={online} uri={uri} />;
}
