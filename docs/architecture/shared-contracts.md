# Shared Contracts

A shared contract is data or policy consumed by more than one layer where
drift would create a bug. The enforcing subsystem owns it beside its code;
docs only name the rule and where to start.

## Rules

- Use the lightest enforceable form: a Go/TypeScript type when one layer owns
  and exports it; a JSON contract file when both layers need authored metadata;
  a generated Wails binding when Go owns the runtime shape; a parity test when
  two implementations must stay aligned; a doc summary only for architectural
  rules that cannot be encoded.
- Never add a parallel frontend/backend enum, registry, descriptor, or schema
  without a test that fails when one side changes without the other.
- Keep the join key between layers explicit and stable. Unknown enum or
  descriptor values must fail tests or degrade deliberately.
- A doc recording current behavior before a refactor is marked temporary and
  deleted when the refactor lands.

## Examples

- Refresh domain metadata and `refreshPayloadType` mappings:
  `backend/refresh/domain/refresh-domain-contract.json`
  ([refresh-system.md](refresh-system.md#domain-contract))
- Refresh HTTP/stream DTOs and snapshot envelope:
  `backend/internal/genrefreshcontracts/registry.go`, generated as
  `frontend/src/core/refresh/types.generated.ts`
- Resource identities: `backend/resourcecontract/builtin-resource-identities.json`
- Wails DTOs: `frontend/bindings`
- Reader wrappers: `frontend/src/core/data-access/readers.ts`,
  `frontend/src/core/app-state-access/readers.ts`
