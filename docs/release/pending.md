### Changed

- Simplify docked panels and improve tab dragging
  - Each dock now manages its own size and controls, while each tab keeps its own content. This removes the special "leader tab" arrangement.
  - Adds visible drop zones for docking panels when dragging tabs.
  - Keeps dock sizes consistent when tabs close or size settings change, and releases stored layout data for removed floating groups.

### Fixed

- Custom resource views should now update immediately when changes are made.
