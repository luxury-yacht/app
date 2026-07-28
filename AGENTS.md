# AGENTS.md

You are a developer working on Luxury Yacht, a multi-platform Wails v2 desktop
app for viewing and managing Kubernetes cluster resources.

The backend is Go. The frontend is React and TypeScript. Area-specific rules
live in `backend/AGENTS.md` and `frontend/AGENTS.md`; follow those in addition
to this file when working in those directories.

## Rules

### Critical Rules

You MUST follow these at all times.

- **GROUND EVERY EXTERNALLY CHECKABLE CLAIM.** In the same statement, cite
  evidence gathered this turn (`file:line` or command and output), or prefix the
  claim with **`[unverified]`** / **`[assumed]`**. Do not extrapolate beyond the
  evidence: a code path is not runtime behavior, a producer is not its consumers,
  and a microbenchmark is not a system test. These words are banned about code
  without inline evidence: dead, unused, safe, complete, done, identical,
  impossible, fine, simple, just, trivial, no consumers, nothing else, near-zero,
  tested, verified.
- **EVERY PART OF THE APP MUST BE MULTI-CLUSTER AWARE.** Data access, refresh
  domains, caches, commands, persistence keys, navigation, events, and object
  actions must carry `clusterId` when operating on cluster data. Fix touched
  code that drops, guesses, or ignores `clusterId`.
- **ALL OBJECT REFERENCES MUST INCLUDE `clusterId`, `group`, `version`, AND
  `kind`.** Include `namespace` and `name` whenever the reference points to a
  specific Kubernetes object. Do not pass kind-only or name-only references
  across module, API, cache, event, action, or navigation boundaries. Fix
  touched code that violates this before building on top of it.
- **SOLVE THE ROOT PROBLEM WITH A COMPLETE, CORRECT SOLUTION.** Trace shared
  behavior, centralize duplicated logic, and adjust tests when the contract
  requires it; do not add a local workaround because it is easier to write.
- **DON'T LEAVE TECH DEBT IN THE AFFECTED CODE PATH.** Leave touched behavior
  understandable, tested at the appropriate level, and free of dead code or
  temporary compatibility paths. Do not expand into unrelated cleanup. If the
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

#### Cross-Layer Contract Rule

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
- When adding dependencies, use the latest stable version compatible with the
  pinned toolchain and framework contracts. Check upstream release and migration
  notes before adopting it.
- Match existing patterns by reusing selectors/classes, helpers, hooks, and
  service boundaries instead of creating parallel implementations.
- Ask clarifying questions when the problem is unclear; ask for help when
  stuck.
- When blocked, first inspect the relevant code and tests, then explain the
  concrete blocker. Do not invent fallback behavior, skip required identity
  fields, or leave TODO-only implementations to keep moving.
- Add comments where the logic is not self-evident, using plain language.
- Treat the object catalog as the source of truth for object existence,
  discovery, GVK/GVR identity, Browse, and cluster listings. The app's
  namespace LIST is owned by the `namespaces` refresh domain (informer-backed,
  permission-gated — no list permission fails fast with an explicit message;
  there is no catalog-inference fallback). See the
  [backend object catalog rules](backend/AGENTS.md#object-catalog).
- Before presenting non-documentation, non-comment-only work as complete, run
  `mise exec -- mage qc:prerelease`. Inspect the worktree afterward because the
  gate includes formatting fixes.
- You do not need to rerun the gate after every edit, but the final reported
  state must be based on the latest worktree. If the gate cannot run, or fails
  because of unrelated changes, report the command and failure. Documentation-only
  and comment-only changes are exempt.
- For changed behavior, aim for at least 80% statement coverage in the directly
  affected package or module. Measure with
  `mise exec -- mage test:backendCoverage` or
  `mise exec -- mage test:frontendCoverage`, as applicable. If the affected scope
  cannot be measured meaningfully or the target is infeasible, report the measured
  scope and gap and ask for guidance.

## Tooling, Memory, and UI Validation

- `mise.toml` is the canonical source for development-tool versions. In
  automation or any shell where Mise is not activated, run repository commands
  through `mise exec --`.
- All agents performing rendered Wails UI validation must use the standalone
  Playwright MCP tools directly when they are available. Do not route Wails UI
  checks through an unrelated browser integration that cannot access the
  registered Playwright server, and do not ask the user for screenshots while
  the local UI is reachable.
- Start a required development server with `mise exec -- mage dev`, determine
  its active URL from command output, and exercise relevant loading, error, empty,
  populated, navigation, and interaction states in proportion to the change.
- Follow [.agents/setup/browser-automation.md](.agents/setup/browser-automation.md)
  for the shared browser workflow plus runtime-specific discovery and repair.
- All agents must treat `.agents/memory/` as this repository's memory directory.
  Agents that support persistent memory must configure it to use that directory,
  not a user-global or home-directory location. Follow
  [.agents/setup/agent-memory.md](.agents/setup/agent-memory.md), and never store
  credentials, secrets, or transient debugging output in persistent memory.

## Documentation

- For large or cross-layer agent work, start with `.agents/README.md` after
  reading this file. It routes common tasks to the right skills, docs, code
  paths, and validation checks.
- Start with `docs/README.md` when you are unsure which contract applies.
- For refresh timing, retained-first rendering, foreground/background work,
  streams, polling fallback, or metrics demand, start with
  `docs/architecture/data-freshness.md`.
- Durable architecture docs go in `docs/architecture`; frontend infrastructure
  docs go in `docs/frontend`; workflow-specific docs go in `docs/workflows`.
- Phased implementation plans go in `docs/plans`; mark items ✅ as completed.
  When a temporary plan is complete, move any durable architecture, workflow, or
  agent guidance into the appropriate docs or skills before deleting the plan.
- Release-note fragments go in `docs/release/pending.md`.
