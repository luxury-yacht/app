# Deployment logs: React update-depth failure

Issue: [LUXURY-YACHT-FRONTEND-2Q](https://luxury-yacht.sentry.io/issues/7722326368/).
Investigation and validation: 2026-09-09.

## Evidence and cause

Sentry reported four v2.2.2 events, with the viewport effect in
`useVirtualizedLogRows` on the stack. It did not capture the log content, wrapping
preference, or exact gesture. `git diff v2.2.2 --
frontend/src/modules/object-panel/components/ObjectPanel/Logs` was empty before
the change.

The real RawLogViewer and LogViewer.css reproduced React's maximum-update-depth
error twice in Playwright with 1,000 synthetic long lines, wrapping, a 200px-wide
viewport, and a scroll to the end. The tall-row regression in
`RawLogViewer.test.tsx` also failed before the production change, at the
synchronous height-version update. Ordinary short-row tests passed before it.

Measured rows can be much taller than the 26px estimate. Updating the range then
mounts more unmeasured rows, whose ref callbacks synchronously update React
state again. The fix coalesces height-version notifications into animation
frames, cancels pending work on unmount, and clears measurements during cleanup
so StrictMode replay can establish them again.

This establishes a reproducible cause of this error in the reported renderer.
The original affected Deployment in its desktop environment has not been retried;
the precise production trigger remains unverified.

## Ownership and ordering

- Producer: DOM row measurements and ResizeObserver callbacks in
  `Logs/hooks/useVirtualizedLogRows.ts`.
- Consumers: `Logs/RawLogViewer.tsx`, used by `Logs/LogViewer.tsx:969` and
  `NodeLogs/NodeLogsTab.tsx:588`.
- Row refs measure after DOM attachment. Cache writes remain immediate;
  React's height-version notification occurs at most once per frame. Scroll
  and viewport observation retain their existing ordering.
- No new imports or dependency edges were added to the production hook
  (`git diff -- .../Logs/hooks/useVirtualizedLogRows.ts`).
- The regression uses the real viewer and hook; jsdom layout, ResizeObserver,
  and animation-frame scheduling are controlled fixtures. Existing LogViewer
  tests mock backend reads, orchestration, and surrounding controls.

## Review follow-up

The follow-up review agreed with the crash fix but identified weak test
assertions and missing evidence about convergence and StrictMode replay.

- Removed the extra Deployment measurement test. Its row-count assertion also
  passed with measurement disabled and duplicated the existing large-buffer test.
- The tall-row test now covers 200, 400, 1,700, and 3,000px rows. A temporary
  counter probe measured 23, 45, 192, and 170 frames respectively after scrolling.
  The probe was removed. A separate 250-frame convergence assertion now reports
  excessive layout work; the runaway guard allows 1,000 frames instead of 200.
- Retained `heights.clear()` with new evidence: the StrictMode case starts before
  viewport sizing, so a viewport-state update cannot conceal a lost measurement
  notification. Temporarily removing the clear made the rendered-height assertion
  fail: `expected 5216 to be greater than 5216`. Restoring it passed.
- Both measurement assertions include the 16px padding in their unmeasured
  baseline. Temporarily replacing all row measurements with zero made both fail
  at 5,216px. Restoring measurements passed all nine RawLogViewer cases.
- Hoisted RawLogViewer's key extractor to a stable module function. This avoids
  invalidating the key-pruning effect on each measurement update. The position
  array still recomputes when the height-cache version changes; this is not a
  claim that per-frame position rebuilding was eliminated.

### Measured browser settling cost

Playwright used HeadlessChrome 149 on the local Wails Vite URL, with the real
RawLogViewer, LogViewer.css, and optional useLogScrollRestoration. The synthetic
buffer contained 1,000 long lines in a 200×600px viewport; wrapped rows measured
1,729.59375px. A frame sampler watched virtual height, offset, visible row keys,
and scroll position until ten consecutive frames were unchanged. Times below
end at the last observed change, excluding the final ten confirmation frames.

| Scenario | Settling time | Result |
| --- | --- | --- |
| Raw viewer jump into unmeasured wrapped rows, run 1 | 1,634 ms | 206 observed frames including confirmation; no captured renderer error. |
| Same, run 2 | 1,632 ms | 206 observed frames including confirmation; no captured renderer error. |
| Initial mount with real tail-following hook enabled | 583 ms | Final row 999 visible; scrollHeight − scrollTop − clientHeight = 0. |
| Raw viewer jump with wrapping disabled | 67 ms | Final row 999 visible; no captured renderer error. |

The extreme wrapped-row case still takes substantial time to settle. The crash
fix does not eliminate that layout work. These are local browser measurements,
not timings from the original Deployment or its native desktop renderer. This
record remains because that original retry is pending.

## Completion evidence

| Criterion | Status | Evidence |
| --- | --- | --- |
| Reproduce before fixing | Passed | RawLogViewer regression failed with maximum update depth; two Playwright failures using real CSS. |
| Tall-row scroll settles without recursive updates | Passed | RawLogViewer regression passed after frame batching. |
| Resize, filter, empty result, StrictMode, cleanup | Passed | Nine RawLogViewer tests passed; removing cleanup or neutralizing measurements now fails the intended rendered-height assertions. |
| Shared log consumers | Passed | Review follow-up: Logs and NodeLogs suites passed 199 tests in 16 files. |
| Browser layout and tail-following | Passed | Real RawLogViewer plus useLogScrollRestoration: append, width 200→700, wrap on→off, 2→0→150 rows; no captured renderer errors, following intent retained, distance to bottom 0. |
| Typecheck | Passed | `mise exec -- npm run typecheck --prefix frontend`, exit 0. |
| Coverage | Passed | Review follow-up: `mise exec -- wails3 task test:frontend-coverage`, exit 0; 518 files / 4,867 tests. Hook statements 96% (120/125), RawLogViewer 100% (15/15). |
| Local cognitive complexity | Passed | Review run, Biome diagnostic threshold 1: RawLogViewer 3, key helper at most 1, hook 2, scheduler 2, cleanup 6; all callbacks in both production files at most 10. No remote Sonar closure claimed. |
| Prerelease gate and final worktree inspection | Passed | Review follow-up: `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease`, exit 0. Backend race tests, lint/typecheck, 4,867 frontend tests, knip, and Trivy passed. Final `git diff --check` passed; only the hook, RawLogViewer, its new tests, shared prevention guidance, and this record were changed. |
| Original Deployment desktop retry | Pending | Browser Wails runtime requests returned 404; browser checks used synthetic data and real rendering components. Native backend transport was not simulated as production evidence. |

Initial-run logs use `/tmp/luxury-yacht-logs-*`; review follow-up logs use
`/tmp/luxury-yacht-logs-review-*`. Generated coverage reports are moved outside
the frontend tree before the final gate to keep HTML out of source linting.
These local logs are temporary evidence, not repository artifacts.

Shared prevention guidance lives in `docs/workflows/common-mistakes.md` under
“Publishing virtual row measurements during ref commits.”
