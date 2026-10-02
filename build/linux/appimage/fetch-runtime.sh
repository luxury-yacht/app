#!/usr/bin/env bash
# Fetches the pinned AppImage type 2 runtime that `cmd/project
# create-linux-appimage` prepends to the app's squashfs image. Update the
# version and every digest together.
#
#   fetch-runtime.sh GOARCH DESTINATION
set -euo pipefail

RUNTIME_VERSION="20251108"

usage() {
    echo "usage: fetch-runtime.sh GOARCH DESTINATION" >&2
    exit 1
}

download_verified() {
    local url="$1"
    local expected_sha256="$2"
    local destination="$3"

    if [ -f "${destination}" ] && echo "${expected_sha256}  ${destination}" | sha256sum -c --status -; then
        return
    fi
    curl --proto "=https" --proto-redir "=https" --fail --silent --show-error --location \
        --output "${destination}.download" "${url}"
    echo "${expected_sha256}  ${destination}.download" | sha256sum -c -
    chmod +x "${destination}.download"
    mv "${destination}.download" "${destination}"
}

[ "$#" -eq 2 ] || usage
goarch="$1"
destination="$2"

# AppImage tooling names architectures like the kernel does.
case "${goarch}" in
    amd64)
        architecture="x86_64"
        runtime_sha256="2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d"
        ;;
    arm64)
        architecture="aarch64"
        runtime_sha256="00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444"
        ;;
    *)
        echo "Unsupported AppImage architecture: ${goarch}" >&2
        exit 1
        ;;
esac

mkdir -p "$(dirname "${destination}")"
download_verified \
    "https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME_VERSION}/runtime-${architecture}" \
    "${runtime_sha256}" "${destination}"
