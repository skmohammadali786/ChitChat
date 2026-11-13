#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v uniffi-bindgen >/dev/null 2>&1; then
  cargo install uniffi_bindgen --version 0.32.2 --locked
fi

cargo build --manifest-path rust/chitchat-core/Cargo.toml
LIBRARY=""
for candidate in \
  target/debug/libchitchat_core.so \
  target/debug/libchitchat_core.dylib \
  target/debug/chitchat_core.dll
do
  if [[ -f "$candidate" ]]; then LIBRARY="$candidate"; break; fi
done
if [[ -z "$LIBRARY" ]]; then
  echo "Could not locate the host chitchat_core dynamic library." >&2
  exit 1
fi

mkdir -p modules/chitchat-core/android/src/main/java modules/chitchat-core/ios/generated
uniffi-bindgen generate --library "$LIBRARY" --language kotlin --config uniffi.toml \
  --out-dir modules/chitchat-core/android/src/main/java
uniffi-bindgen generate --library "$LIBRARY" --language swift --config uniffi.toml \
  --out-dir modules/chitchat-core/ios/generated

echo "UniFFI Kotlin and Swift bindings generated."
