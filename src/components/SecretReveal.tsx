import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View,
} from "react-native";
import { palette, radius, spacing } from "../theme/tokens";

type Props = {
  text: string;
  autoReveal?: boolean;
  onReveal?: () => void;
  onHide?: () => void;
};

export function SecretReveal({ text, autoReveal = false, onReveal, onHide }: Props) {
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
    if (autoReveal) reveal();
  }, [autoReveal]);

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
          hitSlop={8}
          onPress={hide}
        >
          <Animated.View style={[styles.revealed, { opacity: progress, transform: [{ scale }] }]}>
            <Text selectable style={styles.secretText}>{text}</Text>
            <Text style={styles.helper}>Tap to hide again</Text>
          </Animated.View>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reveal secret message"
          accessibilityHint="Shows the concealed message"
          hitSlop={8}
          onPress={reveal}
          style={styles.hidden}
        >
          <Text style={styles.emoji}>✦  ✧  ✦</Text>
          <Text style={styles.hiddenTitle}>A little secret</Text>
          <Text style={styles.hiddenHint}>Tap to reveal</Text>
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
