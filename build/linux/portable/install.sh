#!/bin/sh

set -eu

app_name='__APP_NAME__'
app_version='__APP_VERSION__'
binary_name='__APP_BINARY_NAME__'
product_identifier='__APP_IDENTIFIER__'
portable_architecture='__PORTABLE_ARCHITECTURE__'
marker_name='luxury-yacht.install.json'

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

source_directory=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd)
requested_action=${1:-install}

if [ -n "${SUDO_USER:-}" ]; then
    fail "do not run the portable installer with sudo"
fi

if [ "$requested_action" = uninstall ] &&
    [ "$(basename -- "$0")" = manage-installation ] &&
    [ "$(basename -- "$source_directory")" = "$binary_name" ]; then
    data_home=$(dirname -- "$source_directory")
elif [ -n "${XDG_DATA_HOME:-}" ]; then
    data_home=$XDG_DATA_HOME
elif [ -n "${HOME:-}" ]; then
    data_home=$HOME/.local/share
else
    fail "HOME or XDG_DATA_HOME is required"
fi

case "$data_home" in
    /*) ;;
    *) fail "XDG_DATA_HOME must be an absolute path" ;;
esac
case "$data_home" in
    /) fail "refusing to use the filesystem root as XDG_DATA_HOME" ;;
esac

install_root=$data_home/$binary_name
binary_path=$install_root/$binary_name
marker_path=$install_root/$marker_name
manager_path=$install_root/manage-installation
readme_path=$install_root/README.txt
license_path=$install_root/LICENSE
desktop_path=$data_home/applications/$binary_name.desktop
icon_path=$data_home/icons/hicolor/128x128/apps/$binary_name.png

refresh_desktop_database() {
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$data_home/applications" >/dev/null 2>&1 || true
    fi
}

portable_marker_is_valid() {
    candidate=$1
    if [ ! -f "$candidate" ] || [ -L "$candidate" ]; then
        return 1
    fi
    compact_marker=$(LC_ALL=C tr -d '[:space:]' < "$candidate") || return 1
    expected_marker=$(printf '{"schemaVersion":1,"productIdentifier":"%s","distribution":"portable","scope":"user"}' "$product_identifier")
    [ "$compact_marker" = "$expected_marker" ]
}

uninstall_portable() {
    if ! portable_marker_is_valid "$marker_path"; then
        fail "portable installation marker is invalid; refusing to remove files"
    fi

    rm -f "$binary_path" "$marker_path" "$desktop_path" "$icon_path"
    rm -f "$readme_path" "$license_path" "$manager_path"
    rmdir "$install_root" 2>/dev/null || true
    rmdir "$data_home/icons/hicolor/128x128/apps" 2>/dev/null || true
    rmdir "$data_home/icons/hicolor/128x128" 2>/dev/null || true
    rmdir "$data_home/icons/hicolor" 2>/dev/null || true
    rmdir "$data_home/icons" 2>/dev/null || true
    rmdir "$data_home/applications" 2>/dev/null || true
    refresh_desktop_database
    printf 'Removed %s portable installation.\n' "$app_name"
}

case "$requested_action" in
    install) ;;
    uninstall)
        uninstall_portable
        exit 0
        ;;
    *) fail "usage: $0 [install|uninstall]" ;;
esac

source_binary=$source_directory/$binary_name
source_marker=$source_directory/$marker_name
source_desktop=$source_directory/$binary_name.desktop
source_icon=$source_directory/$binary_name.png
source_readme=$source_directory/README.txt
source_license=$source_directory/LICENSE

for source_file in "$source_binary" "$source_marker" "$source_desktop" "$source_icon" "$source_readme" "$source_license"; do
    if [ ! -f "$source_file" ] || [ -L "$source_file" ]; then
        fail "portable installer input is missing or unsafe: $source_file"
    fi
done
if ! portable_marker_is_valid "$source_marker"; then
    fail "portable installer marker is invalid"
fi

if [ -e "$marker_path" ] || [ -L "$marker_path" ]; then
    if [ ! -f "$marker_path" ] || [ -L "$marker_path" ] ||
        ! cmp -s "$marker_path" "$source_marker"; then
        fail "existing installation is not a verified Luxury Yacht portable install"
    fi
elif [ -e "$binary_path" ] || [ -L "$binary_path" ]; then
    fail "existing installation is not a verified Luxury Yacht portable install"
fi
if { [ -e "$binary_path" ] || [ -L "$binary_path" ]; } &&
    { [ ! -f "$binary_path" ] || [ -L "$binary_path" ]; }; then
    fail "existing installation is not a verified Luxury Yacht portable install"
fi

install -d -m 0755 "$install_root"
install -d -m 0755 "$(dirname "$desktop_path")"
install -d -m 0755 "$(dirname "$icon_path")"

temporary_binary=$install_root/.${binary_name}.install.$$
temporary_marker=$install_root/.${marker_name}.install.$$
temporary_manager=$install_root/.manage-installation.install.$$
temporary_readme=$install_root/.README.install.$$
temporary_license=$install_root/.LICENSE.install.$$
temporary_desktop=$(dirname "$desktop_path")/.${binary_name}.desktop.install.$$
temporary_icon=$(dirname "$icon_path")/.${binary_name}.png.install.$$

cleanup_temporary_files() {
    rm -f "$temporary_binary" "$temporary_marker" "$temporary_manager"
    rm -f "$temporary_readme" "$temporary_license" "$temporary_desktop" "$temporary_icon"
}
trap cleanup_temporary_files EXIT
trap 'exit 1' HUP INT TERM

install -m 0755 "$source_binary" "$temporary_binary"
install -m 0644 "$source_marker" "$temporary_marker"
install -m 0755 "$source_directory/install.sh" "$temporary_manager"
install -m 0644 "$source_readme" "$temporary_readme"
install -m 0644 "$source_license" "$temporary_license"
install -m 0644 "$source_icon" "$temporary_icon"

# shellcheck disable=SC2016
desktop_executable=$(printf '%s' "$binary_path" | sed 's/\\/\\\\/g; s/"/\\"/g; s/`/\\`/g; s/\$/\\$/g')
desktop_replacements=0
while IFS= read -r desktop_line || [ -n "$desktop_line" ]; do
    if [ "$desktop_line" = 'Exec=__PORTABLE_EXECUTABLE__ %u' ]; then
        printf 'Exec="%s" %%u\n' "$desktop_executable"
        desktop_replacements=$((desktop_replacements + 1))
    else
        printf '%s\n' "$desktop_line"
    fi
done < "$source_desktop" > "$temporary_desktop"
if [ "$desktop_replacements" -ne 1 ]; then
    fail "portable desktop entry has an invalid executable placeholder"
fi
chmod 0644 "$temporary_desktop"

# Commit the identity before the executable. On a fresh interrupted install a
# marker without a binary is harmless; on an upgrade the old eligible binary
# remains intact until the final rename.
mv -f "$temporary_marker" "$marker_path"
mv -f "$temporary_binary" "$binary_path"
mv -f "$temporary_manager" "$manager_path"
mv -f "$temporary_readme" "$readme_path"
mv -f "$temporary_license" "$license_path"
mv -f "$temporary_desktop" "$desktop_path"
mv -f "$temporary_icon" "$icon_path"

trap - EXIT HUP INT TERM
cleanup_temporary_files
refresh_desktop_database

printf 'Installed %s %s (%s) to %s\n' "$app_name" "$app_version" "$portable_architecture" "$install_root"
printf 'Run %s to remove this portable installation.\n' "$manager_path uninstall"

if command -v ldd >/dev/null 2>&1; then
    missing_libraries=$(ldd "$binary_path" 2>&1 | awk '/not found/ { print $1 }')
    if [ -n "$missing_libraries" ]; then
        printf 'Warning: required runtime libraries are missing:\n%s\n' "$missing_libraries" >&2
        printf 'See %s for GTK/WebKit package requirements.\n' "$readme_path" >&2
    fi
fi
