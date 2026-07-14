### Changed

**User-facing changes**

- Added an Applications view that groups namespace workloads using Helm metadata,
  recommended application labels, and owner references, with visible confidence,
  health, workload counts, and ungrouped-workload disclosure.
- The filtered data message now properly calculates "[count] of [total] items visible"
- Previous/next pagination is now `ctrl+←/→` (`cmd+←/→` on macOS) to prevent conflicts when the arrow keys are used for horizontal scroll in wide tables.
- YAML editor now has line wrap, enabled by default, can be toggled from the toolbar.
- Confirmation dialogs initially focus the non-destructive Cancel action.

**Developer-facing changes**

- Backend/frontend refresh contract overhaul:
  - Backend DTOs, enums, stream messages, snapshot envelopes, and refresh-domain payload mappings now generate the frontend TypeScript contracts and runtime validators from one source of truth.
  - Stale generated output, missing domain registrations, invalid enum mappings, and backend/frontend domain drift now fail automated checks.
  - Refresh HTTP, streaming, telemetry, diagnostics, and resource-query consumers now use the backend-owned contracts instead of parallel handwritten frontend definitions.
- Frontend architecture and quality overhaul:
  - Replaced ESLint and Prettier with Biome.
  - Enabled stricter accessibility, React lifecycle, correctness, performance, import-cycle, type-safety, and CSS rules, then updated the frontend to satisfy them.
  - Added enforced boundaries for data access, cluster lifecycle and permission reads, generated backend bindings, and refresh-orchestrator access.
  - Added policy checks that prevent required rules and architectural plugins from being weakened and require narrowly scoped, documented suppressions.

### Fixed

- The Actions menu in the Details tab stays visible when screen space is limited (fixes https://github.com/luxury-yacht/app/issues/261).
- The "Logs are hidden for [n] containers" warning in the logs view now clears once it no longer applies, instead of sticking around until the logs view was closed.
- If the logs stream delivers malformed data, the logs view now shows an error instead of loading forever.
- Select All/Select None buttons now work correctly in dropdowns.
