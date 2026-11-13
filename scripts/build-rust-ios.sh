#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[[ "$(uname -s)" == "Darwin" ]] || { echo "iOS Rust frameworks must be built on macOS." >&2; exit 1; }
command -v xcodebuild >/dev/null 2>&1 || { echo "Xcode command line tools are required." >&2; exit 1; }

rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
bash scripts/generate-uniffi-bindings.sh

cargo build --manifest-path rust/chitchat-core/Cargo.toml --release --target aarch64-apple-ios
cargo build --manifest-path rust/chitchat-core/Cargo.toml --release --target aarch64-apple-ios-sim
cargo build --manifest-path rust/chitchat-core/Cargo.toml --release --target x86_64-apple-ios

FRAMEWORKS="modules/chitchat-core/ios/Frameworks"
mkdir -p "$FRAMEWORKS/Headers"
cp modules/chitchat-core/ios/generated/chitchat_coreFFI.h "$FRAMEWORKS/Headers/" 2>/dev/null || true
cp modules/chitchat-core/ios/generated/chitchat_coreFFI.h "$FRAMEWORKS/Headers/chitchat_coreFFI.h"

lipo -create \
  target/aarch64-apple-ios-sim/release/libchitchat_core.a \
  target/x86_64-apple-ios/release/libchitchat_core.a \
  -output "$FRAMEWORKS/libchitchat_core_sim.a"

cat > "$FRAMEWORKS/Headers/module.modulemap" <<'MAP'
module chitchat_coreFFI {
  header "chitchat_coreFFI.h"
  export *
}
MAP

xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libchitchat_core.a -headers "$FRAMEWORKS/Headers" \
  -library "$FRAMEWORKS/libchitchat_core_sim.a" -headers "$FRAMEWORKS/Headers" \
  -output "$FRAMEWORKS/ChitChatCore.xcframework"

echo "ChitChat Rust iOS XCFramework generated."
