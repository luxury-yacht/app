### Changed

- Object Map improvements
  - Improved performance on very large maps
    - Progressively reduce card detail at low zoom levels to save on redraw overhead
    - Switched to simple straight connections for very large maps instead of computationally expensive curved connections
  - Added a toolbar icon for Reset Zoom
  - Added a Map Debug overlay, invoked with `ctrl+alt+m`
    - When in Map Debug mode, there is an overlay showing the coordinated on the map
  - Added Object and Link counts to the Legend
  - Added a close button to the Legend with a tooltip explaining how to reopen it
  - Added clearer visual feedback for manual map refresh
- Removed dead CSS and migrated hardcoded colors to tokens in the theme files

### Fixed

- The Object Map would sometimes generate incomplete payloads, resulting in missing objects. Imcomplete data should now be rejected before it is passed to the frontend.
- The Object Map would appear to jump unpredictably when using Focus mode without Auto-Fit. This behavior should be more predictable.
- Updated vite config to fix error on startup when running in development mode
