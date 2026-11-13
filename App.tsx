import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as ExpoLinking from "expo-linking";
import {
  ActivityIndicator, Alert, AppState, Linking, View, Text, TextInput, FlatList, ScrollView, useColorScheme,
  StyleSheet, KeyboardAvoidingView, Platform, StatusBar
} from "react-native";
import { MotionPressable as Pressable } from "./src/components/MotionPressable";
import { AnimatedSafeAreaView, ScreenTransition } from "./src/components/ScreenTransition";
import { Avatar } from "./src/components/Avatar";
import { SecretReveal } from "./src/components/SecretReveal";
import { accentPalettes, palette, radius, spacing, typeScale } from "./src/theme/tokens";
import type { Session } from "@supabase/supabase-js";
import { AuthScreen } from "./src/features/auth/AuthScreen";
import { PasswordRecoveryScreen } from "./src/features/auth/PasswordRecoveryScreen";
import { ProfileSetupScreen } from "./src/features/auth/ProfileSetupScreen";
import { EditProfileScreen } from "./src/features/auth/EditProfileScreen";
import { NewChatScreen } from "./src/features/messaging/NewChatScreen";
import { GroupCreationScreen } from "./src/features/messaging/GroupCreationScreen";
import { GroupManagementScreen } from "./src/features/messaging/GroupManagementScreen";
import { BlockedUsersScreen } from "./src/features/messaging/BlockedUsersScreen";
import { ScheduledMessagesScreen } from "./src/features/messaging/ScheduledMessagesScreen";
import { ReportConversationModal } from "./src/features/messaging/ReportConversationModal";
import { authenticateForAppLock } from "./src/features/security/appLock";
import { blockUser, loadMyConversations, type DiscoverableProfile } from "./src/features/messaging/service";
import { subscribeToConversationPresence } from "./src/features/messaging/presence";
import { flushPendingEncryptedMessages } from "./src/features/messaging/delivery";
import { listPendingEncryptedMessages } from "./src/features/messaging/outbox";
import { completeAuthFromUrl } from "./src/features/auth/deepLinks";
import { isSupabaseConfigured, supabase, type ChitChatProfile } from "./src/lib/supabase";
import { loadPreferences, savePreference, type AccentPalette } from "./src/lib/preferences";
import { loadConversationSettings, loadUserSettings, saveConversationSettings, saveUserSettings, type ConversationSettings } from "./src/features/settings/userSettings";
import { disablePushNotifications, enablePushNotifications, listenForPushTokenChanges, revokeCurrentPushRegistration, syncPushRegistrationIfGranted } from "./src/features/notifications/registration";

type Chat = { id: string; name: string; initials: string; color: string; message: string; time: string; unread: number; online?: boolean; secret?: boolean; isReal?: boolean; isGroup?: boolean; conversationId?: string; remoteUserId?: string; pinnedAt?: string | null; mutedUntil?: string | null; archivedAt?: string | null; hiddenAt?: string | null };
type Message = { id: string; mine: boolean; text: string; time: string; secret?: boolean };

const initialChats: Chat[] = [
  { id: "1", name: "Aarav Mehta", initials: "AM", color: "#F9D8C6", message: "That sounds like a plan ✨", time: "now", unread: 2, online: true },
  { id: "2", name: "Sana Khan", initials: "SK", color: "#D8D1FF", message: "Sent you a little surprise", time: "2m", unread: 1, online: true, secret: true },
  { id: "3", name: "Design Buddies", initials: "DB", color: "#CDEFE1", message: "Riya: the new version is ready", time: "18m", unread: 0 },
  { id: "4", name: "Kabir Shah", initials: "KS", color: "#F8E5AE", message: "Voice message · 0:18", time: "1h", unread: 0 },
  { id: "5", name: "Mira Patel", initials: "MP", color: "#F7D4E4", message: "See you tomorrow!", time: "3h", unread: 0 }
];

const seedMessages: Message[] = [
  { id: "m1", mine: false, text: "Hey! How has your day been?", time: "10:42" },
  { id: "m2", mine: true, text: "Pretty good. Finally got some time to work on ChitChat.", time: "10:43" },
  { id: "m3", mine: false, text: "I saved you the window seat. The view is beautiful, just like you said it would be.", time: "10:44", secret: true },
  { id: "m4", mine: true, text: "Now you have my attention.", time: "10:45" }
];

