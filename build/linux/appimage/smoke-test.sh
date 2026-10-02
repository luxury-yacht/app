#!/usr/bin/env bash
# Starts the AppImage the way desktops do on several Linux distributions, each
# in a throwaway container. On every distribution the AppImage must:
#   - explain missing GTK 4 / WebKitGTK 6.0 to an unprivileged FUSE user;
#   - start from its FUSE mount once the advertised packages are installed;
#   - spawn WebKit's network process and its bubblewrap-sandboxed web process;
#   - give the app the launch environment plus only the runtime's markers.
#
#   smoke-test.sh APPIMAGE GOARCH
set -euo pipefail

# --- Inside a container, as root --------------------------------------------

inside() {
    local app=/smoke/app.AppImage
    local logs
    logs=$(mktemp -d)
    # shellcheck source=/dev/null
    . /etc/os-release

    fail() {
        echo "FAIL ${PRETTY_NAME}: $1"
        for log in "${logs}"/*.std*; do
            echo "--- $(basename "${log}")"
            tail -n 20 "${log}" || true
        done
        exit 1
    }

    # Matches a process by its executable path so a shell whose command line
    # merely mentions the name cannot match.
    process_id() {
        pgrep -f "^[^ ]*/$1( |\$)" | head -n 1 || true
    }

    install_packages() {
        case "${ID}" in
            ubuntu | debian)
                DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null ;;
            fedora) dnf install -y -q "$@" >/dev/null ;;
            arch) pacman -S --noconfirm --needed --quiet "$@" >/dev/null ;;
            *) fail "no package recipe for ${ID}" ;;
        esac
    }

    case "${ID}" in
        ubuntu | debian) apt-get update -qq ;;
        arch) pacman -Sy --noconfirm --quiet >/dev/null ;;
    esac

    # 1. Missing libraries are explained to an unprivileged user. FUSE needs a
    # named user, and file modes inside the image only matter without root.
    case "${ID}" in
        fedora) install_packages fuse3 util-linux ;;
        *) install_packages fuse3 ;;
    esac
    mkdir -m 0777 /tmp/smoke-home
    echo "smoke:x:4242:4242:smoke:/tmp/smoke-home:/bin/sh" >>/etc/passwd
    echo "smoke:x:4242:" >>/etc/group
    local status=0
    HOME=/tmp/smoke-home setpriv --reuid=4242 --regid=4242 --clear-groups \
        "${app}" >"${logs}/missing.stdout" 2>"${logs}/missing.stderr" || status=$?
    [ "${status}" -eq 127 ] || fail "missing libraries exited with ${status}, want 127"
    grep -q 'libwebkitgtk-6.0.so.4 => not found' "${logs}/missing.stderr" ||
        fail "missing libraries message does not name libwebkitgtk-6.0.so.4"
    if grep -q 'Cannot mount AppImage\|No suitable fusermount' "${logs}/missing.stdout"; then
        fail "unprivileged launch did not mount the AppImage with FUSE"
    fi
    echo "ok   ${PRETTY_NAME}: explains missing GTK 4 / WebKitGTK 6.0 and exits 127"

    # 2. Install exactly the packages the AppImage tells users to install, plus a
    # display and a session bus.
    case "${ID}" in
        ubuntu | debian) install_packages libgtk-4-1 libwebkitgtk-6.0-4 xvfb dbus procps ;;
        fedora) install_packages gtk4 webkitgtk6.0 xorg-x11-server-Xvfb dbus-daemon procps-ng ;;
        arch) install_packages gtk4 webkitgtk-6.0 xorg-server-xvfb dbus procps-ng ;;
    esac
    export XDG_RUNTIME_DIR=/tmp/runtime-root
    mkdir -m 0700 "${XDG_RUNTIME_DIR}"
    Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
    export DISPLAY=:99
    dbus-daemon --session --address="unix:path=${XDG_RUNTIME_DIR}/bus" --fork --nopidfile >/dev/null
    export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
    sleep 1

    # 3. The app starts from the FUSE mount and WebKit spawns its helpers.
    "${app}" >"${logs}/app.stdout" 2>"${logs}/app.stderr" &
    local launcher=$! network="" web=""
    for _ in $(seq 1 90); do
        kill -0 "${launcher}" 2>/dev/null || fail "AppImage exited before WebKit started"
        network=$(process_id WebKitNetworkProcess)
        web=$(process_id WebKitWebProcess)
        [ -n "${network}" ] && [ -n "${web}" ] && break
        sleep 1
    done
    [ -n "${network}" ] || fail "WebKitNetworkProcess did not start"
    [ -n "${web}" ] || fail "WebKitWebProcess did not start"
    pgrep -f '^[^ ]*/bwrap .*WebKitWebProcess' >/dev/null || fail "WebKitWebProcess is not sandboxed by bubblewrap"
    local app_pid app_exe
    app_pid=$(ps -o ppid= -p "${network}" | tr -d ' ')
    app_exe=$(readlink "/proc/${app_pid}/exe")
    case "${app_exe}" in
        /tmp/.mount_*/usr/bin/*) ;;
        *) fail "WebKit was started by ${app_exe}, not the binary in the AppImage mount" ;;
    esac
    echo "ok   ${PRETTY_NAME}: runs from the FUSE mount with sandboxed WebKit helpers"

    # 4. The app sees the launch environment plus the runtime's markers. The
    # shell maintains _ and SHLVL itself.
    local ignored='^(APPDIR|APPIMAGE|ARGV0|OWD|_|SHLVL)='
    local launched received
    launched=$(env -0 | grep -z -v -E "${ignored}" | sort -z | tr '\0' '\n')
    received=$(grep -z -v -E "${ignored}" "/proc/${app_pid}/environ" | sort -z | tr '\0' '\n')
    if [ "${launched}" != "${received}" ]; then
        comm -3 <(printf '%s\n' "${launched}") <(printf '%s\n' "${received}")
        fail "the AppImage changed the app environment"
    fi
    echo "ok   ${PRETTY_NAME}: app environment is the launch environment"

    sleep 5
    kill -0 "${app_pid}" 2>/dev/null || fail "app exited after starting"
    kill "${app_pid}"
    echo "PASS ${PRETTY_NAME}"
}

if [ "${1:-}" = "--inside" ]; then
    inside
    exit
fi

# --- On the host --------------------------------------------------------------

[ "$#" -eq 2 ] || { echo "usage: smoke-test.sh APPIMAGE GOARCH" >&2; exit 1; }
appimage=$(readlink -f "$1")
goarch=$2
script=$(readlink -f "$0")
[ -f "${appimage}" ] || { echo "AppImage not found: ${appimage}" >&2; exit 1; }

images=(ubuntu:24.04 debian:13 fedora:44)
# Arch Linux publishes amd64 images only.
if [ "${goarch}" = "amd64" ]; then
    images+=(archlinux:latest)
fi

logs=$(mktemp -d)
pids=()
for image in "${images[@]}"; do
    # Privileged containers provide /dev/fuse and the namespaces WebKit's
    # bubblewrap sandbox creates.
    docker run --rm --privileged --platform "linux/${goarch}" \
        -v "${appimage}:/smoke/app.AppImage:ro" -v "${script}:/smoke/smoke-test.sh:ro" \
        "${image}" bash /smoke/smoke-test.sh --inside >"${logs}/${image//[:\/]/-}.log" 2>&1 &
    pids+=("$!")
done

failed=0
for index in "${!images[@]}"; do
    log="${logs}/${images[${index}]//[:\/]/-}.log"
    if wait "${pids[${index}]}"; then
        grep -E '^(ok|PASS) ' "${log}"
    else
        failed=1
        echo "=== ${images[${index}]} failed"
        tail -n 60 "${log}"
    fi
done
exit "${failed}"
