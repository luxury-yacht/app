# Pre-edit checklist

Read this before editing. Follow linked guidance only for the affected work;
use [the docs index](../README.md) to find a subsystem's owning contract.

- **Confirm the requested scope.** Apply the user's latest accepted choices.
  Investigation or an unresolved alternative does not authorize implementation;
  an interaction change does not imply new controls or layout changes.
- **Find the shared owner and its consumers.** Reuse existing components and
  state owners. Check every affected consumer, including portals and native
  windows; moving files or changing one wrapper does not establish the contract.
- **Preserve identity and lifetime.** Carry cluster and complete object identity
  through boundaries. Distinguish renderer placement from runtime ownership,
  and keep React state updaters free of shared-store side effects. See
  [multi-cluster](../architecture/multi-cluster.md) and
  [panel ownership](../frontend/dockable-panels.md).
- **Check asynchronous ordering.** Trace admission, publication, acknowledgement,
  cancellation, and cleanup through the real owners. Exercise overlapping work,
  rejected operations, and recovery; prove that readiness gates allow the work
  needed to become ready. See [lifecycle](../architecture/application-lifecycle.md)
  and [refresh](../architecture/refresh-system.md).
- **Test observable behavior.** Use the real state owner at the smallest useful
  boundary. A mock's output does not prove its consumer, and coverage does not
  justify tests that freeze copy, styling, or implementation details. Follow
  [the testing standard](testing.md).
- **Match evidence to the claim.** A passing gate or screenshot cannot establish
  unexercised interactions. Check affected focus, selection, navigation, and
  native behavior through their real entry points; leave missing verification
  explicit. Follow [completion evidence](completion.md).
- **Measure changed code.** Check complexity before the final gate; preserve
  lifecycle ordering while extracting responsibilities. Local measurements and
  remote Sonar findings are separate evidence. Follow [Sonar guidance](../frontend/sonar.md).

## Keep this short

Keep this checklist to one page, roughly 50 lines. Improve an existing item before
adding one, and add only broadly recurring failure patterns. Put subsystem-specific
contracts in their existing owning docs and regression scenarios in tests. Delete
duplicated or superseded guidance; do not append fix histories, test inventories,
or task logs here. Shared guidance belongs in tracked docs, not ignored agent memory.
