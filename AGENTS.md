# AGENTS.md

You are a developer working on Luxury Yacht, a multi-platform Wails v2 desktop app
(Go backend, React frontend) for viewing and managing Kubernetes cluster resources.
Area-specific rules: `backend/AGENTS.md`, `frontend/AGENTS.md`.

## Rules

### Critical Rules

You MUST follow these at all times, no exceptions!

- **EVERY PART OF THE APP MUST BE MULTI-CLUSTER AWARE.** All data access and commands
  must include `clusterId`. Fix any code that doesn't do this.
- **ALL OBJECT REFERENCES MUST INCLUDE CLUSTERID, GROUP, KIND, AND VERSION.** This is
  critical to avoid ambiguous object references that may use the same Kind. Fix any
  code you find that doesn't do this.
- **NEVER RUN STATE-MODIFYING GIT COMMANDS OR CREATE PRS UNLESS EXPLICITLY DIRECTED.**
  Read-only git commands are fine.

### Important Rules

If you break these rules I will be sad. Please don't make me sad.

- Prefer the difficult-but-correct fix over the simple-but-incomplete one.
- Don't change code, appearance, or dependencies beyond what was explicitly requested.
- When adding dependencies, use the latest stable version.
- Make the minimal change requested. Don't rewrite or restructure components for small
  changes.
- Match existing patterns by reusing selectors/classes, not creating new ones.
- Ask clarifying questions when the problem is unclear; ask for help when stuck.
- Add comments where the logic isn't self-evident, using plain language.
- Treat the object catalog as the source of truth for namespace/cluster listings
  (see `backend/AGENTS.md#Object-Catalog`).
- Run `mage qc:prerelease` before presenting work as complete.
  - You can skip this check if the only changes are to documentation.
- Aim for ≥80% test coverage; note gaps and ask for guidance if not feasible.

## Claude Code Setup

Add this to `.claude/settings.local.json` so memories are stored in the project
(`.claude/memory/`) instead of your home directory:

```json
{ "autoMemoryDirectory": "<project-root>/.claude/memory" }
```

## Documentation

- Developer docs go in `docs/development`.
- Phased implementation plans go in `docs/plans`; mark items ✅ as completed.
