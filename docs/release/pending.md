### Added

- **Object Maps** - Visualize relationships between Kubernetes objects as an interactive graph
  - New Map tab in the Object Panel for any supported object
  - New namespace-level Map view that renders all supported objects in the selected namespace, plus directly related cluster-scoped objects
  - Map actions on object/action menus jump straight to the map view for that object
  - High-performance renderer with pan, zoom, drag, hover highlighting, node selection, context menus, and filtering

### Changed

- Large internal cleanup across cluster and namespace views
  - New shared `useResourceGridTable` and `useGridTableBinding` hooks consolidate filter/sort/persistence wiring that each view used to duplicate
  - New `useObjectActionController` centralizes object action handling.

# Fixed

- Tooltip persistence fix to address tooltips that would appear on top of the object panel and were unable to be dismissed
