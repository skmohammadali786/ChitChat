import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, AppState, Linking, SafeAreaView, View, Text, TextInput, Pressable, FlatList, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, StatusBar
} from "react-native";
import { Avatar } from "./src/components/Avatar";
import { SecretReveal } from "./src/components/SecretReveal";
import { palette, radius, spacing, typeScale } from "./src/theme/tokens";
import type { Session } from "@supabase/supabase-js";
import { AuthScreen } from "./src/features/auth/AuthScreen";
import { PasswordRecoveryScreen } from "./src/features/auth/PasswordRecoveryScreen";
import { ProfileSetupScreen } from "./src/features/auth/ProfileSetupScreen";
import { NewChatScreen } from "./src/features/messaging/NewChatScreen";
import type { DiscoverableProfile } from "./src/features/messaging/service";
import { completeAuthFromUrl } from "./src/features/auth/deepLinks";
import { isSupabaseConfigured, supabase, type ChitChatProfile } from "./src/lib/supabase";

type Chat = { id: string; name: string; initials: string; color: string; message: string; time: string; unread: number; online?: boolean; secret?: boolean; isReal?: boolean; conversationId?: string; remoteUserId?: string };
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
  { id: "m3", mine: false, text: "I have something for you 👀", time: "10:44", secret: true },
  { id: "m4", mine: true, text: "Now you have my attention.", time: "10:45" }
];

