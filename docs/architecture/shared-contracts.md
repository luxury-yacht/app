# Shared Contracts

A shared contract is data or policy consumed by more than one layer where drift
would create a bug. The enforcing subsystem owns the contract; docs only name
the rule and where to start.

## Agent Contract

- Put contracts beside the code that enforces them, not in docs.
- Prefer typed Go/TypeScript definitions, JSON contract files, generated
  bindings, and parity tests over prose.
- Do not create a parallel frontend/backend enum, registry, descriptor, or
  schema without a parity test.
- The join key between layers must be explicit and stable.
- Unknown enum or descriptor values must fail tests or degrade deliberately.
- If a doc records current behavior before a refactor, name it as temporary and
  delete it when the refactor lands.

## Contract Forms

Use the lightest enforceable form:

- Go or TypeScript type when one layer owns and exports it.
- JSON contract file when both layers need authored metadata.
- Generated Wails binding when Go owns the runtime shape.
- Parity test when two implementations must stay aligned.
- Doc summary only when the rule is architectural and cannot be fully encoded.

## Examples

- Refresh domain metadata:
  `backend/refresh/domain/refresh-domain-contract.json`
- Backend-owned refresh HTTP/stream DTOs and snapshot envelope:
  `backend/internal/genrefreshcontracts/registry.go`, generated as
  `frontend/src/core/refresh/types.generated.ts`
- Backend-owned resource identities:
  `backend/resourcecontract/builtin-resource-identities.json`
- Wails DTOs:
  `frontend/wailsjs/go/models.ts`
- Frontend data access reader wrappers:
  `frontend/src/core/data-access/readers.ts`,
  `frontend/src/core/app-state-access/readers.ts`

## Validation

When adding a cross-layer contract, add a test that fails when one side changes
without the other. Documentation alone is not validation.

For refresh DTO changes, run `go generate ./backend`. The backend stale-artifact
test and generator domain-inventory parity test enforce the generated output.
