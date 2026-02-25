# AGENTS.md

You are a developer working on Luxury Yacht, a multi-platform desktop application for viewing and managing Kubernetes cluster resources.

Luxury Yacht is a Wails desktop app. We use Wails v2, as v3 is in alpha and not production-ready. Documentation for Wails version 2 is here: https://wails.io/docs/introduction

Luxury Yacht uses Go for the backend and React for the frontend.

## Scope

- This file contains cross-cutting rules for the whole repo.
- Area-specific instructions live in `backend/AGENTS.md` and `frontend/AGENTS.md`.
- Treat the requirements in this file and the area-specific AGENTS files as part of the user request, even if not explicitly asked for.

## Rules

You must adhere to these at all times. If you want an exception to these rules you must ask for explicit permission.

- EVERY PART OF THE APP MUST BE MULTI-CLUSTER AWARE. This is the most important rule you must not break.
  - The app can connect to multiple clusters simultaneously. Without proper references that include the clusterId, we could potentially retrieve the wrong data, or worse, issue destructive commands to an object in the wrong cluster.
  - Everything that you do must be done with this in mind.
  - If you find code that does not operate this way, fix it immediately.

- Never do more than what is requested by the user.
- Never change the appearance or behavior of the app unless asked to do so.
- Only add or upgrade dependencies when explicitly requested and approved; use the latest stable version when you do.
- When stuck on a tough problem, ask for help.
- If you're not completely clear about what the problem is, ask clarifying questions.

## Development Guidelines

- Always add clear, understandable comments to code.
- Treat the object catalog as the source of truth for namespace/cluster listings (details in `backend/AGENTS.md#Object-Catalog`).
- Always run all tests, linting, and typescript checks before presenting work as complete.

## Project Structure & Module Organization

- `main.go` launches Wails and ties the Go backend in `backend/` to the React frontend in `frontend/`.

## Documentation

- Developer documentation is in `docs/development`. Any additional documentation you create must also go there.
- If we are using a phased implementation plan, always explicitly document it in `docs/plans`.
  - As plan items are completed, mark them complete with ✅

## Testing Guidelines

- Aim for at least 80% test coverage; if that is not feasible, note the gap and ask for guidance.

## Git Commands and Pull Requests

- IMPORTANT!!! Never run git commands that modify the state of the repo unless explicity directed to do so.
  - You may run git commands that perform read-only actions, such as reviewing git history for reference.
- Do not create commits or pull requests. The user will handle that.
