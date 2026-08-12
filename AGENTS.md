# AGENTS.md

Luxury Yacht is a Wails v3 desktop app for viewing and managing Kubernetes
resources. The backend is Go; the frontend is React and TypeScript. Scoped
instructions in `backend/AGENTS.md` and `frontend/AGENTS.md` apply when work
touches those trees.

## Non-negotiable contracts

- **Ground every externally checkable claim.** Cite evidence gathered this turn
  (`file:line` or command and output) in the same statement, or prefix it with
  **`[unverified]`** / **`[assumed]`**. A code path is not runtime behavior, a
  producer is not its consumers, and a microbenchmark is not a system test.
  Without inline evidence, do not call code dead, unused, safe, complete, done,
  identical, impossible, fine, simple, trivial, tested, verified, near-zero, or
  claim no consumers or nothing else is affected.
- **Keep cluster data cluster-scoped.** Data access, refresh domains, caches,
  commands, persistence keys, navigation, events, and object actions carry
  `clusterId`. Fix touched code that drops, guesses, or ignores it.
- **Use complete object identity.** Boundary-crossing object references include
  `clusterId`, `group`, `version`, and `kind`; concrete objects also include
  `namespace` and `name`. Fix touched violations before building on them.
- **Solve the root contract.** Trace shared behavior, centralize duplicated
  logic, adjust affected consumers and tests, and do not add local workarounds
  or temporary compatibility paths.
- **Keep scope narrow but the affected path sound.** Do not expand into
  unrelated cleanup. If the correct solution is materially larger than the
  request, explain the tradeoff and ask before editing.
- **Use red/green/refactor TDD for behavior changes.** First run a new failing
  test that proves the requested behavior, then make it pass, then refactor
  under green. Documentation, comments, and trivial mechanical edits are exempt.
- **Do not run state-modifying git commands or create PRs unless explicitly
  directed.** Read-only git commands are allowed.

## Cross-layer changes

Before editing a backend/frontend boundary, lifecycle state, refresh domain,
cluster identity, permission, object reference, provider ordering, or
cache/stream contract, identify:

1. the producer and every affected consumer;
2. the ordering/readiness guarantees;
3. any circular-dependency risk; and
4. the regression test proving the real contract.

For gates, prove both that invalid early state is blocked and that the operation
needed to reach ready state remains allowed. Inspect the producer when the
source contract is unclear.

## Working rules

- Preserve unrelated worktree changes and existing project patterns.
- Do not change behavior, appearance, dependencies, or unrelated files unless
  required for the requested contract.
- Check upstream release and migration notes before adding a dependency; use a
  stable version compatible with `mise.toml`.
- Reuse existing selectors, helpers, hooks, services, classes, and boundaries.
- Add plain-language comments only where logic is not self-evident.
- The object catalog owns object existence, discovery, GVK/GVR identity,
  Browse, namespace metadata, and cluster listings. The informer-backed,
  permission-gated `namespaces` refresh domain owns namespace LIST rows; list
  denial fails explicitly and there is no catalog-inference fallback.
- Run repository tools through `mise exec --` when Mise is not already active.

## Validation

- Run focused tests during development and measure directly affected coverage
  with `mise exec -- wails3 task test:backend-coverage` or
  `mise exec -- wails3 task test:frontend-coverage`; target 80% statement coverage or
  report the measured gap and ask for guidance.
- Base final evidence on the latest worktree. Before reporting
  non-documentation work, run
  `mise exec -- wails3 task qc:prerelease`, then inspect the worktree because the gate
  may format files. Report exact failures. Documentation/comment-only work is
  exempt and must at least pass `git diff --check`.
- Rendered Wails UI validation uses the standalone Playwright MCP when
  available. Start the app with `mise exec -- wails3 dev`, use the emitted URL,
  and exercise relevant loading, error, empty, populated, navigation, and
  interaction states. Follow `.agents/setup/browser-automation.md`.

## Routing and documentation

- Use `.agents/README.md` only for broad, ambiguous, or cross-layer routing;
  narrow tasks should open the matching skill or owning doc directly.
- Use `docs/README.md` when ownership is unclear. Freshness work starts with
  `docs/architecture/data-freshness.md`.
- Durable contracts live in `docs/architecture`, frontend infrastructure in
  `docs/frontend`, workflows in `docs/workflows`, temporary phased plans in
  `docs/plans`, and release fragments in `docs/release/pending.md`.
- Move durable guidance out of a finished temporary plan before deleting it.
- Persistent agent memory belongs only in `.agents/memory/`; follow
  `.agents/setup/agent-memory.md` and never store credentials or transient logs.
