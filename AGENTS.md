# AGENTS.md

You are a developer working on Luxury Yacht, a multi-platform Wails v2 desktop
app for viewing and managing Kubernetes cluster resources.

The backend is Go. The frontend is React and TypeScript. Area-specific rules
live in `backend/AGENTS.md` and `frontend/AGENTS.md`; follow those in addition
to this file when working in those directories.

## Rules

### Critical Rules

You MUST follow these at all times.

- **GROUND EVERY CLAIM (externally checkable; overrides fluency).** Every
  statement about how the code or system behaves must, in the same breath,
  either **(a)** cite the evidence gathered _this turn_ — a `file:line` or the
  command and its output — or **(b)** be prefixed **`[unverified]`** /
  **`[assumed]`**. A claim with neither is a violation, no matter how obvious it
  seems. These words are **banned about code without an inline citation**: dead,
  unused, safe, complete, done, identical, impossible, fine, simple, just,
  trivial, no consumers, nothing else, near-zero, tested, verified. To use one,
  run the check first and cite it, or don't say it. **Never extrapolate one
  verified fact into a system-level conclusion** — a code path is not runtime
  behavior, a producer is not its consumers, a microbench is not a system test;
  each is a separate claim needing its own evidence. If a load-bearing claim
  isn't backed by a check you ran this turn, run it — or say "I have not verified
  this" — before stating it. Enforcement does not rely on self-assessment: a
  reviewer can confirm a violation by the absence of an inline citation alone.
- **EVERY PART OF THE APP MUST BE MULTI-CLUSTER AWARE.** Data access, refresh
  domains, caches, commands, persistence keys, navigation, events, and object
  actions must carry `clusterId` when operating on cluster data. Fix touched
  code that drops, guesses, or ignores `clusterId`.
- **ALL OBJECT REFERENCES MUST INCLUDE `clusterId`, `group`, `version`, AND
  `kind`.** Include `namespace` and `name` whenever the reference points to a
  specific Kubernetes object. Do not pass kind-only or name-only references
  across module, API, cache, event, action, or navigation boundaries. Fix
  touched code that violates this before building on top of it.
- **SOLVE THE ROOT PROBLEM WITH THE CLEANEST COMPLETE, CORRECT SOLUTION** — even
  when that's harder to write than a local patch. "Cleanest" means clear, direct,
  and maintainable; it never means partial, fragile, or narrowly worked around.
- **PREFER THE DIFFICULT-BUT-CORRECT FIX OVER THE SIMPLE-BUT-INCOMPLETE FIX.**
  If the correct fix requires tracing shared behavior, centralizing duplicated
  logic, or adjusting tests, do that work instead of adding another local
  workaround.
- **DON'T LEAVE TECH DEBT IN THE CODE YOU TOUCH.** When changing a file, leave
  the affected code path complete, understandable, tested at the appropriate
  level, and free of dead code or temporary compatibility paths. Do not expand
  scope into unrelated cleanup unless it is required for a correct fix. If the
  correct fix is materially larger than requested, explain the tradeoff and ask.
- **PRACTICE RED/GREEN/REFACTOR TDD FOR EVERY BEHAVIOR CHANGE.** Write a
  failing test that specifies the behavior first, run it, and confirm it fails
  for the right reason (red) — a test that passes before the change is written
  is invalid. Then write the minimum code to make it pass (green), then
  refactor under green. Work in tight cycles, one behavior at a time. Never
  change logic from a mental model and defer verification to the user or a
  later manual check; the test must prove the behavior before anyone reviews
  it. Documentation-only, comment-only, and trivial mechanical edits are exempt.
- **NEVER RUN STATE-MODIFYING GIT COMMANDS OR CREATE PRS UNLESS EXPLICITLY
  DIRECTED.** Read-only git commands are fine.

  ### Cross-Layer Contract Rule

  Before changing code that crosses backend/frontend boundaries, lifecycle state,
  refresh domains, cluster identity, permissions, object references, provider
  ordering, or cache/stream behavior, first trace the contract from source to
  consumer.

  Do not edit until you can identify:
  - the producer of the state/data/event,
  - every consumer affected by the change,
  - the ordering guarantees between producer and consumer,
  - whether the proposed fix can create a circular dependency,
  - the exact regression test that proves the real contract.

  Names are not contracts. Verify lifecycle states, readiness flags, permissions,
  and identity fields at their source before using them as gates.

  For readiness or gating changes, explicitly prove both sides:
  - the gate blocks the invalid early state,
  - the gate still allows the operation required to reach the later ready state.

  If the correct source contract is unclear, stop and inspect the producer code
  instead of applying a local frontend/backend workaround.

### Important Rules

- Keep changes as small as possible while still being complete and correct.
  Small means narrow in scope, not shallow in quality.
- Do not change behavior, appearance, dependencies, or unrelated files unless
  the requested work cannot be completed correctly without doing so.
- Avoid broad rewrites for small requests, but do not preserve a bad structure
  when that structure is the source of the bug or repeated failures.
- When adding dependencies, use the latest stable version.
- Match existing patterns by reusing selectors/classes, helpers, hooks, and
  service boundaries instead of creating parallel implementations.
- Ask clarifying questions when the problem is unclear; ask for help when
  stuck.
- When blocked, first inspect the relevant code and tests, then explain the
  concrete blocker. Do not invent fallback behavior, skip required identity
  fields, or leave TODO-only implementations to keep moving.
- Add comments where the logic is not self-evident, using plain language.
- Treat the object catalog as the source of truth for namespace and cluster
  listings. See `backend/AGENTS.md#Object-Catalog`.
- Before presenting non-documentation, non-comment-only work as complete, run
  `mage qc:prerelease`
- You do not need to rerun these checks after every edit during a task, but the
  final reported state must be based on the latest code in the worktree.
- If a check cannot be run, or fails because of pre-existing unrelated changes,
  state that clearly and include the command and failure.
- Skip these checks only when the change is documentation-only or comment-only.
- Aim for at least 80% test coverage. Note gaps and ask for guidance if that is
  not feasible.

## Claude Code Setup

Add this to `.claude/settings.local.json` so memories are stored in the project
(`.claude/memory/`) instead of your home directory:

```json
{ "autoMemoryDirectory": "<project-root>/.claude/memory" }
```

## Documentation

- For large or cross-layer agent work, start with `.agents/README.md` after
  reading this file. It routes common tasks to the right skills, docs, code
  paths, and validation checks.
- Start with `docs/README.md` when you are unsure which contract applies.
- Durable architecture docs go in `docs/architecture`; frontend infrastructure
  docs go in `docs/frontend`; workflow-specific docs go in `docs/workflows`.
- Phased implementation plans go in `docs/plans`; mark items ✅ as completed.
  When a temporary plan is complete, move any durable architecture, workflow, or
  agent guidance into the appropriate docs or skills before deleting the plan.
- Release-note fragments go in `docs/release/pending.md`.
