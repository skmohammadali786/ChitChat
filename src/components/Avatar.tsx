import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { radius } from "../theme/tokens";

type Props = { initials: string; color: string; size?: number; online?: boolean; uri?: string | null };
export function Avatar({ initials, color, size = 52, online = false, uri }: Props) {
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.avatar, { width: size, height: size, backgroundColor: color, borderRadius: size / 2 }]}>
        {uri ? (
          <Image source={{ uri }} resizeMode="cover" style={{ width: size, height: size, borderRadius: size / 2 }} />
        ) : (
          <Text style={{ color: "#252938", fontSize: size * 0.31, fontWeight: "700" }}>{initials}</Text>
        )}
      </View>
      {online ? <View style={[styles.online, { right: 0, bottom: 0 }]} /> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center" },
  online: { position: "absolute", width: 12, height: 12, borderRadius: radius.pill, backgroundColor: "#2DBB78", borderWidth: 2, borderColor: "#FFFFFF" }
});
