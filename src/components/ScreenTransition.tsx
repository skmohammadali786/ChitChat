import React, { useEffect, useRef, type ComponentProps, type PropsWithChildren } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  SafeAreaView,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type TransitionProps = PropsWithChildren<{
  duration?: number;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Short route entrance used by app pages and tab content.
 * Respects the system reduced-motion preference.
 */
export function ScreenTransition({ children, duration = 230, style }: TransitionProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    let animation: Animated.CompositeAnimation | undefined;
    const start = (reduceMotion: boolean) => {
      if (!mounted) return;
      if (reduceMotion) {
        progress.setValue(1);
        return;
      }
      animation = Animated.timing(progress, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start();
    };

    void AccessibilityInfo.isReduceMotionEnabled().then(start).catch(() => start(false));
    return () => {
      mounted = false;
      animation?.stop();
    };
  }, [duration, progress]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        { flex: 1, opacity: progress },
        {
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [9, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.992, 1] }) },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Safe-area wrapper with a page entrance animation. */
export function AnimatedSafeAreaView(props: ComponentProps<typeof SafeAreaView>) {
  return (
    <ScreenTransition>
      <SafeAreaView {...props} />
    </ScreenTransition>
  );
}
