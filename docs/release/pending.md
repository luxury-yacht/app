### Added

### Changed

### Fixed

- Fixed cluster tab handling when clusters are rapidly opened and closed. Closed clusters close immediately and release their connections in the background. Closing a sibling no longer causes a catalog error toast.
- A failed cluster connection no longer interrupts healthy clusters opened alongside it or leaves failed tabs stuck connecting after another tab closes. Disconnected tabs explain how to retry by closing and reopening the tab.
