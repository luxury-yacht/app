#!/usr/bin/env bash
# Pins the AppImage tooling that `wails3 generate appimage` would otherwise take
# from moving release tags.
#
#   tools.sh fetch BUILD_DIR
#     Seeds a verified linuxdeploy (Wails skips its own download when the file
#     exists) and a verified AppImage runtime for LDAI_RUNTIME_FILE (otherwise
#     linuxdeploy's appimagetool downloads one).
#   tools.sh verify-apprun APPRUN APPIMAGE
#     Wails recreates the AppDir and always downloads AppRun, so the generated
#     AppRun is checked afterwards and the AppImage is removed on a mismatch.
set -euo pipefail

LINUXDEPLOY_VERSION="1-alpha-20251107-1"
RUNTIME_VERSION="20251108"

# AppImage tooling runs natively and names architectures like the kernel does.
case "$(uname -m)" in
    x86_64)
        ARCH="x86_64"
        LINUXDEPLOY_SHA256="c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d"
        RUNTIME_SHA256="2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d"
        APPRUN_SHA256="f30140a43a0a59e46db21bdefdf749b9e9f2c6946e92afabbacf98b8ae73fb4f"
        ;;
    aarch64|arm64)
        ARCH="aarch64"
        LINUXDEPLOY_SHA256="620095110d693282b8ebeb244a95b5e911cf8f65f76c88b4b47d16ae6346fcff"
        RUNTIME_SHA256="00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444"
        APPRUN_SHA256="072f17c0895a85c490282fe5395c5007e5fc75da727e553b3b8fb680feb11578"
        ;;
    *)
        echo "Unsupported AppImage build architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

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

fetch() {
    local build_dir="$1"

    mkdir -p "${build_dir}"
    download_verified \
        "https://github.com/linuxdeploy/linuxdeploy/releases/download/${LINUXDEPLOY_VERSION}/linuxdeploy-${ARCH}.AppImage" \
        "${LINUXDEPLOY_SHA256}" "${build_dir}/linuxdeploy-${ARCH}.AppImage"
    download_verified \
        "https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME_VERSION}/runtime-${ARCH}" \
        "${RUNTIME_SHA256}" "${build_dir}/runtime-${ARCH}"
}

verify_apprun() {
    local apprun="$1"
    local appimage="$2"

    if ! echo "${APPRUN_SHA256}  ${apprun}" | sha256sum -c -; then
        rm -f "${appimage}"
        echo "Wails downloaded an unexpected AppRun; removed ${appimage}" >&2
        exit 1
    fi
}

case "${1:-}" in
    fetch) fetch "${2:?usage: tools.sh fetch BUILD_DIR}" ;;
    verify-apprun) verify_apprun "${2:?usage: tools.sh verify-apprun APPRUN APPIMAGE}" "${3:?usage: tools.sh verify-apprun APPRUN APPIMAGE}" ;;
    *)
        echo "usage: tools.sh fetch BUILD_DIR | verify-apprun APPRUN APPIMAGE" >&2
        exit 1
        ;;
esac
