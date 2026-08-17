__APP_NAME__ __APP_VERSION__ portable Linux distribution

Run ./install.sh to install this build for the current user. The default
installation root is ~/.local/share/__APP_BINARY_NAME__. Set XDG_DATA_HOME to
use a different absolute user-owned data directory. Do not run the installer
with sudo.

The installer keeps the executable, installation identity marker, management
script, and documentation together in that root. It also installs a desktop
entry and icon below XDG_DATA_HOME. Automatic updates replace only the
executable, preserving the marker and desktop integration.

Runtime dependencies:

- Debian 13 / Ubuntu 24.04 or newer: libgtk-4-1 and libwebkitgtk-6.0-4
- Fedora / RHEL-family distributions: gtk4 and webkitgtk6.0

To uninstall, run:

  ~/.local/share/__APP_BINARY_NAME__/manage-installation uninstall

If XDG_DATA_HOME was set during installation, use the management script below
that directory instead.
