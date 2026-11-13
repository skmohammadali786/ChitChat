import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable as NativePressable,
  type GestureResponderEvent,
  type PressableProps,
  type PressableStateCallbackType,
} from "react-native";

const AnimatedPressable = Animated.createAnimatedComponent(NativePressable);

/**
 * Shared touch feedback for ChitChat controls: native Android ripple,
 * a short spring scale, and a restrained opacity change.
 * All motion is disabled when the OS reduced-motion preference is enabled.
 */
export function MotionPressable({
  disabled,
  onPressIn,
  onPressOut,
  style,
  android_ripple,
  ...props
}: PressableProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const animateTo = useCallback((value: number) => {
    if (reduceMotion) {
      progress.setValue(0);
      return;
    }
    Animated.spring(progress, {
      toValue: value,
      speed: value === 1 ? 34 : 28,
      bounciness: value === 1 ? 5 : 0,
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion]);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    if (!disabled) animateTo(1);
    onPressIn?.(event);
  }, [animateTo, disabled, onPressIn]);

  const handlePressOut = useCallback((event: GestureResponderEvent) => {
    animateTo(0);
    onPressOut?.(event);
  }, [animateTo, onPressOut]);

  const animatedStyle = reduceMotion ? undefined : {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }),
    transform: [{
      scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.975] }),
    }],
  };
  const resolvedStyle = typeof style === "function"
    ? style({ pressed: false } as PressableStateCallbackType)
    : style;

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      android_ripple={android_ripple ?? { color: "rgba(112, 100, 160, 0.13)" }}
      style={[resolvedStyle, animatedStyle]}
    />
  );
}
