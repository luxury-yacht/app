# Shared Contracts

This document defines how Luxury Yacht owns contracts that must stay aligned
across backend, frontend, tests, and docs.

## Core Contract

Shared contracts are code-owned, not docs-owned.

Author a shared contract beside the subsystem that owns the enforcing behavior.
Other layers may consume that contract directly, but docs only describe and link
to it. Do not put authoritative contract data in `docs/`.

Use this pattern when a change creates a durable cross-layer table, schema, or
policy that more than one app layer must obey. Do not create parallel frontend
and backend allowlists with comments asking contributors to keep them in sync.

## Ownership

The owning subsystem is the layer that can enforce correctness when another
layer bypasses UI or helper code.

Examples:

- Refresh domain metadata is enforced by the refresh backend, so its authored
  contract lives at `backend/refresh/domain/refresh-domain-contract.json`.
- YAML mutation field policy is enforced by backend YAML policy code, so its
  authored contract lives beside that policy implementation at
  `backend/objectyaml/field-policy-contract.json`.
- Wire DTOs exposed through Wails are backend-owned Go types and are projected to
  frontend generated bindings.
- Pure frontend persistence/view contracts may live in frontend code when the
  backend does not enforce or consume them.

Do not use a neutral `docs/contracts` directory. It hides ownership and makes an
executable policy look like explanatory material.

## Contract Forms

Use the narrowest contract form that preserves one source of truth:

| Form                         | Use When                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Backend-authored JSON        | Both backend tests and frontend runtime need the same table or policy data.               |
| Backend Go DTO + Wails model | The contract is an RPC payload or app-state shape already exposed through Wails.          |
| Generated code from schema   | The contract is large or type-heavy enough that hand-maintained Go/TypeScript will drift. |
| Frontend TypeScript module   | The contract is frontend-only and has no backend enforcement or backend test consumer.    |

Do not introduce a generic shared directory unless it is a real build-supported
package or generated artifact home. A folder named `shared` is not a contract
system by itself.

## JSON Contract Rules

For backend-authored JSON contracts:

- Name files with a `*-contract.json` suffix.
- Include a `version` field.
- Keep entries keyed by stable identifiers, not display labels.
- Define TypeScript interfaces at the frontend import boundary.
- Define Go test structs in the backend contract test package.
- Validate unknown enum values in tests.
- Keep runtime enforcement in code owned by the enforcing subsystem.

Frontend imports of backend JSON contracts must be explicit and narrow. Follow
the existing refresh-domain precedent; do not make arbitrary backend code a
frontend import surface.

## Parity Tests

Every shared contract must have tests that fail when consumers drift.

For a backend-authored JSON contract, add bidirectional parity tests:

- every contract entry required by backend behavior is implemented by backend
  enforcement
- every backend-enforced entry is present in the contract
- every frontend-derived registry, descriptor, or policy helper uses the
  contract rather than a duplicated table

If a test intentionally documents current behavior before a refactor, name that
as characterization. Replace or flip those assertions in the same plan phase
where the desired contract changes.

## Documentation

Architecture and workflow docs should explain the behavior and link to the
authored contract. They should not duplicate the full contract table unless the
table is only illustrative.

When adding a new shared contract, update the owning architecture doc or this
page with:

- the contract file path
- the enforcing subsystem
- each consumer layer
- the parity test names
- any generation command, if generated code is involved

## Existing Examples

| Contract                                                | Owner                 | Consumers                                        | Notes                                                                                                                     |
| ------------------------------------------------------- | --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `backend/refresh/domain/refresh-domain-contract.json`   | Refresh backend       | Frontend refresh registry, backend tests         | Authored JSON contract imported directly by frontend registry code.                                                       |
| `backend/objectyaml/field-policy-contract.json`         | YAML mutation backend | YAML editor policy helpers, backend policy tests | Backend-owned field policy for live-object YAML protection, backend mutation behavior, and post-save semantic comparison. |
| Backend resource/type DTOs                              | Backend resources     | Wails generated frontend models                  | Use Wails generation/typecheck rather than separate TypeScript tables.                                                    |
| `backend/refresh/domainpermissions/spec.go`             | Refresh permissions   | Snapshot service, domain registration, resource-stream tests | Backend-only runtime and stream permission contract.                                                                      |
