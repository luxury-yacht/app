# Pre-edit checklist

Read this before editing. Follow linked guidance only for the affected work;
use [the docs index](../README.md) to find a subsystem's owning contract.

- **Confirm the requested scope.** Apply the user's latest accepted choices.
  Investigation or an unresolved alternative does not authorize implementation;
  an interaction change does not imply new controls or layout changes.
- **Find the shared owner and its consumers.** Reuse existing components and
  state owners. Check every affected consumer, including portals and native
  windows; moving files or changing one wrapper does not establish the contract.
- **Preserve identity and lifetime.** Distinguish renderer placement from
  runtime ownership, and keep React state updaters free of shared-store side
  effects. See [multi-cluster](../architecture/multi-cluster.md) and
  [panel ownership](../frontend/dockable-panels.md).
- **Check asynchronous ordering.** Trace admission, publication, acknowledgement,
  cancellation, and cleanup through the real owners. Exercise overlapping work,
  rejected operations, and recovery. See
  [lifecycle](../architecture/application-lifecycle.md) and
  [refresh](../architecture/refresh-system.md).
- **Test observable behavior** at the smallest useful boundary with the real
  state owner. Follow [the testing standard](testing.md).
- **Match evidence to the claim.** A passing gate or screenshot cannot establish
  unexercised interactions. Check affected focus, selection, navigation, and
  native behavior through their real entry points. Follow
  [completion evidence](completion.md) and [Sonar guidance](../frontend/sonar.md).

Keep this checklist to one page (about 50 lines): no test inventories or task
logs, and shared guidance belongs in tracked docs, not ignored agent memory.
