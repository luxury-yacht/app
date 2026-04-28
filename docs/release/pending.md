### Added

### Changed

- Removed the About button/icon from the app header. The About modal remains
  accessible via the command palette and the application menu.
- Object Panel Details now renders every Node condition as a status chip
  (with reason/message tooltips) instead of summarizing to non-default
  conditions plus an "All Healthy" badge.
- Object Panel Details for Nodes now shows the Kubelet version row and
  visually groups system-info rows (Kubelet, OS, OS Image, Runtime, Kernel)
  separately from network/capacity/condition rows.

### Fixed

- Object Panel Details for Nodes no longer displays a redundant "Kubernetes"
  version row; it duplicated the Kubelet version because the Kubernetes Node
  API only exposes `KubeletVersion`. The duplicate `Version` field on the
  backend `NodeDetails` payload was removed.
