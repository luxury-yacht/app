#!/usr/bin/env bash
# Copyright (c) 2018-Present Lea Anthony
# SPDX-License-Identifier: MIT

# Fail script on any error
set -euxo pipefail

# Define variables
APP_DIR="${APP_NAME}.AppDir"
LINUXDEPLOY_VERSION="1-alpha-20251107-1"
LINUXDEPLOY_X86_64_SHA256="c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d"
LINUXDEPLOY_AARCH64_SHA256="620095110d693282b8ebeb244a95b5e911cf8f65f76c88b4b47d16ae6346fcff"

download_linuxdeploy() {
    local architecture="$1"
    local expected_sha256="$2"
    local artifact="linuxdeploy-${architecture}.AppImage"
    local url="https://github.com/linuxdeploy/linuxdeploy/releases/download/${LINUXDEPLOY_VERSION}/${artifact}"

    curl --proto "=https" --proto-redir "=https" --fail --silent --show-error --location \
        --output "${artifact}" "${url}"
    echo "${expected_sha256}  ${artifact}" | sha256sum -c -
    chmod +x "${artifact}"
}

# Create AppDir structure
mkdir -p "${APP_DIR}/usr/bin"
cp -r "${APP_BINARY}" "${APP_DIR}/usr/bin/"
cp "${ICON_PATH}" "${APP_DIR}/"
cp "${DESKTOP_FILE}" "${APP_DIR}/"

case "$(uname -m)" in
    x86_64)
        LINUXDEPLOY_BINARY="linuxdeploy-x86_64.AppImage"
        download_linuxdeploy "x86_64" "${LINUXDEPLOY_X86_64_SHA256}"
        ;;
    aarch64|arm64)
        LINUXDEPLOY_BINARY="linuxdeploy-aarch64.AppImage"
        download_linuxdeploy "aarch64" "${LINUXDEPLOY_AARCH64_SHA256}"
        ;;
    *)
        echo "Unsupported AppImage build architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

"./${LINUXDEPLOY_BINARY}" --appdir "${APP_DIR}" --output appimage

# Rename the generated AppImage
mv "${APP_NAME}*.AppImage" "${APP_NAME}.AppImage"
