#!/bin/sh

set -eu

architecture=${1:?usage: package-manager-drill.sh ARCH DEB RPM DEB_MARKER RPM_MARKER}
deb_package=${2:?usage: package-manager-drill.sh ARCH DEB RPM DEB_MARKER RPM_MARKER}
rpm_package=${3:?usage: package-manager-drill.sh ARCH DEB RPM DEB_MARKER RPM_MARKER}
deb_marker=${4:?usage: package-manager-drill.sh ARCH DEB RPM DEB_MARKER RPM_MARKER}
rpm_marker=${5:?usage: package-manager-drill.sh ARCH DEB RPM DEB_MARKER RPM_MARKER}

case "$architecture" in
    amd64) container_platform=linux/amd64 ;;
    arm64) container_platform=linux/arm64 ;;
    *) printf 'Error: unsupported architecture: %s\n' "$architecture" >&2; exit 1 ;;
esac

for input in "$deb_package" "$rpm_package" "$deb_marker" "$rpm_marker"; do
    case "$input" in
        /*) ;;
        *) printf 'Error: input path must be absolute: %s\n' "$input" >&2; exit 1 ;;
    esac
    if [ ! -f "$input" ] || [ -L "$input" ]; then
        printf 'Error: input must be a regular non-symlink file: %s\n' "$input" >&2
        exit 1
    fi
done

docker run --rm --platform "$container_platform" \
    --volume "$deb_package:/packages/luxury-yacht.deb:ro" \
    --volume "$rpm_package:/packages/luxury-yacht.rpm:ro" \
    --volume "$deb_marker:/packages/install-deb.json:ro" \
    --volume "$rpm_marker:/packages/install-rpm.json:ro" \
    ubuntu:24.04 sh -eu -c '
marker=/usr/share/luxury-yacht/install.json

dpkg --force-architecture --unpack /packages/luxury-yacht.deb
test -f "$marker"
cmp -s "$marker" /packages/install-deb.json
dpkg --remove luxury-yacht
test ! -e "$marker"

export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null
apt-get install -y --no-install-recommends rpm >/dev/null
rpm --ignorearch --nodeps -i /packages/luxury-yacht.rpm
test -f "$marker"
cmp -s "$marker" /packages/install-rpm.json
rpm -e luxury-yacht
test ! -e "$marker"
'
