import React, { useCallback, useRef } from "react";
import {
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

  const animateTo = useCallback((value: number) => {
    Animated.spring(progress, {
      toValue: value,
      speed: value === 1 ? 34 : 28,
      bounciness: value === 1 ? 5 : 0,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    if (!disabled) animateTo(1);
    onPressIn?.(event);
  }, [animateTo, disabled, onPressIn]);

  const handlePressOut = useCallback((event: GestureResponderEvent) => {
    animateTo(0);
    onPressOut?.(event);
  }, [animateTo, onPressOut]);

  const animatedStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }),
    transform: [{
      scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.975] }),
    }],
  };

  const composeStyle = useCallback((state: PressableStateCallbackType) => [
    typeof style === "function" ? style(state) : style,
    animatedStyle,
  ], [animatedStyle, style]);

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      android_ripple={android_ripple ?? { color: "rgba(112, 100, 160, 0.13)" }}
      style={composeStyle}
    />
  );
}