function MainApp({ profile, onSignOut, onExitDemo }: { profile?: ChitChatProfile | null; onSignOut?: () => void; onExitDemo?: () => void }) {
  const [tab, setTab] = useState<"Chats" | "Calls" | "Settings">("Chats");
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [showNewChat, setShowNewChat] = useState(false);
  const [discoveryEnabled, setDiscoveryEnabled] = useState(profile?.discoverable ?? false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [dark, setDark] = useState(false);
  const [autoReveal, setAutoReveal] = useState(false);
  const c = dark ? {
    bg: palette.darkBg, surface: palette.darkSurface, raised: palette.darkRaised,
    text: palette.darkText, muted: palette.darkMuted, line: palette.darkLine
  } : {
    bg: palette.paper, surface: palette.white, raised: "#F0F1F5",
    text: palette.ink, muted: palette.muted, line: palette.line
  };

  const filteredChats = useMemo(() => chats.filter(x => x.name.toLowerCase().includes(search.toLowerCase())), [chats, search]);

  useEffect(() => {
    setDiscoveryEnabled(profile?.discoverable ?? false);
    setDiscoveryError("");
  }, [profile?.id, profile?.discoverable]);

  async function toggleDiscovery() {
    if (!profile || !supabase) return;
    const nextValue = !discoveryEnabled;
    setDiscoveryEnabled(nextValue);
    setDiscoveryError("");
    const { error } = await supabase
      .from("profiles")
      .update({ discoverable: nextValue })
      .eq("id", profile.id);
    if (error) {
      setDiscoveryEnabled(!nextValue);
      setDiscoveryError(error.message);
    }
  }

  function sendMessage() {
    const value = draft.trim();
    if (!value) return;
    setMessages(old => [...old, { id: String(Date.now()), mine: true, text: value, time: "now" }]);
    setDraft("");
  }

  const Header = ({ title, subtitle, back, newAction }: { title: string; subtitle?: string; back?: () => void; newAction?: () => void }) => (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {back ? <Pressable onPress={back} style={styles.backButton}><Text style={{ color: c.text, fontSize: 25 }}>‹</Text></Pressable> : null}
        <View>
          <Text style={[styles.brand, { color: c.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: c.muted }]}>{subtitle}</Text> : null}
        </View>
      </View>
      {!back ? (
        <Pressable accessibilityRole="button" accessibilityLabel="New conversation" style={styles.newButton} onPress={newAction ?? (() => setSearch(""))}>
          <Text style={styles.newButtonText}>＋</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (showNewChat) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <NewChatScreen
          hasAccount={Boolean(profile)}
          onBack={() => setShowNewChat(false)}
          onSignIn={() => { setShowNewChat(false); onExitDemo?.(); }}
          onConversationCreated={(conversationId: string, person: DiscoverableProfile) => {
            const initials = person.display_name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
            setMessages([]);
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
      </SafeAreaView>
    );
  }

  if (activeChat) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <Header title={activeChat.name} subtitle={activeChat.online ? "online now" : "last seen recently"} back={() => setActiveChat(null)} />
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
                {messages.map(message => (
              <View key={message.id} style={[styles.messageRow, message.mine ? styles.myRow : styles.theirRow]}>
                <View style={[styles.bubble, message.mine ? styles.myBubble : [styles.theirBubble, { backgroundColor: c.surface }]]}>
                  {message.secret ? <SecretReveal text="I saved you the window seat. The view is beautiful, just like you said it would be." autoReveal={autoReveal} /> : <Text style={[styles.messageText, { color: message.mine ? "#FFFFFF" : c.text }]}>{message.text}</Text>}
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
              <Pressable style={styles.attachButton}><Text style={{ fontSize: 23, color: c.muted }}>＋</Text></Pressable>
              <TextInput value={draft} onChangeText={setDraft} placeholder="Write a message..." placeholderTextColor={c.muted} style={[styles.input, { backgroundColor: c.raised, color: c.text }]} onSubmitEditing={sendMessage} returnKeyType="send" />
              <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={sendMessage} style={styles.sendButton}><Text style={{ color: "#FFFFFF", fontSize: 18 }}>➤</Text></Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      <Header title="ChitChat" subtitle="A little more personal." newAction={() => setShowNewChat(true)} />
      {tab === "Chats" ? (
        <>
          <View style={[styles.searchBox, { backgroundColor: c.surface }]}>
            <Text style={{ color: c.muted, fontSize: 17 }}>⌕</Text>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search conversations" placeholderTextColor={c.muted} style={[styles.searchInput, { color: c.text }]} />
          </View>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Messages</Text>
            <Text style={[styles.countText, { color: c.muted }]}>{filteredChats.length} conversations</Text>
          </View>
          <FlatList
            data={filteredChats}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 110 }}
            ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: c.line }]} />}
            renderItem={({ item }) => (
              <Pressable onPress={() => {
                if (!item.isReal) setMessages(seedMessages);
                setActiveChat(item);
              }} style={styles.chatRow}>
                <Avatar initials={item.initials} color={item.color} online={item.online} />
                <View style={styles.chatDetails}>
                  <View style={styles.chatTop}>
                    <Text style={[styles.chatName, { color: c.text }]}>{item.name}</Text>
                    <Text style={[styles.chatTime, { color: item.unread ? palette.brand : c.muted }]}>{item.time}</Text>
                  </View>
                  <View style={styles.chatBottom}>
                    <Text numberOfLines={1} style={[styles.preview, { color: c.muted }]}>{item.secret ? "✦  A concealed message" : item.message}</Text>
                    {item.unread > 0 ? <View style={styles.unread}><Text style={styles.unreadText}>{item.unread}</Text></View> : null}
                  </View>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={{ color: c.muted, textAlign: "center", marginTop: 48 }}>No conversations found.</Text>}
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
                style={[styles.toggle, discoveryEnabled && styles.toggleOn]}
              >
                <View style={[styles.toggleKnob, discoveryEnabled && styles.toggleKnobOn]} />
              </Pressable>
            </View>
          ) : null}
          {discoveryError ? <Text accessibilityRole="alert" style={{ color: "#B42318", fontSize: 11, marginBottom: spacing.md }}>{discoveryError}</Text> : null}
          {profile ? (
            <View style={[styles.settingCard, { backgroundColor: c.surface, marginBottom: spacing.xl }]}>
              <Avatar initials={profile.display_name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase()} color="#D8D1FF" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.settingTitle, { color: c.text }]}>{profile.display_name}</Text>
                <Text style={[styles.settingHint, { color: c.muted }]}>@{profile.username}</Text>
              </View>
              {onSignOut ? (
                <Pressable accessibilityRole="button" onPress={onSignOut} style={{ padding: 8 }}>
                  <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "800" }}>Sign out</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={[styles.infoCard, { backgroundColor: dark ? "#202B35" : "#EAF6EF", marginBottom: spacing.xl }]}>
              <Text style={{ color: dark ? "#B8E8CE" : "#327653", fontWeight: "800", fontSize: 13 }}>Demo mode</Text>
              <Text style={{ color: dark ? "#B8E8CE" : "#327653", fontSize: 12, lineHeight: 18, marginTop: 5 }}>These conversations use local sample data. Sign in to discover people and create conversations. Message delivery is still in development.</Text>
              {onExitDemo ? (
                <Pressable accessibilityRole="button" onPress={onExitDemo} style={{ alignSelf: "flex-start", paddingTop: 12 }}>
                  <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "800" }}>Sign in to your account</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          <Text style={[styles.sectionTitle, { color: c.text, marginBottom: spacing.lg }]}>Your experience</Text>
          <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
            <View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: c.text }]}>Dark appearance</Text><Text style={[styles.settingHint, { color: c.muted }]}>Use a darker color palette</Text></View>
            <Pressable onPress={() => setDark(!dark)} style={[styles.toggle, dark && styles.toggleOn]}><View style={[styles.toggleKnob, dark && styles.toggleKnobOn]} /></Pressable>
          </View>
          <View style={[styles.settingCard, { backgroundColor: c.surface }]}>
            <View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: c.text }]}>Auto-reveal secrets</Text><Text style={[styles.settingHint, { color: c.muted }]}>Reveal received secret messages automatically</Text></View>
            <Pressable onPress={() => setAutoReveal(!autoReveal)} style={[styles.toggle, autoReveal && styles.toggleOn]}><View style={[styles.toggleKnob, autoReveal && styles.toggleKnobOn]} /></Pressable>
          </View>
          <View style={[styles.infoCard, { backgroundColor: dark ? "#282342" : "#EEEAFE" }]}>
            <Text style={{ color: palette.brand, fontWeight: "800", fontSize: 15 }}>Your privacy, your rules.</Text>
            <Text style={{ color: dark ? "#D8D0FF" : "#6559A6", lineHeight: 20, marginTop: 7, fontSize: 13 }}>Choose how secret messages appear. You can reveal them when you're ready, then hide them again.</Text>
          </View>
          <Text style={[styles.version, { color: c.muted }]}>ChitChat · Early preview · v0.2.0</Text>
        </ScrollView>
      )}
      <View style={[styles.tabBar, { backgroundColor: c.surface, borderTopColor: c.line }]}>
        {(["Chats", "Calls", "Settings"] as const).map(item => (
          <Pressable key={item} onPress={() => setTab(item)} style={styles.tabItem}>
            <Text style={{ color: tab === item ? palette.brand : c.muted, fontSize: 19 }}>{item === "Chats" ? "▤" : item === "Calls" ? "◔" : "⚙"}</Text>
            <Text style={{ color: tab === item ? palette.brand : c.muted, fontSize: 11, fontWeight: tab === item ? "700" : "500", marginTop: 4 }}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 76, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { fontSize: typeScale.heading, fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { fontSize: 12, marginTop: 1 },
  backButton: { width: 34, height: 42, justifyContent: "center" },
  newButton: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
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
  unread: { minWidth: 19, height: 19, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  unreadText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  separator: { height: 1, marginLeft: 65 },
  tabBar: { position: "absolute", bottom: 0, left: 0, right: 0, height: 76, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", paddingTop: 11, paddingBottom: 18 },
  tabItem: { alignItems: "center", flex: 1 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 42, paddingBottom: 70 },
  emptyIcon: { fontSize: 58, color: palette.brand, marginBottom: 14 },
  emptyTitle: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  emptyCopy: { textAlign: "center", fontSize: 13, lineHeight: 20, marginTop: 8 },
  settingCard: { borderRadius: radius.lg, padding: spacing.lg, flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  settingCopy: { flex: 1, paddingRight: 12 },
  settingTitle: { fontSize: 14, fontWeight: "700" },
  settingHint: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  toggle: { width: 46, height: 27, borderRadius: radius.pill, backgroundColor: "#D5D9E0", padding: 3, justifyContent: "center" },
  toggleOn: { backgroundColor: palette.brand },
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
  myBubble: { backgroundColor: palette.brand, borderBottomRightRadius: 5 },
  theirBubble: { borderBottomLeftRadius: 5 },
  messageText: { fontSize: 14, lineHeight: 21 },
  messageTime: { fontSize: 10, textAlign: "right", marginTop: 5 },
  composer: { minHeight: 68, paddingHorizontal: spacing.md, paddingVertical: 10, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  attachButton: { width: 34, alignItems: "center" },
  input: { flex: 1, height: 44, borderRadius: radius.pill, paddingHorizontal: 16, fontSize: 14 },
  sendButton: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" }
});


function AppBootScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.paper, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#FFFFFF", fontSize: 32, fontWeight: "900", marginTop: -3 }}>c.</Text>
      </View>
      <ActivityIndicator color={palette.brand} style={{ marginTop: 22 }} />
      <Text style={{ color: palette.muted, marginTop: 10, fontSize: 12 }}>Preparing your private space</Text>
    </SafeAreaView>
  );
}

function AuthProblemScreen({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.paper, justifyContent: "center", padding: 24 }}>
      <Text style={{ color: palette.ink, fontSize: 23, fontWeight: "800" }}>Account setup needs attention</Text>
      <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 20, marginTop: 10 }}>{message}</Text>
      <Text style={{ color: palette.inkSoft, fontSize: 12, lineHeight: 19, marginTop: 14 }}>Check docs/SUPABASE_SETUP.md in the ChitChat repository. The database schema must be installed and the profiles table exposed through the Supabase Data API.</Text>
      <Pressable accessibilityRole="button" onPress={onSignOut} style={{ backgroundColor: palette.brand, minHeight: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: 24 }}>
        <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>Sign out</Text>
      </Pressable>
    </SafeAreaView>
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
      .select("id, username, display_name, bio, avatar_url, discoverable")
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
    if (supabase) await supabase.auth.signOut();
    setDemoMode(false);
    setProfile(null);
    setPasswordRecovery(false);
    setSession(null);
  }

  if (!isSupabaseConfigured) return <MainApp profile={null} />;
  if (demoMode) return <MainApp profile={null} onExitDemo={() => setDemoMode(false)} />;
  if (!authReady || profileLoading) return <AppBootScreen />;
  if (passwordRecovery && session?.user) {
    return <PasswordRecoveryScreen onDone={() => { void signOut(); }} />;
  }
  if (!session?.user) return <AuthScreen onContinueDemo={() => setDemoMode(true)} />;
  if (profileError) return <AuthProblemScreen message={profileError} onSignOut={() => { void signOut(); }} />;
  if (!profile) return <ProfileSetupScreen user={session.user} onSaved={setProfile} onSignOut={() => { void signOut(); }} />;
  return <MainApp profile={profile} onSignOut={() => { void signOut(); }} />;
}
