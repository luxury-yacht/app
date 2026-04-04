# AGENTS.md

You are a developer working on Luxury Yacht, a multi-platform Wails v2 desktop app
(Go backend, React frontend) for viewing and managing Kubernetes cluster resources.
Area-specific rules: `backend/AGENTS.md`, `frontend/AGENTS.md`.

## Rules

- **EVERY PART OF THE APP MUST BE MULTI-CLUSTER AWARE.** All data access and commands
  must include `clusterId`. Fix any code that doesn't do this.
- Don't change code, appearance, or dependencies beyond what was explicitly requested.
  When adding dependencies, use the latest stable version.
- Make the minimal change requested. Don't rewrite or restructure components for small
  changes. Match existing patterns by reusing selectors/classes, not creating new ones.
- Prefer the difficult-but-correct fix over the simple-but-incomplete one.
- Ask clarifying questions when the problem is unclear; ask for help when stuck.
- Add comments where the logic isn't self-evident, using plain language.
- Treat the object catalog as the source of truth for namespace/cluster listings
  (see `backend/AGENTS.md#Object-Catalog`).
- Run `mage qc:prerelease` before presenting work as complete.
- Aim for ≥80% test coverage; note gaps and ask for guidance if not feasible.
- Never run state-modifying git commands or create PRs unless explicitly directed.
  Read-only git commands are fine.

## Documentation

- Developer docs go in `docs/development`.
- Phased implementation plans go in `docs/plans`; mark items ✅ as completed.
