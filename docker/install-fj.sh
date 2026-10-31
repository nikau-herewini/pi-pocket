#!/bin/sh
# Build forgejo-cli v0.7.0 on the runtime's Debian release. The official Linux
# binaries need a newer glibc than Bookworm. Keep the source commit and hash
# together when updating; Cargo.lock pins the Rust dependencies.
set -eu
commit=d014eb8ed5ff8b5793e135f2b4b99a5fb5793c2b
checksum=748ce60eb18e72af83ef3956910933b1e091abf673f12ff9777aea214f6eae40
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT HUP INT TERM
curl -fsSL --retry 3 -o "$work/source.tar.gz" \
    "https://codeberg.org/forgejo-contrib/forgejo-cli/archive/${commit}.tar.gz"
printf '%s  %s\n' "$checksum" "$work/source.tar.gz" | sha256sum --check --status
tar -xzf "$work/source.tar.gz" -C "$work" --strip-components=1
cargo build --release --locked --manifest-path "$work/Cargo.toml"
install -D -m 0755 "$work/target/release/fj" /out/fj
/out/fj --version
