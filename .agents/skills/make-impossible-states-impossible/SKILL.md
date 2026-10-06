---
name: make-impossible-states-impossible
description: Eliminate representable-but-invalid Luxury Yacht states with discriminated unions, required identity, typed status, validated constructors, or one boundary chokepoint; use for "make impossible states impossible", boolean flag soup, contradictory nullable fields, incomplete object refs, or stringly state
---

# Make Impossible States Impossible

An **impossible state** is a value the type system permits but the domain
forbids: `{ isLoading: true, error: "x", data: [...] }` at once, an object ref
with `kind` but no `clusterId`, a `status: string` holding `"loaidng"`. Change
the representation so the compiler (TS) or a constructor (Go) rejects the value,
then delete the runtime check that used to catch it.

This is a structural refactor: it changes types, rarely behavior. The compiler
plus the existing tests prove each conversion; add a test wherever a runtime
guard is removed.

## Where to make it impossible

1. **Type level (preferred).** Redesign so the bad value cannot be constructed
   (discriminated union, required field, typed enum, type-state), then delete
   the runtime guard that became unreachable.
2. **Single chokepoint (only when a true boundary keeps the type loose).**
   `KubernetesObjectReference` carries `[key: string]: unknown` for raw K8s
   objects, so the project keeps one validating chokepoint instead of scattered
   checks: `assertObjectRefHasRequiredIdentity` in
   `frontend/src/shared/utils/objectIdentity.ts`, called once per boundary entry
   (for example `useObjectPanel.openWithObject`). It is an assertion function
   that narrows the loose ref to `ClusterObjectReference` in place, so
   everything past it carries required identity. Match that pattern; never
   sprinkle per-caller `if (!ref.clusterId)` checks.

## Frontend smell → fix (TypeScript)

| Smell | Looks like | Fix |
| --- | --- | --- |
| **Flag soup** | `isLoading`/`isError`/`isStopping` booleans encoding one state | One `status` discriminated union. Models: `useResourceInventoryTable.ts` derives `isEmpty` from `status === 'empty'`; `permissionTypes.ts` uses `status: 'loading' \| 'ready' \| 'error'`. |
| **Optional pair that must co-occur** | `{ error?; data? }` with exactly one set | `{ status: 'error'; error }` \| `{ status: 'ready'; data }` |
| **Nullable identity** | `KubernetesObjectReference extends NullableResourceRefFields` (every GVK field `?\| null`) | Narrow at a parse boundary into `ResolvedObjectReference` (GVK + name required) or, past a cluster-identity boundary, `ClusterObjectReference` (`clusterId` also required), both in `shared/utils/objectIdentity.ts`. Downstream code takes the resolved type. |
| **Stringly-typed state** | `status: string`, `phase: string` | Literal union; exhaustive `switch` with a `never` default |
| **`[key: string]: unknown`** | view-state raw-object shapes | Only at the external boundary; convert to a typed value immediately and do not leak the loose type downstream |

## Backend smell → fix (Go, no sum types)

| Smell | Fix |
| --- | --- |
| **`string` state with a valid zero value** | Defined type + unexported field + validating constructor, e.g. `ClusterLifecycleState` (`backend/cluster_lifecycle.go`), `JobState` (`backend/refresh/types.go`), `HealthState` (`backend/objectcatalog/types.go`). Guard transitions in one method, not at call sites. |
| **Bool flag selecting behavior** | Type-state: distinct types per state so the wrong operation will not compile |
| **Exported struct with invalid field combos** | Unexport fields; a constructor rejects invalid combinations. The zero value is valid or unconstructable. |
| **Sum type needed** | Sealed interface (unexported marker method), one small impl per case, exhaustive type switch whose `default` errors/panics |

## Workflow

1. **Scope** one frontend module, backend package, or single type at a time.
2. **Audit** with the greps below and list candidate impossible states.
3. **Trace the contract** per the root cross-layer rules before editing any
   type that crosses a boundary, lifecycle, refresh domain, cluster identity,
   or object reference. Names are not contracts.
4. **Rank and present** like the `improve-*` skills: a numbered list, each with
   the invalid value it permits today and the proposed representation. Let the
   user pick one; never batch a module-wide rewrite.
5. **TDD.** Red: pin the behavior (for a chokepoint, that invalid construction
   is rejected; for a union, that consumers handle each variant). Green: change
   the type and let the compiler list consumers. Refactor: delete the
   now-unreachable guards and dead branches bottom-up in the same change.

## Audit greps

```bash
# Flag soup: 2+ boolean state flags near each other
rg -n -g '*.ts' -g '*.tsx' \
  "is(Loading|Error|Fetching|Empty|Ready|Connected|Pending|Stopping)\b\s*[:?]" \
  frontend/src | rg -v "\.(test|stories)\."

# Stringly-typed states that should be literal unions
rg -n -g '*.ts' -g '*.tsx' "(status|phase|state):\s*string\b" frontend/src

# Existing good unions to emulate
rg -n "status:\s*['\"](loading|error|ready|idle|empty)['\"]" frontend/src

# Backend string-typed states (candidates for validated constructors)
rg -n -g '*.go' "type\s+\w*(State|Status|Phase|Lifecycle)\s+string" backend
```

## Do not

- Add a scattered runtime `if` guard when a type change or the existing
  chokepoint is the correct fix.
- Widen a type to silence the compiler; that reintroduces the impossible state.
  Update consumers instead.
- Drop or guess `clusterId`/GVK to make a ref fit a tighter type; a ref without
  full identity is the impossible state.
- Leave the old runtime check once a type makes it unreachable.
- Convert a whole module in one change; one impossible state at a time, each
  proven by a test.
- Change runtime behavior under a type refactor without a test that names the
  behavior change.
