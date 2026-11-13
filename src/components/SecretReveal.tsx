import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, Animated, AppState, Pressable, StyleSheet, Text, View,
} from "react-native";
import { palette, radius, spacing } from "../theme/tokens";

type Props = {
  text: string;
  autoReveal?: boolean;
  dark?: boolean;
  accentColor?: string;
  onReveal?: () => void;
  onHide?: () => void;
};

export function SecretReveal({ text, autoReveal = false, dark = false, accentColor = palette.brand, onReveal, onHide }: Props) {
  const colors = {
    hiddenBackground: dark ? "#29253C" : "#EDE9FF",
    hiddenBorder: dark ? "#51477A" : "#DAD2FF",
    hiddenTitle: dark ? "#E4DEFF" : "#453A91",
    hiddenHint: dark ? "#B9AFE8" : "#776DB7",
    revealedBackground: dark ? "#25213A" : "#F0ECFF",
    revealedBorder: dark ? "#51477A" : "#DAD2FF",
    secretText: dark ? "#F1EEFF" : "#282044",
  };
  const [revealed, setRevealed] = useState(autoReveal);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(autoReveal ? 1 : 0)).current;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => { if (mounted) setReduceMotion(enabled); })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (autoReveal && !revealed) reveal();
  }, [autoReveal, revealed]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active" && revealed) hide();
    });
    return () => subscription.remove();
  }, [revealed, reduceMotion]);

  function reveal() {
    setRevealed(true);
    if (reduceMotion) progress.setValue(1);
    else Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: true,
      damping: 16,
      stiffness: 150,
    }).start();
    onReveal?.();
  }

  function hide() {
    setRevealed(false);
    if (reduceMotion) progress.setValue(0);
    else Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    onHide?.();
  }

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  return (
    <View style={styles.wrap}>
      {revealed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide secret message"
          accessibilityHint="Conceals this message again"
          accessibilityState={{ expanded: true }}
          hitSlop={8}
          onPress={hide}
        >
          <Animated.View style={[styles.revealed, { opacity: progress, transform: [{ scale }] }, { backgroundColor: colors.revealedBackground, borderColor: colors.revealedBorder }]}>
            <Text selectable style={[styles.secretText, { color: colors.secretText }]}>{text}</Text>
            <Text style={[styles.helper, { color: colors.hiddenHint }]}>Tap to hide again</Text>
          </Animated.View>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reveal secret message"
          accessibilityHint="Shows the concealed message"
          accessibilityState={{ expanded: false }}
          hitSlop={8}
          onPress={reveal}
          style={[styles.hidden, { backgroundColor: colors.hiddenBackground, borderColor: colors.hiddenBorder }]}
        >
          <Text style={[styles.emoji, { color: accentColor }]}>✦  ✧  ✦</Text>
          <Text style={[styles.hiddenTitle, { color: colors.hiddenTitle }]}>A little secret</Text>
          <Text style={[styles.hiddenHint, { color: colors.hiddenHint }]}>Tap to reveal</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  hidden: { minHeight: 92, borderRadius: radius.lg, backgroundColor: "#EDE9FF", borderWidth: 1, borderColor: "#DAD2FF", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  emoji: { color: palette.brand, fontSize: 18, letterSpacing: 4, marginBottom: 5 },
  hiddenTitle: { color: "#453A91", fontWeight: "700", fontSize: 14 },
  hiddenHint: { color: "#776DB7", fontSize: 12, marginTop: 3 },
  revealed: { backgroundColor: "#F0ECFF", borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: "#DAD2FF" },
  secretText: { color: "#282044", fontSize: 15, lineHeight: 22 },
  helper: { color: "#776DB7", fontSize: 11, marginTop: 8 }
});
