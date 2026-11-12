import { supabase } from "../../lib/supabase";

export type PresenceMember = {
  user_id: string;
  online: boolean;
  typing: boolean;
  last_active_at?: string;
};

export type PresencePrivacy = {
  showOnlineStatus: boolean;
  showTypingStatus: boolean;
  showLastSeen: boolean;
};

export function subscribeToConversationPresence(
  conversationId: string,
  userId: string,
  onPresence: (members: Record<string, PresenceMember[]>) => void,
  onTyping: (payload: { userId: string; typing: boolean }) => void,
  privacy: PresencePrivacy = {
    showOnlineStatus: true,
    showTypingStatus: true,
    showLastSeen: true,
  },
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const channel = supabase.channel(`conversation:${conversationId}`, {
    config: { private: true, presence: { key: userId }, broadcast: { self: false } },
  });

  channel
    .on("presence", { event: "sync" }, () => onPresence(channel.presenceState() as Record<string, PresenceMember[]>))
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      const value = payload as { userId?: string; typing?: boolean };
      if (value.userId && typeof value.typing === "boolean" && value.userId !== userId) {
        onTyping({ userId: value.userId, typing: value.typing });
      }
    });

  void supabase.realtime.setAuth().then(() => channel.subscribe(status => {
    if (status === "SUBSCRIBED" && privacy.showOnlineStatus) {
      const state: PresenceMember = {
        user_id: userId,
        online: true,
        typing: false,
        ...(privacy.showLastSeen ? { last_active_at: new Date().toISOString() } : {}),
      };
      void channel.track(state);
    }
  }));

  return {
    async setTyping(typing: boolean) {
      if (!privacy.showTypingStatus) return;
      await channel.send({
        type: "broadcast",
        event: "typing",
        payload: { userId, typing },
      });
      if (privacy.showOnlineStatus) {
        const state: PresenceMember = {
          user_id: userId,
          online: true,
          typing,
          ...(privacy.showLastSeen ? { last_active_at: new Date().toISOString() } : {}),
        };
        await channel.track(state);
      }
    },
    async stop() {
      await channel.untrack();
      if (supabase) await supabase.removeChannel(channel);
    },
  };
}
