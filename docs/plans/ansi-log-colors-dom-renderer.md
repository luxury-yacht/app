# ANSI Log Colors DOM Renderer Plan

## Overview

Fix ANSI color support in the log viewer without turning logs into a terminal widget.

The current bug is not that logs lack ANSI support. The bug is that the frontend parses ANSI escape sequences and then remaps standard 8/16-color output to app-chosen muted colors. That changes expected terminal colors.

The correct fix is:

- keep the existing log viewer DOM layout
- keep the existing log interactions
- replace the custom muted ANSI palette with terminal-faithful palette resolution
- resolve ANSI attributes with terminal semantics inside the DOM renderer

The shell still needs `xterm`. The log viewer does not.

## Architecture Decision

Use two different rendering models for two different products:

- Shell: `xterm`, because the shell is an actual terminal surface.
- Logs: DOM log rows, because logs are read-only text with metadata, filtering, virtualization, and workload-specific affordances.

Use one shared ANSI color contract across both:

- one canonical 16-color ANSI palette
- one shared 256-color resolver
- one shared interpretation of ANSI attributes such as reset, bold, faint, inverse, foreground/background defaults

That gives shell/log color parity without embedding a terminal emulator in the log pane.

## Goals

- Preserve expected ANSI colors for standard 8/16-color output.
- Preserve 256-color and truecolor output exactly.
- Keep the existing log viewer presentation model and interaction model.
- Remove the custom muted ANSI remap.
- Make shell and logs share the same ANSI palette source of truth.

## Non-Goals

- Rebuild the log viewer around `xterm`.
- Redesign parsed log mode.
- Change backend log streaming APIs.
- Remove existing workload metadata affordances such as pod/container filter buttons.

## Problem Statement

Today the log viewer does two things wrong:

- standard ANSI colors are remapped to custom app hex values in the frontend parser
- ANSI `dim` is approximated as CSS opacity instead of terminal-style color resolution

Those choices make ANSI logs look washed out and inconsistent with expected terminal output.

The failed direction is to use `xterm` as the raw log renderer. That solves color semantics but breaks the log viewer UX because logs are not terminal sessions. The fix needs to preserve ANSI semantics while keeping the existing DOM-based log layout.

## Current Status

Implemented on 2026-04-21:

- ✅ Added a shared terminal palette module under `frontend/src/shared/terminal`.
- ✅ Set the default ANSI 16-color palette to iTerm2's bundled defaults.
- ✅ Added shared helpers for ANSI 16-color and 256-color resolution.
- ✅ Switched the shell tab to read its ANSI palette from the shared terminal theme.
- ✅ Replaced the hard-coded muted ANSI palette in `ansi.ts`.
- ✅ Removed whole-span opacity dimming and replaced it with foreground-only dimming.
- ✅ Added terminal-style inverse handling in ANSI parsing.
- ✅ Kept pod logs and node logs on the existing DOM renderer while resolving ANSI segments from the shared terminal theme.
- ✅ Added unit coverage for the shared palette and ANSI parser.
- ✅ Added shell regression coverage proving the shared iTerm2 palette is applied to `xterm`.
- ✅ Added DOM-renderer regression coverage for workload metadata, highlight, and no-wrap behavior with ANSI content.

Still pending:

- Run visual verification against real shell/log samples in both themes.

## Implementation Plan

### Phase 1: Shared ANSI Theme

- ✅ Create a shared terminal palette module under `frontend/src/shared/terminal`.
- ✅ Define the canonical ANSI 16-color palette there.
- ✅ Expose helpers for:
  - base 8/16-color lookup
  - 256-color lookup
  - truecolor passthrough
- ✅ Update the shell tab to read its ANSI palette from that shared module.

### Phase 2: Terminal-Semantic ANSI Parsing

- ✅ Refactor `frontend/src/modules/object-panel/components/ObjectPanel/Logs/ansi.ts`.
- ✅ Remove the hard-coded muted `ANSI_COLORS` and `ANSI_BRIGHT_COLORS`.
- ✅ Stop using CSS `opacity` for ANSI `dim`.
- ✅ Introduce explicit ANSI state tracking for:
  - foreground color
  - background color
  - bold
  - faint
  - italic
  - underline
  - reset/default fg/bg
  - inverse
- ✅ Make parsed segments resolve against the shared terminal theme, not app-local color tables.

### Phase 3: DOM Log Renderer Integration

- ✅ Keep raw logs rendered through the existing DOM row renderer in `LogViewer.tsx` and `NodeLogsTab.tsx`.
- ✅ Feed ANSI segments into the existing row/metadata structure instead of replacing the surface with `xterm`.
- ✅ Preserve:
  - workload metadata prefixes
  - pod/container filter buttons
  - timestamps
  - wrapping and no-wrap behavior
  - virtualization
  - copy behavior
  - filtering and highlighting
- ✅ Ensure ANSI styling only affects message text, not the surrounding log viewer layout unless the raw line itself contains that ANSI styling.

### Phase 4: Log UX Parity

- Verify that raw ANSI logs still behave like logs rather than a terminal:
  - scroll position works as before
  - filtering works as before
  - highlight works as before
  - virtualization works as before
  - workload and node log variants remain visually consistent
- Keep ANSI color rendering compatible with existing line splitting and display formatting.

### Phase 5: Cleanup

- Delete duplicated ANSI palette logic from the log viewer.
- Keep only shared ANSI helpers plus the DOM renderer integration.
- Remove any abandoned terminal-surface code from the log path if present.

## Testing Plan

### Unit Tests

- ✅ Add tests for ANSI parsing with the shared palette:
  - `30-37`
  - `90-97`
  - ✅ `38;2;r;g;b`
  - ✅ `38;5;n`
  - ✅ `48;5;n`
  - ✅ `48;2;r;g;b`
  - ✅ `reset`
  - ✅ bold
  - ✅ faint
  - ✅ inverse
  - ✅ nested resets

### UI Tests

- ✅ Add regression tests proving raw ANSI logs still render in the DOM log viewer, not an `xterm` surface.
- ✅ Add tests for pod logs, workload logs, and node logs.
- ✅ Add tests proving metadata buttons still render in workload logs with ANSI content.
- ✅ Add tests for highlight plus ANSI content.
- ✅ Add tests for no-wrap plus ANSI content.
- ✅ Add tests for copy behavior with ANSI-enabled raw logs.

### Visual Verification

- Verify the same ANSI sample renders with the same colors in shell and log views for the shared palette cases.
- Verify raw ANSI logs still look like normal log rows in both dark and light themes.
- Verify metadata text, timestamps, and buttons remain visually distinct from ANSI-colored message text.

## Risks

- ANSI `inverse` may look odd if applied blindly inside mixed metadata/message rows.
- Faint/dim behavior may still require a practical approximation in CSS, but it should be a foreground-color transform rather than whole-row opacity.
- Some tests may currently rely on the existing muted palette.

## Rollout Strategy

1. Land the shared ANSI theme module.
2. Switch shell to the shared palette.
3. Switch log ANSI parsing to the shared palette and terminal-style attribute handling.
4. Verify log viewer behavior remains DOM-native.
5. Remove any obsolete log-specific ANSI palette code.

## Acceptance Criteria

- Raw ANSI logs no longer remap standard ANSI colors to app-specific muted substitute values.
- Shell and logs resolve ANSI colors from the same shared palette.
- Raw ANSI logs remain rendered in the existing DOM log viewer.
- Workload metadata controls still work in ANSI raw mode.
- Highlight and no-wrap still work in ANSI raw mode.
- No `xterm` surface is used for pod, workload, or node logs.
