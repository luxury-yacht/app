### Added

### Changed

- The object panel's actions menu (delete, restart, scale, rollback, trigger,
  suspend, port-forward) now runs through the same shared action controller as
  the cluster/namespace table views, so confirmation dialogs, the scale modal,
  and permission gating behave identically everywhere. Action failures now
  surface through the standard error notifications instead of an inline banner.

### Fixed

- Browse tables (Storage and other resource views) no longer get stuck on a
  loading spinner the first time you open a view for a namespace or cluster that
  has none of that resource. The empty result now settles to the "no objects
  found" state instead of waiting forever for data that will never arrive.
- Object details now show an Age for every resource type, including custom
  resources, and the value always matches the Age shown in the cluster/namespace
  browse tables. Age is now derived once from the object's creation timestamp
  instead of per resource type.
