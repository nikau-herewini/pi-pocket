#!/bin/sh
# Pinned release archives from forgejo-contrib/forgejo-cli. Update the version
# and both SHA-256 values together after reviewing the upstream release.
set -eu
version=0.7.0
arch="$(dpkg --print-architecture)"
case "$arch" in
    amd64)
        target=x86_64
        checksum=6803c12eed17bfadb40ba95da2a6ab58f9b4a7dc10eabfe3512fce7e2fe6216f
        ;;
    arm64)
        target=aarch64
        checksum=198987908e194704b4a350119596547bc95cd9b6518024d6d02c26f061cfce83
        ;;
    *) echo "forgejo-cli has no pinned release for $arch" >&2; exit 1 ;;
esac
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT HUP INT TERM
curl -fsSL --retry 3 -o "$work/fj.tar.gz" \
    "https://codeberg.org/forgejo-contrib/forgejo-cli/releases/download/v${version}/forgejo-cli-${target}-linux.tar.gz"
printf '%s  %s\n' "$checksum" "$work/fj.tar.gz" | sha256sum --check --status
tar -xzf "$work/fj.tar.gz" -C "$work" fj
install -m 0755 "$work/fj" /usr/local/bin/fj
# Detect incompatible release binaries during the build, not after deployment.
/usr/local/bin/fj --version
