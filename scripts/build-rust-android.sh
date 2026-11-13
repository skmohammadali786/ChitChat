#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v rustup >/dev/null 2>&1 || { echo "Rustup is required for Android native builds." >&2; exit 1; }
command -v cargo-ndk >/dev/null 2>&1 || cargo install cargo-ndk

rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
bash scripts/generate-uniffi-bindings.sh
cargo ndk --platform 24 \
  -t arm64-v8a -t armeabi-v7a -t x86 -t x86_64 \
  -o modules/chitchat-core/android/src/main/jniLibs \
  build --manifest-path rust/chitchat-core/Cargo.toml --release