function MainApp({ profile, onSignOut, onExitDemo, onProfileUpdated, openConversationId, onNotificationHandled }: { profile?: ChitChatProfile | null; onSignOut?: () => void; onExitDemo?: () => void; onProfileUpdated?: (profile: ChitChatProfile) => void; openConversationId?: string | null; onNotificationHandled?: () => void }) {
  const [tab, setTab] = useState<"Chats" | "Calls" | "Settings">("Chats");
  const [conversationListMode, setConversationListMode] = useState<"inbox" | "archived" | "hidden">("inbox");
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>(profile ? [] : initialChats);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showGroupCreation, setShowGroupCreation] = useState(false);
  const [showGroupManagement, setShowGroupManagement] = useState(false);
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [showScheduledMessages, setShowScheduledMessages] = useState(false);
  const [reportingChat, setReportingChat] = useState<Chat | null>(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [conversationLoadError, setConversationLoadError] = useState("");
  const [discoveryEnabled, setDiscoveryEnabled] = useState(profile?.discoverable ?? false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);
  const [accountSecurityMessage, setAccountSecurityMessage] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [draftSecret, setDraftSecret] = useState(false);
  const [demoMessagesByChat, setDemoMessagesByChat] = useState<Record<string, Message[]>>({});
  const activeMessages = activeChat ? (demoMessagesByChat[activeChat.id] ?? seedMessages) : seedMessages;
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">("system");
  const [accentPalette, setAccentPalette] = useState<AccentPalette>("violet");
  const systemColorScheme = useColorScheme();
  const dark = themeMode === "dark" || (themeMode === "system" && systemColorScheme === "dark");
  const accentColor = accentPalettes[accentPalette];
  const [autoReveal, setAutoReveal] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [showReadReceipts, setShowReadReceipts] = useState(true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const [showTypingStatus, setShowTypingStatus] = useState(true);
  const [showLastSeen, setShowLastSeen] = useState(true);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const [notificationPreview, setNotificationPreview] = useState<"none" | "sender" | "full">("sender");
  const [securitySettingsReady, setSecuritySettingsReady] = useState(!profile);
  const [securitySettingsAccountId, setSecuritySettingsAccountId] = useState<string | null>(profile?.id ?? null);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [appLocked, setAppLocked] = useState(Boolean(profile));
  const [appState, setAppState] = useState(AppState.currentState);
  const [appLockError, setAppLockError] = useState("");
  const appLockAuthInProgressRef = useRef(false);
  const pushSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const presenceRef = useRef<ReturnType<typeof subscribeToConversationPresence> | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = dark ? {
    bg: palette.darkBg, surface: palette.darkSurface, raised: palette.darkRaised,
    text: palette.darkText, muted: palette.darkMuted, line: palette.darkLine
  } : {
    bg: palette.paper, surface: palette.white, raised: "#F0F1F5",
    text: palette.ink, muted: palette.muted, line: palette.line
  };

  useEffect(() => {
    let active = true;
    void loadPreferences()
      .then(saved => {
        if (!active) return;
        setThemeMode(saved.theme);
        setAccentPalette(saved.accentPalette);
        setAutoReveal(saved.autoReveal);
      })
      .catch(error => console.warn("Could not load ChitChat preferences.", error))
      .finally(() => {
        if (active) setPreferencesReady(true);
      });
    return () => { active = false; };
  }, []);

  async function updateThemeMode(next: "system" | "light" | "dark") {
    const previous = themeMode;
    setThemeMode(next);
    setSettingsError("");
    try {
      await savePreference("appearance.theme", next);
      if (profile) await saveUserSettings({ theme: next });
    } catch (error) {
      setThemeMode(previous);
      void savePreference("appearance.theme", previous);
      setSettingsError(error instanceof Error ? error.message : "Could not save appearance setting.");
    }
  }

  async function updateAccentPalette(next: AccentPalette) {
    const previous = accentPalette;
    setAccentPalette(next);
    setSettingsError("");
    try {
      await savePreference("appearance.accentPalette", next);
      if (profile) await saveUserSettings({ accent_palette: next });
    } catch (error) {
      setAccentPalette(previous);
      void savePreference("appearance.accentPalette", previous);
      setSettingsError(error instanceof Error ? error.message : "Could not save accent palette.");
    }
  }

  function toggleAutoReveal() {
    const next = !autoReveal;
    setAutoReveal(next);
    void savePreference("messages.autoReveal", next).catch(error => {
      console.warn("Could not save secret reveal preference.", error);
    });
    if (profile) {
      void saveUserSettings({ auto_reveal_secrets: next }).catch(error => {
        setAutoReveal(!next);
        setSettingsError(error instanceof Error ? error.message : "Could not save secret reveal setting.");
      });
    }
  }

  async function updatePrivacySetting(
    key: "show_read_receipts" | "show_online_status" | "show_typing_status",
    next: boolean,
  ) {
    setSettingsError("");
    const setter = key === "show_read_receipts"
      ? setShowReadReceipts
      : key === "show_online_status"
        ? setShowOnlineStatus
        : setShowTypingStatus;
    const current = key === "show_read_receipts"
      ? showReadReceipts
      : key === "show_online_status"
        ? showOnlineStatus
        : showTypingStatus;
    setter(next);
    if (!profile) return;
    try {
      await saveUserSettings(
        key === "show_read_receipts"
          ? { show_read_receipts: next }
          : key === "show_online_status"
            ? { show_online_status: next }
            : { show_typing_status: next },
      );
    } catch (error) {
      setter(current);
      setSettingsError(error instanceof Error ? error.message : "Could not save privacy setting.");
    }
  }

  useEffect(() => {
    setChats(profile ? [] : initialChats);
    setActiveChat(null);
    setDraft("");
    setDraftSecret(false);
    setConversationListMode("inbox");
    setShowScheduledMessages(false);
    setReportingChat(null);
    setShowGroupManagement(false);
    setShowGroupCreation(false);
    setShowNewChat(false);
    setAppLockEnabled(false);
    setAppLocked(Boolean(profile));
    setAppLockError("");
    setSecuritySettingsReady(!profile);
    setSecuritySettingsAccountId(profile?.id ?? null);
  }, [profile?.id]);

  const filteredChats = useMemo(() => chats
    .filter(chat => (conversationListMode === "archived" ? Boolean(chat.archivedAt) : conversationListMode === "hidden" ? Boolean(chat.hiddenAt) && !chat.archivedAt : !chat.archivedAt && !chat.hiddenAt) &&
      chat.name.toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => {
      const leftPinned = left.pinnedAt ? Date.parse(left.pinnedAt) : 0;
      const rightPinned = right.pinnedAt ? Date.parse(right.pinnedAt) : 0;
      return rightPinned - leftPinned;
    }), [chats, search, conversationListMode]);

  useEffect(() => {
    if (!profile) return;

    let retryInProgress = false;
    let stopped = false;
    const retryOutbox = async () => {
      if (retryInProgress || stopped) return;
      retryInProgress = true;
      try {
        const pending = await listPendingEncryptedMessages();
        if (!stopped && pending.length) await flushPendingEncryptedMessages();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/secure messaging is not ready|protocol adapter is not enabled/i.test(message)) {
          console.warn("ChitChat could not retry pending encrypted messages.", message);
        }
      } finally {
        retryInProgress = false;
      }
    };

    void retryOutbox();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void retryOutbox();
    });
    return () => {
      stopped = true;
      subscription.remove();
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile || !supabase) {
      setSecuritySettingsReady(true);
      setSecuritySettingsAccountId(null);
      setAppLockEnabled(false);
      setAppLocked(false);
      return;
    }
    let active = true;
    void loadUserSettings().then(saved => {
      if (!active) return;
      setThemeMode(saved.theme);
      setAccentPalette((Object.prototype.hasOwnProperty.call(accentPalettes, saved.accent_palette) ? saved.accent_palette : "violet") as AccentPalette);
      void savePreference("appearance.theme", saved.theme);
      void savePreference("appearance.accentPalette", (Object.prototype.hasOwnProperty.call(accentPalettes, saved.accent_palette) ? saved.accent_palette : "violet") as AccentPalette);
      setAutoReveal(saved.auto_reveal_secrets);
      setShowReadReceipts(saved.show_read_receipts);
      setShowOnlineStatus(saved.show_online_status);
      setShowTypingStatus(saved.show_typing_status);
      setShowLastSeen(saved.show_last_seen);
      setNotificationPreview(saved.notification_preview);
      setAppLockEnabled(saved.app_lock_enabled);
      setAppLocked(saved.app_lock_enabled);
      setAppLockError("");
    }).catch(error => {
      if (active) {
        setSettingsError(error instanceof Error ? error.message : "Could not load account settings.");
        setAppLockEnabled(true);
        setAppLocked(true);
      }
    }).finally(() => {
      if (active) {
        setSecuritySettingsAccountId(profile.id);
        setSecuritySettingsReady(true);
      }
    });
    return () => { active = false; };
  }, [profile?.id]);

  async function unlockApplication(): Promise<boolean> {
    if (appLockAuthInProgressRef.current) return false;
    appLockAuthInProgressRef.current = true;
    setAppLockError("");
    try {
      await authenticateForAppLock();
      setAppLocked(false);
      return true;
    } catch (error) {
      setAppLockError(error instanceof Error ? error.message : "Device authentication failed.");
      return false;
    } finally {
      appLockAuthInProgressRef.current = false;
    }
  }

  async function updateAppLock(next: boolean) {
    if (!profile) return;
    setSettingsError("");
    setAppLockError("");
    try {
      if (next) {
        await authenticateForAppLock("Confirm ChitChat app lock");
        await saveUserSettings({ app_lock_enabled: true });
        setAppLockEnabled(true);
        setAppLocked(false);
      } else {
        await saveUserSettings({ app_lock_enabled: false, biometric_unlock_enabled: false });
        setAppLockEnabled(false);
        setAppLocked(false);
      }
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Could not update app lock.");
    }
  }

  useEffect(() => {
    if (!profile || !appLockEnabled) return;
    const subscription = AppState.addEventListener("change", state => {
      setAppState(state);
      if (state !== "active") setAppLocked(true);
    });
    return () => subscription.remove();
  }, [profile?.id, appLockEnabled]);

  useEffect(() => {
    if (!profile || !appLockEnabled || !appLocked || !securitySettingsReady || appState !== "active") return;
    void unlockApplication();
  }, [profile?.id, appLockEnabled, appLocked, securitySettingsReady, appState]);

  useEffect(() => {
    if (!profile || !supabase) return;
    let active = true;
    let tokenSubscription: { remove: () => void } | null = null;
    void syncPushRegistrationIfGranted().then(enabled => {
      if (!active) return;
      setPushEnabled(enabled);
      if (enabled) {
        try {
          tokenSubscription = listenForPushTokenChanges();
          pushSubscriptionRef.current = tokenSubscription;
        } catch (error) {
          setPushError(error instanceof Error ? error.message : "Could not watch push token changes.");
        }
      }
    }).catch(error => {
      if (active) setPushError(error instanceof Error ? error.message : "Could not sync push notifications.");
    });
    return () => {
      active = false;
      pushSubscriptionRef.current?.remove();
      pushSubscriptionRef.current = null;
    };
  }, [profile?.id]);

  async function updateNotificationPreview(next: "none" | "sender") {
    const previous = notificationPreview;
    setNotificationPreview(next);
    setSettingsError("");
    if (!profile) return;
    try {
      await saveUserSettings({ notification_preview: next });
    } catch (error) {
      setNotificationPreview(previous);
      setSettingsError(error instanceof Error ? error.message : "Could not save notification privacy.");
    }
  }

  async function togglePushNotifications() {
    setPushBusy(true);
    setPushError("");
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        pushSubscriptionRef.current?.remove();
        pushSubscriptionRef.current = null;
        setPushEnabled(false);
      } else {
        await enablePushNotifications();
        pushSubscriptionRef.current?.remove();
        pushSubscriptionRef.current = listenForPushTokenChanges();
        setPushEnabled(true);
      }
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Could not update notification settings.");
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    if (!profile || !supabase) return;
    let active = true;
    setConversationLoadError("");
    void Promise.all([loadMyConversations(), loadConversationSettings()]).then(([rows, settings]) => {
      if (!active) return;
      const settingsByConversation = new Map(settings.map(setting => [setting.conversation_id, setting]));
      const loadedChats: Chat[] = rows.map(row => {
        const displayName = row.conversation_kind === "group"
          ? row.conversation_title ?? "Group conversation"
          : row.other_display_name ?? row.other_username ?? "Conversation";
        const initials = displayName.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
        const preference = settingsByConversation.get(row.conversation_id);
        return {
          id: row.conversation_id,
          name: displayName,
          initials: initials || "CH",
          color: "#D8D1FF",
          message: "Secure messaging setup in progress",
          time: new Date(row.updated_at).toLocaleDateString(),
          unread: 0,
          isReal: true,
          conversationId: row.conversation_id,
          isGroup: row.conversation_kind === "group",
          remoteUserId: row.other_user_id ?? undefined,
          pinnedAt: preference?.pinned_at ?? null,
          mutedUntil: preference?.muted_until ?? null,
          archivedAt: preference?.archived_at ?? null,
          hiddenAt: preference?.hidden_at ?? null,
        };
      });
      setChats(loadedChats);
    }).catch(caught => {
      if (active) setConversationLoadError(caught instanceof Error ? caught.message : "Could not load conversations and their preferences.");
    });
    return () => { active = false; };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile || !supabase || !activeChat?.isReal || !activeChat.conversationId) return;
    let active = true;
    let presence: ReturnType<typeof subscribeToConversationPresence> | null = null;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active || error || !data.user) return;
      presence = subscribeToConversationPresence(
        activeChat.conversationId!,
        data.user.id,
        members => {
          const others = Object.values(members).flat().filter(member => member.user_id !== data.user!.id);
          setActiveChat(current => current?.conversationId === activeChat.conversationId
            ? { ...current, online: others.some(member => member.online) }
            : current);
        },
        typing => setTypingUserId(typing.typing ? typing.userId : null),
        { showOnlineStatus, showTypingStatus, showLastSeen },
      );
      presenceRef.current = presence;
    });
    return () => {
      active = false;
      setTypingUserId(null);
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
      presenceRef.current = null;
      if (presence) void presence.stop();
    };
  }, [profile?.id, activeChat?.conversationId, activeChat?.isReal, showOnlineStatus, showTypingStatus, showLastSeen]);

  useEffect(() => {
    if (!openConversationId) return;
    const target = chats.find(chat => chat.conversationId === openConversationId);
    if (!target) return;
    setTab("Chats");
    setConversationListMode(target.archivedAt ? "archived" : target.hiddenAt ? "hidden" : "inbox");
    setActiveChat(target);
    onNotificationHandled?.();
  }, [openConversationId, chats, onNotificationHandled]);

  useEffect(() => {
    setDiscoveryEnabled(profile?.discoverable ?? false);
    setDiscoveryError("");
  }, [profile?.id, profile?.discoverable]);

  async function sendAccountPasswordReset() {
    if (!profile || !supabase || passwordResetBusy) return;
    setPasswordResetBusy(true);
    setAccountSecurityMessage("");
    try {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!data.user?.email) throw new Error("This account does not have a recovery email address.");
      const { error } = await supabase.auth.resetPasswordForEmail(data.user.email, {
        redirectTo: ExpoLinking.createURL("auth/callback"),
      });
      if (error) throw error;
      setAccountSecurityMessage("Password reset link sent. Open the email on this device to choose a new password.");
    } catch (caught) {
      setAccountSecurityMessage(caught instanceof Error ? caught.message : "Could not send the password reset link.");
    } finally {
      setPasswordResetBusy(false);
    }
  }

  async function toggleDiscovery() {
    if (!profile || !supabase || discoveryBusy) return;
    const previousValue = discoveryEnabled;
    const nextValue = !previousValue;
    setDiscoveryEnabled(nextValue);
    setDiscoveryBusy(true);
    setDiscoveryError("");
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({ discoverable: nextValue })
        .eq("id", profile.id)
        .select("id, username, display_name, bio, avatar_path, discoverable")
        .single();
      if (error) throw error;
      onProfileUpdated?.(data as ChitChatProfile);
    } catch (caught) {
      setDiscoveryEnabled(previousValue);
      setDiscoveryError(caught instanceof Error ? caught.message : "Could not update username discovery.");
    } finally {
      setDiscoveryBusy(false);
    }
  }

  async function updateConversationPreference(
    chat: Chat,
    changes: Partial<Pick<ConversationSettings, "pinned_at" | "muted_until" | "archived_at" | "hidden_at">>,
  ) {
    if (!chat.conversationId) return;
    try {
      const saved = await saveConversationSettings(chat.conversationId, changes);
      const updated = {
        pinnedAt: saved.pinned_at,
        mutedUntil: saved.muted_until,
        archivedAt: saved.archived_at,
        hiddenAt: saved.hidden_at,
      };
      setChats(current => current.map(item => item.conversationId === chat.conversationId ? { ...item, ...updated } : item));
      setActiveChat(current => current?.conversationId === chat.conversationId ? { ...current, ...updated } : current);
    } catch (error) {
      Alert.alert("Could not update conversation", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function showConversationActions(chat: Chat) {
    if (!chat.isReal || !chat.conversationId) {
      Alert.alert("Demo conversation", "Conversation actions are available after you sign in.");
      return;
    }
    const pinned = Boolean(chat.pinnedAt);
    const muted = Boolean(chat.mutedUntil && Date.parse(chat.mutedUntil) > Date.now());
    const archived = Boolean(chat.archivedAt);
    const hidden = Boolean(chat.hiddenAt);
    Alert.alert(chat.name, "Manage this conversation on your account.", [
      {
        text: pinned ? "Unpin" : "Pin to top",
        onPress: () => void updateConversationPreference(chat, { pinned_at: pinned ? null : new Date().toISOString() }),
      },
      {
        text: "More options",
        onPress: () => Alert.alert(chat.name, "Additional conversation controls.", [
          {
            text: muted ? "Unmute" : "Mute for 8 hours",
            onPress: () => void updateConversationPreference(chat, { muted_until: muted ? null : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() }),
          },
          {
            text: "Manage inbox",
            onPress: () => Alert.alert(chat.name, "Choose where this conversation appears.", [
              {
                text: archived ? "Move to inbox" : "Archive",
                onPress: () => void updateConversationPreference(chat, { archived_at: archived ? null : new Date().toISOString() }),
              },
              {
                text: hidden ? "Unhide conversation" : "Hide from inbox",
                onPress: () => void updateConversationPreference(chat, { hidden_at: hidden ? null : new Date().toISOString() }),
              },
              { text: "Cancel", style: "cancel" },
            ]),
          },
          { text: "Cancel", style: "cancel" },
        ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function showReportReasons(chat: Chat) {
    if (!chat.isReal || !chat.conversationId) return;
    setReportingChat(chat);
  }

  function showBlockConfirmation(chat: Chat) {
    if (!chat.remoteUserId) return;
    Alert.alert(
      "Block this account?",
      `You will not find or receive new direct messages from @${chat.name}. You can unblock them later in Settings.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => {
            const targetUserId = chat.remoteUserId!;
            void blockUser(targetUserId).then(() => {
              setChats(old => old.filter(item => item.remoteUserId !== targetUserId));
              setActiveChat(null);
            }).catch(error => {
              Alert.alert("Could not block account", error instanceof Error ? error.message : "Please try again.");
            });
          },
        },
      ],
    );
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!activeChat?.isReal || !presenceRef.current) return;
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    void presenceRef.current.setTyping(Boolean(value.trim())).catch(error => {
      console.warn("Could not publish typing state.", error);
    });
    if (value.trim()) {
      typingStopTimerRef.current = setTimeout(() => {
        typingStopTimerRef.current = null;
        void presenceRef.current?.setTyping(false).catch(error => {
          console.warn("Could not clear typing state.", error);
        });
      }, 1600);
    }
  }

  function sendMessage() {
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = null;
    void presenceRef.current?.setTyping(false).catch(() => undefined);
    const value = draft.trim();
    if (!value || !activeChat || activeChat.isReal) return;
    const sentAt = new Date().toISOString();
    setDemoMessagesByChat(current => ({
      ...current,
      [activeChat.id]: [
        ...(current[activeChat.id] ?? seedMessages),
        {
          id: sentAt,
          mine: true,
          text: value,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          secret: draftSecret,
        },
      ],
    }));
    setChats(current => current.map(chat => chat.id === activeChat.id
      ? { ...chat, message: draftSecret ? "✦ A concealed message" : value, time: "now", secret: draftSecret }
      : chat));
    setDraft("");
    setDraftSecret(false);
  }

  const Header = ({ title, subtitle, back, newAction, action }: { title: string; subtitle?: string; back?: () => void; newAction?: () => void; action?: { label: string; onPress: () => void } }) => (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {back ? <Pressable onPress={back} style={styles.backButton}><Text style={{ color: c.text, fontSize: 25 }}>‹</Text></Pressable> : null}
        <View>
          <Text style={[styles.brand, { color: c.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: c.muted }]}>{subtitle}</Text> : null}
        </View>
      </View>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={{ color: action.label === "Block" ? "#B42318" : accentColor, fontSize: 12, fontWeight: "800" }}>{action.label}</Text>
        </Pressable>
      ) : !back && newAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel="New conversation" style={[styles.newButton, { backgroundColor: accentColor }]} onPress={newAction}>
          <Text style={styles.newButtonText}>＋</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if ((profile && !securitySettingsReady) || securitySettingsAccountId !== (profile?.id ?? null)) {
    return (
      <AnimatedSafeAreaView key="security-settings-loading" style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={accentColor} />
        <Text style={{ color: c.muted, fontSize: 12, marginTop: 10 }}>Checking your security settings</Text>
      </AnimatedSafeAreaView>
    );
  }

  if (profile && appLockEnabled && appLocked) {
    return (
      <AnimatedSafeAreaView key="app-lock" style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: spacing.xl }}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <View style={{ width: 66, height: 66, borderRadius: 23, backgroundColor: accentColor, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#FFFFFF", fontSize: 36, fontWeight: "900", marginTop: -4 }}>c.</Text>
        </View>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: "800", marginTop: spacing.xl }}>ChitChat is locked</Text>
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: spacing.sm, maxWidth: 290 }}>
          Authenticate with your device to open your conversations.
        </Text>
        {appLockError ? <Text accessibilityRole="alert" style={{ color: "#B42318", fontSize: 12, textAlign: "center", marginTop: spacing.lg }}>{appLockError}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => void unlockApplication()} style={{ backgroundColor: accentColor, minHeight: 48, paddingHorizontal: 30, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginTop: spacing.xl }}>
          <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "800" }}>Unlock ChitChat</Text>
        </Pressable>
        {onSignOut ? <Pressable accessibilityRole="button" onPress={onSignOut} style={{ padding: 16, marginTop: spacing.sm }}><Text style={{ color: c.muted, fontSize: 12 }}>Sign out</Text></Pressable> : null}
      </AnimatedSafeAreaView>
    );
  }

  if (showBlockedUsers) {
    return (
      <AnimatedSafeAreaView key="blocked-users" style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <BlockedUsersScreen onBack={() => setShowBlockedUsers(false)} />
      </AnimatedSafeAreaView>
    );
  }

  if (showScheduledMessages && profile) {
    return (
      <AnimatedSafeAreaView key="scheduled-messages" style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <ScheduledMessagesScreen
          dark={dark}
          accentColor={accentColor}
          onBack={() => setShowScheduledMessages(false)}
        />
      </AnimatedSafeAreaView>
    );
  }

  if (showProfileEditor && profile) {
    return (
      <AnimatedSafeAreaView key="profile-editor" style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <EditProfileScreen
          profile={profile}
          onBack={() => setShowProfileEditor(false)}
          onSaved={updated => {
            onProfileUpdated?.(updated);
            setShowProfileEditor(false);
          }}
        />
      </AnimatedSafeAreaView>
    );
  }

  if (showGroupManagement && activeChat?.isGroup && activeChat.conversationId) {
    return (
      <AnimatedSafeAreaView key="group-management" style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <GroupManagementScreen
          conversationId={activeChat.conversationId}
          initialTitle={activeChat.name}
          onBack={() => setShowGroupManagement(false)}
          onLeft={() => {
            setShowGroupManagement(false);
            setActiveChat(null);
            setChats(current => current.filter(chat => chat.conversationId !== activeChat.conversationId));
          }}
          onRenamed={title => {
            setActiveChat(current => current ? { ...current, name: title } : current);
            setChats(current => current.map(chat => chat.conversationId === activeChat.conversationId ? { ...chat, name: title } : chat));
          }}
        />
      </AnimatedSafeAreaView>
    );
  }

  if (showGroupCreation) {
    return (
      <AnimatedSafeAreaView key="group-creation" style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <GroupCreationScreen
          onBack={() => setShowGroupCreation(false)}
          onCreated={(conversationId, title) => {
            const initials = title.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
            const newChat: Chat = {
              id: conversationId,
              name: title,
              initials: initials || "GR",
              color: "#D8D1FF",
              message: "Group created",
              time: "now",
              unread: 0,
              isReal: true,
              isGroup: true,
              conversationId,
            };
            setChats(old => [newChat, ...old.filter(chat => chat.conversationId !== conversationId)]);
            setActiveChat(newChat);
            setShowGroupCreation(false);
          }}
        />
      </AnimatedSafeAreaView>
    );
  }

  if (showNewChat) {
    return (
      <AnimatedSafeAreaView key="new-chat" style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <NewChatScreen
          hasAccount={Boolean(profile)}
          onBack={() => setShowNewChat(false)}
          onSignIn={() => { setShowNewChat(false); onExitDemo?.(); }}
          onConversationCreated={(conversationId: string, person: DiscoverableProfile) => {
            const initials = person.display_name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
            const newChat: Chat = {
              id: conversationId,
              name: person.display_name,
              initials,
              color: "#D8D1FF",
              message: "New conversation",
              time: "now",
              unread: 0,
              isReal: true,
              conversationId,
              remoteUserId: person.id,
            };
            setChats(old => [newChat, ...old.filter(chat => chat.remoteUserId !== person.id && chat.conversationId !== conversationId)]);
            setActiveChat(newChat);
            setShowNewChat(false);
          }}
        />
      </AnimatedSafeAreaView>
    );
  }

  if (activeChat) {
    return (
      <AnimatedSafeAreaView key="conversation" style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <Header
          title={activeChat.name}
          subtitle={typingUserId ? "typing…" : activeChat.isGroup ? "group conversation" : activeChat.online ? "online now" : showLastSeen ? "offline" : "status hidden"}
          back={() => { setReportingChat(null); setActiveChat(null); }}
          action={activeChat.isGroup ? {
            label: "Options",
            onPress: () => Alert.alert(activeChat.name, "Group conversation controls.", [
              { text: "Manage members", onPress: () => setShowGroupManagement(true) },
              { text: "Report group", onPress: () => showReportReasons(activeChat) },
              { text: "Cancel", style: "cancel" },
            ]),
          } : activeChat.isReal && activeChat.remoteUserId ? {
            label: "More",
            onPress: () => Alert.alert(activeChat.name, "Account controls.", [
              { text: "Report account", onPress: () => showReportReasons(activeChat) },
              { text: "Block account", style: "destructive", onPress: () => showBlockConfirmation(activeChat) },
              { text: "Cancel", style: "cancel" },
            ]),
          } : undefined}
        />
        <View style={[styles.encryptionNote, { backgroundColor: activeChat.isReal ? (dark ? "#282342" : "#EEEAFE") : (dark ? "#202B35" : "#EAF6EF") }]}>
          <Text style={{ color: activeChat.isReal ? (dark ? "#D8D0FF" : "#6559A6") : (dark ? "#B8E8CE" : "#327653"), fontSize: 11, textAlign: "center" }}>
            {activeChat.isReal ? "Conversation created. Sending is paused until end-to-end encryption is ready." : "Demo conversation. Messages are local sample data and are not sent or encrypted."}
          </Text>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
          <ScrollView contentContainerStyle={styles.messageList}>
            {activeChat.isReal ? (
              <View style={{ alignItems: "center", paddingHorizontal: 24, paddingVertical: 28 }}>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: "800" }}>Conversation is ready</Text>
                <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7 }}>ChitChat will enable message sending here after device keys and end-to-end encryption are implemented. No plaintext message has been sent.</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.dayLabel, { color: c.muted }]}>TODAY</Text>
                {activeMessages.map(message => (
              <View key={message.id} style={[styles.messageRow, message.mine ? styles.myRow : styles.theirRow]}>
                <View style={[styles.bubble, message.mine ? styles.myBubble : [styles.theirBubble, { backgroundColor: c.surface }]]}>
                  {message.secret ? <SecretReveal text={message.text} autoReveal={autoReveal} dark={dark} accentColor={accentColor} /> : <Text selectable style={[styles.messageText, { color: message.mine ? "#FFFFFF" : c.text }]}>{message.text}</Text>}
                  <Text style={[styles.messageTime, { color: message.mine ? "#E7E2FF" : c.muted }]}>{message.time}  {message.mine ? "✓✓" : ""}</Text>
                </View>
              </View>
                ))}
              </>
            )}
          </ScrollView>
          {activeChat.isReal ? (
            <View style={[styles.composer, { backgroundColor: c.surface, borderTopColor: c.line }]}>
              <Text style={{ color: c.muted, fontSize: 12, textAlign: "center", flex: 1 }}>Secure messaging is not enabled yet.</Text>
            </View>
          ) : (
            <View style={[styles.composer, { backgroundColor: c.surface, borderTopColor: c.line }]}>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Conceal this message"
                accessibilityState={{ checked: draftSecret }}
                onPress={() => setDraftSecret(value => !value)}
                style={[styles.secretToggle, draftSecret && styles.secretToggleOn]}
              >
                <Text style={[styles.secretToggleText, draftSecret && styles.secretToggleTextOn]}>✦</Text>
              </Pressable>
              <TextInput value={draft} onChangeText={handleDraftChange} onBlur={() => { if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current); typingStopTimerRef.current = null; void presenceRef.current?.setTyping(false).catch(() => undefined); }} placeholder={draftSecret ? "Write a secret message..." : "Write a message..."} placeholderTextColor={c.muted} style={[styles.input, { backgroundColor: c.raised, color: c.text }]} onSubmitEditing={sendMessage} returnKeyType="send" />
              <Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!draft.trim()} onPress={sendMessage} style={[styles.sendButton, !draft.trim() && { opacity: 0.55 }]}><Text style={{ color: "#FFFFFF", fontSize: 18 }}>➤</Text></Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
        <ReportConversationModal
          visible={Boolean(reportingChat)}
          conversationId={reportingChat?.conversationId ?? ""}
          targetUserId={reportingChat?.isGroup ? null : reportingChat?.remoteUserId ?? null}
          targetLabel={reportingChat?.isGroup ? "group" : "account"}
          dark={dark}
          accentColor={accentColor}
          onClose={() => setReportingChat(null)}
          onSubmitted={() => {
            setReportingChat(null);
            Alert.alert("Report submitted", "Your report was sent privately for review.");
          }}
        />
      </AnimatedSafeAreaView>
    );
  }

  return (
    <AnimatedSafeAreaView key="main-tabs" style={[styles.safe, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      <Header title="ChitChat" subtitle="A little more personal." newAction={isSupabaseConfigured ? () => setShowNewChat(true) : undefined} />
      <ScreenTransition key={`${tab}:${conversationListMode}`}>
      {tab === "Chats" ? (
        <>
          <View style={[styles.searchBox, { backgroundColor: c.surface }]}>
            <Text style={{ color: c.muted, fontSize: 17 }}>⌕</Text>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search conversations" placeholderTextColor={c.muted} style={[styles.searchInput, { color: c.text }]} />
          </View>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>
              {conversationListMode === "archived" ? "Archived" : conversationListMode === "hidden" ? "Hidden" : "Messages"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              {([
                ["inbox", "Inbox"], ["archived", "Archived"], ["hidden", "Hidden"],
              ] as const).map(([mode, label]) => {
                const selected = conversationListMode === mode;
                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setConversationListMode(mode)}
                    style={{ paddingVertical: 6, paddingHorizontal: 7, borderRadius: radius.sm, backgroundColor: selected ? (dark ? "#302A55" : "#EEEAFE") : "transparent" }}
                  >
                    <Text style={{ color: selected ? accentColor : c.muted, fontSize: 10, fontWeight: "800" }}>{label}</Text>
                  </Pressable>
                );
              })}
              <Text style={[styles.countText, { color: c.muted }]}>{filteredChats.length}</Text>
            </View>
          </View>
          <FlatList
            data={filteredChats}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 110 }}
            ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: c.line }]} />}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.name}
                accessibilityHint="Open conversation. Long press for pin, mute, and archive options."
                onLongPress={() => showConversationActions(item)}
                onPress={() => {
                  setActiveChat(item);
                }}
                style={styles.chatRow}
              >
                <Avatar initials={item.initials} color={item.color} online={item.online} />
                <View style={styles.chatDetails}>
                  <View style={styles.chatTop}>
                    <Text style={[styles.chatName, { color: c.text }]}>{item.name}</Text>
                    <Text style={[styles.chatTime, { color: item.unread ? accentColor : c.muted }]}>{item.time}</Text>
                  </View>
                  <View style={styles.chatBottom}>
                    <Text numberOfLines={1} style={[styles.preview, { color: c.muted }]}>{item.secret ? "✦  A concealed message" : item.message}</Text>
                    {item.unread > 0 ? <View style={styles.unread}><Text style={styles.unreadText}>{item.unread}</Text></View> : null}
                  </View>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={{ alignItems: "center", paddingHorizontal: 24, marginTop: 48 }}>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: "800" }}>
                  {search ? "No matching conversations" : conversationListMode === "archived" ? "No archived conversations" : conversationListMode === "hidden" ? "No hidden conversations" : "Your inbox is empty"}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6 }}>
                  {conversationListMode === "archived"
                    ? "Conversations you archive will appear here. You can move them back to your inbox."
                    : conversationListMode === "hidden"
                      ? "Hidden conversations stay out of your inbox until you restore them."
                      : "Start with a username. ChitChat only returns profiles that allow discovery."}
                </Text>
                {conversationListMode === "inbox" ? (
                  <Pressable accessibilityRole="button" onPress={() => setShowNewChat(true)} style={{ backgroundColor: accentColor, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.md, marginTop: 16 }}>
                    <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12 }}>Find someone</Text>
                  </Pressable>
                ) : null}
                {conversationLoadError ? <Text accessibilityRole="alert" style={{ color: "#B42318", fontSize: 11, textAlign: "center", marginTop: 12 }}>{conversationLoadError}</Text> : null}
              </View>
            }
          />
        </>
      ) : tab === "Calls" ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>◌</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>Your calls, in one place</Text>
          <Text style={[styles.emptyCopy, { color: c.muted }]}>Voice and video calling are planned for a later release.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
          {profile ? (
            <View style={[styles.settingCard, { backgroundColor: c.surface, marginBottom: spacing.md }]}>
              <View style={styles.settingCopy}>
                <Text style={[styles.settingTitle, { color: c.text }]}>Username discovery</Text>
                <Text style={[styles.settingHint, { color: c.muted }]}>Let people find you using @{profile.username}.</Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: discoveryEnabled }}
                onPress={toggleDiscovery}
                disabled={discoveryBusy}
                style={[styles.toggle, discoveryEnabled && styles.toggleOn, discoveryBusy && { opacity: 0.55 }]}
              >
                <View style={[styles.toggleKnob, discoveryEnabled && styles.toggleKnobOn]} />
              </Pressable>
            </View>
          ) : null}
          {discoveryError ? <Text accessibilityRole="alert" style={{ color: "#B42318", fontSize: 11, marginBottom: spacing.md }}>{discoveryError}</Text> : null}
          {profile ? (
            <View style={[styles.settingCard, { backgroundColor: c.surface, marginBottom: spacing.xl }]}>
              <Pressable accessibilityRole="button" onPress={() => setShowProfileEditor(true)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
                <Avatar initials={profile.display_name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase()} color="#D8D1FF" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.settingTitle, { color: c.text }]}>{profile.display_name}</Text>
                  <Text style={[styles.settingHint, { color: c.muted }]}>@{profile.username}</Text>
                  <Text style={{ color: accentColor, fontSize: 10, fontWeight: "800", marginTop: 5 }}>Edit profile</Text>
                </View>
              </Pressable>
              {onSignOut ? (
                <Pressable accessibilityRole="button" onPress={onSignOut} style={{ padding: 8 }}>
                  <Text style={{ color: accentColor, fontSize: 12, fontWeight: "800" }}>Sign out</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={[styles.infoCard, { backgroundColor: dark ? "#202B35" : "#EAF6EF", marginBottom: spacing.xl }]}>
              <Text style={{ color: dark ? "#B8E8CE" : "#327653", fontWeight: "800", fontSize: 13 }}>Demo mode</Text>
              <Text style={{ color: dark ? "#B8E8CE" : "#327653", fontSize: 12, lineHeight: 18, marginTop: 5 }}>These conversations use local sample data. Sign in to discover people and create conversations. Message delivery is still in development.</Text>
              {onExitDemo ? (
                <Pressable accessibilityRole="button" onPress={onExitDemo} style={{ alignSelf: "flex-start", paddingTop: 12 }}>
                  <Text style={{ color: accentColor, fontSize: 12, fontWeight: "800" }}>Sign in to your account</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          {profile ? (
            <View style={[styles.settingCard, { backgroundColor: c.surface, marginBottom: spacing.md }]}>
              <View style={styles.settingCopy}>
                <Text style={[styles.settingTitle, { color: c.text }]}>Password and sign-in</Text>
                <Text style={[styles.settingHint, { color: c.muted }]}>Send a secure password reset link to your account email.</Text>
                {accountSecurityMessage ? <Text accessibilityRole="alert" style={{ color: accountSecurityMessage.startsWith("Password reset link sent") ? "#167A55" : "#B42318", fontSize: 11, lineHeight: 16, marginTop: 7 }}>{accountSecurityMessage}</Text> : null}
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={passwordResetBusy}
                onPress={() => void sendAccountPasswordReset()}
                style={[styles.smallAction, { backgroundColor: accentColor }, passwordResetBusy && { opacity: 0.55 }]}
              >
                {passwordResetBusy
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "800" }}>Send link</Text>}
              </Pressable>
            </View>
          ) : null}
          {profile ? (
            <Pressable accessibilityRole="button" onPress={() => setShowGroupCreation(true)} style={[styles.settingCard, { backgroundColor: c.surface, marginBottom: spacing.md }]}>
              <View style={styles.settingCopy}>
                <Text style={[styles.settingTitle, { color: c.text }]}>Create a group</Text>
                <Text style={[styles.settingHint, { color: c.muted }]}>Start a group conversation with discoverable users.</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 22 }}>›</Text>
            </Pressable>
          ) : null}
          {profile ? (
            <Pressable accessibilityRole="button" onPress={() => setShowScheduledMessages(true)} style={[styles.settingCard, { backgroundColor: c.surface, marginBottom: spacing.md }]}>
              <View style={styles.settingCopy}>
                <Text style={[styles.settingTitle, { color: c.text }]}>Scheduled messages</Text>
                <Text style={[styles.settingHint, { color: c.muted }]}>Review or cancel pending scheduled sends.</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 22 }}>›</Text>
            </Pressable>
          ) : null}
          {profile ? (
            <Pressable accessibilityRole="button" onPress={() => setShowBlockedUsers(true)} style={[styles.settingCard, { backgroundColor: c.surface }]}>
              <View style={styles.settingCopy}>
                <Text style={[styles.settingTitle, { color: c.text }]}>Blocked accounts</Text>
                <Text style={[styles.settingHint, { color: c.muted }]}>Manage people you have blocked.</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 22 }}>›</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.sectionTitle, { color: c.text, marginBottom: spacing.lg }]}>Your experience</Text>
          <View style={[styles.settingCard, { backgroundColor: c.surface, flexDirection: "column", alignItems: "stretch" }]}>
            <Text style={[styles.settingTitle, { color: c.text }]}>Appearance</Text>
            <Text style={[styles.settingHint, { color: c.muted, marginBottom: spacing.md }]}>Choose system, light, or dark mode.</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {([{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }] as const).map(option => {
                const selected = themeMode === option.value;
                return (
                  <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                    disabled={!preferencesReady} onPress={() => void updateThemeMode(option.value)}
                    style={{ flex: 1, minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: selected ? accentColor : c.line, backgroundColor: selected ? (dark ? "#302A55" : "#EEEAFE") : c.raised, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: selected ? accentColor : c.text, fontSize: 12, fontWeight: "800" }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={[styles.settingCard, { backgroundColor: c.surface, flexDirection: "column", alignItems: "stretch" }]}>
            <Text style={[styles.settingTitle, { color: c.text }]}>Accent color</Text>
            <Text style={[styles.settingHint, { color: c.muted, marginBottom: spacing.md }]}>Pick the color used for key actions and highlights.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
              {([
                ["violet", "Violet"], ["ocean", "Ocean"], ["emerald", "Emerald"],
                ["rose", "Rose"], ["amber", "Amber"], ["graphite", "Graphite"],
              ] as const).map(([value, label]) => {
                const selected = accentPalette === value;
                return (
                  <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label}
                    accessibilityState={{ checked: selected }} onPress={() => void updateAccentPalette(value)}
                    style={{ width: 82, minHeight: 58, borderRadius: radius.md, borderWidth: selected ? 2 : 1,
                      borderColor: selected ? accentPalettes[value] : c.line, backgroundColor: c.raised,
                      alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <View style={{ width: 19, height: 19, borderRadius: 10, backgroundColor: accentPalettes[value] }} />
                    <Text style={{ color: c.text, fontSize: 10, fontWeight: "700" }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
            <View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: c.text }]}>Auto-reveal secrets</Text><Text style={[styles.settingHint, { color: c.muted }]}>Reveal received secret messages automatically</Text></View>
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: autoReveal, disabled: !preferencesReady }} disabled={!preferencesReady} onPress={toggleAutoReveal} style={[styles.toggle, autoReveal && styles.toggleOn, !preferencesReady && { opacity: 0.55 }]}><View style={[styles.toggleKnob, autoReveal && styles.toggleKnobOn]} /></Pressable>
          </View>
          {profile ? (
            <>
              <Text style={[styles.sectionTitle, { color: c.text, marginTop: spacing.lg, marginBottom: spacing.md }]}>Notifications</Text>
              <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
                <View style={styles.settingCopy}>
                  <Text style={[styles.settingTitle, { color: c.text }]}>Message notifications</Text>
                  <Text style={[styles.settingHint, { color: c.muted }]}>{pushEnabled ? "This device is registered for private message alerts." : "Receive a generic alert when a new message arrives."}</Text>
                </View>
                <Pressable accessibilityRole="button" disabled={pushBusy} onPress={() => void togglePushNotifications()} style={[styles.smallAction, { backgroundColor: accentColor }, pushBusy && { opacity: 0.55 }]}>
                  <Text style={styles.smallActionText}>{pushBusy ? "..." : pushEnabled ? "Turn off" : "Enable"}</Text>
                </Pressable>
              </View>
              {pushError ? <Text accessibilityRole="alert" style={{ color: "#B42318", fontSize: 11, marginBottom: spacing.md }}>{pushError}</Text> : null}
              <Text style={[styles.sectionTitle, { color: c.text, marginTop: spacing.lg, marginBottom: spacing.sm }]}>Notification privacy</Text>
              <View style={[styles.settingCard, { backgroundColor: c.surface, flexDirection: "column", alignItems: "stretch" }]}>
                <Text style={[styles.settingTitle, { color: c.text }]}>Who can appear in alerts?</Text>
                <Text style={[styles.settingHint, { color: c.muted, marginBottom: spacing.md }]}>Message text is never included in push notifications. This protects encrypted conversations on your lock screen.</Text>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {([{ value: "none", label: "Off" }, { value: "sender", label: "Sender only" }] as const).map(option => {
                    const selected = notificationPreview === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        onPress={() => void updateNotificationPreview(option.value)}
                        style={{ flex: 1, minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: selected ? accentColor : c.line, backgroundColor: selected ? (dark ? "#302A55" : "#EEEAFE") : c.raised, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }}
                      >
                        <Text style={{ color: selected ? accentColor : c.text, fontSize: 12, fontWeight: "800" }}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text style={[styles.sectionTitle, { color: c.text, marginTop: spacing.lg, marginBottom: spacing.md }]}>App security</Text>
              <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
                <View style={styles.settingCopy}>
                  <Text style={[styles.settingTitle, { color: c.text }]}>App lock</Text>
                  <Text style={[styles.settingHint, { color: c.muted }]}>Require your device authentication when ChitChat returns from the background. Uses biometrics where available, with device PIN or passcode fallback.</Text>
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: appLockEnabled }}
                  onPress={() => void updateAppLock(!appLockEnabled)}
                  style={[styles.toggle, appLockEnabled && styles.toggleOn]}
                >
                  <View style={[styles.toggleKnob, appLockEnabled && styles.toggleKnobOn]} />
                </Pressable>
              </View>
              <Text style={[styles.sectionTitle, { color: c.text, marginTop: spacing.lg, marginBottom: spacing.md }]}>Privacy controls</Text>
              <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
                <View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: c.text }]}>Read receipts</Text><Text style={[styles.settingHint, { color: c.muted }]}>Let people know when you have read their messages.</Text></View>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: showReadReceipts }} onPress={() => void updatePrivacySetting("show_read_receipts", !showReadReceipts)} style={[styles.toggle, showReadReceipts && styles.toggleOn]}><View style={[styles.toggleKnob, showReadReceipts && styles.toggleKnobOn]} /></Pressable>
              </View>
              <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
                <View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: c.text }]}>Online status</Text><Text style={[styles.settingHint, { color: c.muted }]}>Share when you are active in ChitChat.</Text></View>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: showOnlineStatus }} onPress={() => void updatePrivacySetting("show_online_status", !showOnlineStatus)} style={[styles.toggle, showOnlineStatus && styles.toggleOn]}><View style={[styles.toggleKnob, showOnlineStatus && styles.toggleKnobOn]} /></Pressable>
              </View>
              <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
                <View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: c.text }]}>Typing indicator</Text><Text style={[styles.settingHint, { color: c.muted }]}>Share when you are typing in a conversation.</Text></View>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: showTypingStatus }} onPress={() => void updatePrivacySetting("show_typing_status", !showTypingStatus)} style={[styles.toggle, showTypingStatus && styles.toggleOn]}><View style={[styles.toggleKnob, showTypingStatus && styles.toggleKnobOn]} /></Pressable>
              </View>
              <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
                <View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: c.text }]}>Last seen</Text><Text style={[styles.settingHint, { color: c.muted }]}>Share the last time you were active.</Text></View>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: showLastSeen }} onPress={() => {
                  const next = !showLastSeen;
                  setShowLastSeen(next);
                  void saveUserSettings({ show_last_seen: next }).catch(error => {
                    setShowLastSeen(!next);
                    setSettingsError(error instanceof Error ? error.message : "Could not save last-seen setting.");
                  });
                }} style={[styles.toggle, showLastSeen && styles.toggleOn]}><View style={[styles.toggleKnob, showLastSeen && styles.toggleKnobOn]} /></Pressable>
              </View>
            </>
          ) : null}
          {settingsError ? <Text accessibilityRole="alert" style={{ color: "#B42318", fontSize: 11, marginBottom: spacing.md }}>{settingsError}</Text> : null}
          <View style={[styles.infoCard, { backgroundColor: dark ? "#282342" : "#EEEAFE" }]}>
            <Text style={{ color: accentColor, fontWeight: "800", fontSize: 15 }}>Your privacy, your rules.</Text>
            <Text style={{ color: dark ? "#D8D0FF" : "#6559A6", lineHeight: 20, marginTop: 7, fontSize: 13 }}>Choose how secret messages appear. You can reveal them when you're ready, then hide them again.</Text>
          </View>
          <Text style={[styles.version, { color: c.muted }]}>ChitChat · Early preview · v0.2.0</Text>
        </ScrollView>
      )}
      </ScreenTransition>
      <View style={[styles.tabBar, { backgroundColor: c.surface, borderTopColor: c.line }]}>
        {(["Chats", "Calls", "Settings"] as const).map(item => (
          <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)} style={styles.tabItem}>
            <Text style={{ color: tab === item ? accentColor : c.muted, fontSize: 19 }}>{item === "Chats" ? "▤" : item === "Calls" ? "◔" : "⚙"}</Text>
            <Text style={{ color: tab === item ? accentColor : c.muted, fontSize: 11, fontWeight: tab === item ? "700" : "500", marginTop: 4 }}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </AnimatedSafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 76, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { fontSize: typeScale.heading, fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { fontSize: 12, marginTop: 1 },
  backButton: { width: 34, height: 42, justifyContent: "center" },
  newButton: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: accentColor, alignItems: "center", justifyContent: "center" },
  newButtonText: { color: "#FFFFFF", fontSize: 26, lineHeight: 29 },
  searchBox: { height: 48, marginHorizontal: spacing.lg, borderRadius: radius.md, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: 9 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  sectionHeading: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  countText: { fontSize: 12 },
  chatRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 13 },
  chatDetails: { flex: 1, minWidth: 0 },
  chatTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chatName: { fontSize: 15, fontWeight: "700" },
  chatTime: { fontSize: 11 },
  chatBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 5, gap: 8 },
  preview: { fontSize: 13, flex: 1 },
  unread: { minWidth: 19, height: 19, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: accentColor, alignItems: "center", justifyContent: "center" },
  unreadText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  separator: { height: 1, marginLeft: 65 },
  tabBar: { position: "absolute", bottom: 0, left: 0, right: 0, height: 76, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", paddingTop: 11, paddingBottom: 18 },
  tabItem: { alignItems: "center", flex: 1 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 42, paddingBottom: 70 },
  emptyIcon: { fontSize: 58, color: accentColor, marginBottom: 14 },
  emptyTitle: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  emptyCopy: { textAlign: "center", fontSize: 13, lineHeight: 20, marginTop: 8 },
  settingCard: { borderRadius: radius.lg, padding: spacing.lg, flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  smallAction: { minWidth: 76, minHeight: 36, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: accentColor, alignItems: "center", justifyContent: "center" },
  smallActionText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  settingCopy: { flex: 1, paddingRight: 12 },
  settingTitle: { fontSize: 14, fontWeight: "700" },
  settingHint: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  toggle: { width: 46, height: 27, borderRadius: radius.pill, backgroundColor: "#D5D9E0", padding: 3, justifyContent: "center" },
  toggleOn: { backgroundColor: accentColor },
  toggleKnob: { width: 21, height: 21, borderRadius: radius.pill, backgroundColor: "#FFFFFF" },
  toggleKnobOn: { alignSelf: "flex-end" },
  infoCard: { borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
  version: { textAlign: "center", fontSize: 11, marginTop: 30 },
  encryptionNote: { marginHorizontal: spacing.lg, padding: 9, borderRadius: radius.md, marginBottom: spacing.sm },
  messageList: { padding: spacing.lg, flexGrow: 1, justifyContent: "flex-end" },
  dayLabel: { textAlign: "center", fontSize: 10, fontWeight: "700", letterSpacing: 1.2, marginVertical: spacing.lg },
  messageRow: { flexDirection: "row", marginBottom: 12 },
  myRow: { justifyContent: "flex-end" },
  theirRow: { justifyContent: "flex-start" },
  bubble: { maxWidth: "84%", paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18 },
  myBubble: { backgroundColor: accentColor, borderBottomRightRadius: 5 },
  theirBubble: { borderBottomLeftRadius: 5 },
  messageText: { fontSize: 14, lineHeight: 21 },
  messageTime: { fontSize: 10, textAlign: "right", marginTop: 5 },
  composer: { minHeight: 68, paddingHorizontal: spacing.md, paddingVertical: 10, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  attachButton: { width: 34, alignItems: "center" },
  secretToggle: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: "#F0F1F5", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  secretToggleOn: { backgroundColor: "#EEEAFE", borderColor: "#DAD2FF" },
  secretToggleText: { color: "#89919E", fontSize: 19, fontWeight: "800" },
  secretToggleTextOn: { color: accentColor },
  input: { flex: 1, height: 44, borderRadius: radius.pill, paddingHorizontal: 16, fontSize: 14 },
  sendButton: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: accentColor, alignItems: "center", justifyContent: "center" }
});


function AppBootScreen() {
  return (
    <AnimatedSafeAreaView key="app-boot" style={{ flex: 1, backgroundColor: palette.paper, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#FFFFFF", fontSize: 32, fontWeight: "900", marginTop: -3 }}>c.</Text>
      </View>
      <ActivityIndicator color={palette.brand} style={{ marginTop: 22 }} />
      <Text style={{ color: palette.muted, marginTop: 10, fontSize: 12 }}>Preparing your private space</Text>
    </AnimatedSafeAreaView>
  );
}

function AuthProblemScreen({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return (
    <AnimatedSafeAreaView key="auth-problem" style={{ flex: 1, backgroundColor: palette.paper, justifyContent: "center", padding: 24 }}>
      <Text style={{ color: palette.ink, fontSize: 23, fontWeight: "800" }}>Account setup needs attention</Text>
      <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 20, marginTop: 10 }}>{message}</Text>
      <Text style={{ color: palette.inkSoft, fontSize: 12, lineHeight: 19, marginTop: 14 }}>Check docs/SUPABASE_SETUP.md in the ChitChat repository. The database schema must be installed and the profiles table exposed through the Supabase Data API.</Text>
      <Pressable accessibilityRole="button" onPress={onSignOut} style={{ backgroundColor: palette.brand, minHeight: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: 24 }}>
        <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>Sign out</Text>
      </Pressable>
    </AnimatedSafeAreaView>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [profile, setProfile] = useState<ChitChatProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [notificationConversationId, setNotificationConversationId] = useState<string | null>(null);
  const lastNotificationResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!lastNotificationResponse) return;
    const data = lastNotificationResponse.notification.request.content.data;
    if (typeof data?.conversation_id === "string") {
      setNotificationConversationId(data.conversation_id);
    }
    void Notifications.clearLastNotificationResponseAsync();
  }, [lastNotificationResponse]);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (mounted) {
        if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
        setSession(nextSession);
        if (!nextSession) {
          setProfile(null);
          setProfileError("");
          setPasswordRecovery(false);
        }
      }
    });

    const appStateSubscription = Platform.OS !== "web"
      ? AppState.addEventListener("change", state => {
          if (state === "active") supabase.auth.startAutoRefresh();
          else supabase.auth.stopAutoRefresh();
        })
      : null;
    if (Platform.OS !== "web") supabase.auth.startAutoRefresh();

    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      void completeAuthFromUrl(url);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.warn("ChitChat could not restore the auth session.", error);
      setSession(data.session);
      setAuthReady(true);
    }).catch(error => {
      if (!mounted) return;
      console.warn("ChitChat could not restore the auth session.", error);
      setAuthReady(true);
    });

    void Linking.getInitialURL().then(url => {
      if (url) return completeAuthFromUrl(url);
    }).catch(error => console.warn("ChitChat could not read the initial auth URL.", error));

    return () => {
      mounted = false;
      subscription.unsubscribe();
      linkSubscription.remove();
      appStateSubscription?.remove();
      if (Platform.OS !== "web") supabase.auth.stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user) {
      setProfile(null);
      setProfileError("");
      setProfileLoading(false);
      return;
    }

    let active = true;
    setProfileLoading(true);
    setProfileError("");
    void supabase
      .from("profiles")
      .select("id, username, display_name, bio, avatar_path, discoverable")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setProfileError(error.message);
          setProfile(null);
        } else {
          setProfile(data as ChitChatProfile | null);
        }
        setProfileLoading(false);
      });

    return () => { active = false; };
  }, [session?.user.id]);

  async function signOut() {
    try {
      await revokeCurrentPushRegistration();
    } catch (error) {
      console.warn("ChitChat could not revoke this device's push token before sign-out.", error);
    }
    if (supabase) await supabase.auth.signOut();
    setDemoMode(false);
    setProfile(null);
    setPasswordRecovery(false);
    setSession(null);
  }

  if (!isSupabaseConfigured) return <MainApp profile={null} />;
  if (demoMode) return <MainApp profile={null} onExitDemo={() => setDemoMode(false)} />;
  if (!authReady) return <AppBootScreen />;
  if (passwordRecovery && session?.user) {
    return <ScreenTransition key="password-recovery"><PasswordRecoveryScreen onDone={() => { void signOut(); }} /></ScreenTransition>;
  }
  if (profileLoading) return <AppBootScreen />;
  if (!session?.user) return <ScreenTransition key="authentication"><AuthScreen onContinueDemo={() => setDemoMode(true)} /></ScreenTransition>;
  if (profileError) return <AuthProblemScreen message={profileError} onSignOut={() => { void signOut(); }} />;
  if (!profile) return <ScreenTransition key="profile-setup"><ProfileSetupScreen user={session.user} onSaved={setProfile} onSignOut={() => { void signOut(); }} /></ScreenTransition>;
  return <MainApp profile={profile} onProfileUpdated={setProfile} onSignOut={() => { void signOut(); }} openConversationId={notificationConversationId} onNotificationHandled={() => setNotificationConversationId(null)} />
}
