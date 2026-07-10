---
name: make-impossible-states-impossible
description: Use when eliminating representable-but-invalid states in Luxury Yacht — converting boolean flag-soup to discriminated unions, making required identity fields non-optional, replacing stringly-typed states with literal/typed enums, and pushing scattered runtime guards into the type system or a single chokepoint. Triggers — "make impossible states impossible", flag soup (isLoading/isError/isEmpty), contradictory nullable fields, kind-only/name-only object refs, stringly-typed status, or the docs/todo.md item of the same name.
---

# Make Impossible States Impossible

An **impossible state** is a value the type system *permits* but the domain
*forbids*: `{ isLoading: true, error: "x", data: [...] }` all at once, an object
ref with `kind` but no `clusterId`, a `status: string` that can hold `"loaidng"`.
The discipline is to change the *representation* so the compiler (TS) or a
constructor (Go) rejects the invalid value, deleting the runtime check that used
to catch it.

This is a structural refactor skill. It changes *types*, rarely behavior. Treat
every conversion as a behavior-preserving change proven by the compiler plus the
existing test suite — and add a test wherever a runtime guard is being removed.

## The one decision

For each impossible state, choose where to make it impossible:

1. **Type level (preferred).** Redesign so the bad value cannot be constructed:
   discriminated union, required field, typed enum, type-state. Then *delete* the
   runtime guard that became unreachable (see "Always remove dead code").
2. **Single chokepoint (when the type can't be tightened).** External/legacy
   shapes sometimes force a loose type — e.g. `KubernetesObjectReference` carries
   `[key: string]: unknown` for raw K8s objects and backwards-compat. There, the
   project keeps **one** validating chokepoint, not scattered checks. The canonical
   example is `assertObjectRefHasRequiredIdentity` in
   `frontend/src/shared/utils/objectIdentity.ts`, called once at
   `useObjectPanel.openWithObject` — it is an assertion function that narrows the
   loose ref to `ClusterObjectReference` in place, so everything past the
   chokepoint carries the required-identity type. Match that pattern; never
   sprinkle per-caller `if (!ref.clusterId)` checks.

Prefer the difficult-but-correct type-level fix over a new local guard
(AGENTS.md). Centralize at a chokepoint only when a true boundary makes the type
genuinely un-tightenable.

## Frontend smell → fix (TypeScript)

| Smell | Where it looks like | Fix |
|-------|---------------------|-----|
| **Flag soup** — booleans encoding one state | `port-forward/*` uses `isError`/`isStopping`/`isLoading` together | One `status` discriminated union. Good model already in repo: `useResourceInventoryTable.ts` derives `isEmpty` from `status === 'empty'`; `permissionTypes.ts` uses `status: 'loading' \| 'ready' \| 'error'`. |
| **Optional pair that must co-occur** | `{ error?; data? }` where exactly one is set | Variants: `{ status: 'error'; error }` \| `{ status: 'ready'; data }`. |
| **Nullable identity** | `KubernetesObjectReference extends NullableResourceRefFields` (every GVK field `?\| null`) | Narrow at a parse boundary into a **resolved** type with required fields — `ResolvedObjectReference` (GVK+name required) or, past a cluster-identity boundary, `ClusterObjectReference` (clusterId also required) in `shared/utils/objectIdentity.ts`. Downstream code takes the resolved type, not the nullable one. |
| **Stringly-typed state** | `status: string`, `phase: string` | Literal union; exhaustive `switch` with a `never` default. |
| **`[key: string]: unknown` escape hatch** | view-state raw-object shapes | Acceptable only at the external boundary; convert to a typed value immediately after, and don't let the loose type leak downstream. |

## Backend smell → fix (Go — no sum types)

| Smell | Fix |
|-------|-----|
| **`string`-typed state with a valid zero value** | Defined type + unexported field + constructor that validates. See `ClusterLifecycleState` (`backend/cluster_lifecycle.go`), `JobState` (`backend/refresh/types.go`), `HealthState` (`backend/objectcatalog/types.go`). Guard transitions in one method, not at every call site. |
| **Bool flag selecting behavior** | Type-state: distinct types per state so the wrong operation won't compile. |
| **Exported struct with invalid field combos** | Unexport fields; expose a constructor that rejects invalid combinations. The zero value should be either valid or unconstructable. |
| **Sum type needed** | Sealed interface (unexported marker method) + one small impl per case + exhaustive type switch with a `default` that errors/panics. |

## Workflow

1. **Scope.** Pick one module (frontend) or package (backend), or a single type.
   The todo is "all areas, ultimately" — do it one bounded area at a time.
2. **Audit** with the greps below; list candidate impossible states.
3. **Trace the contract first.** Any type that crosses backend/frontend, lifecycle,
   refresh domains, cluster identity, or object references is governed by AGENTS.md's
   Cross-Layer Contract Rule. Identify the producer, every consumer, and ordering
   before editing. Names are not contracts.
4. **Rank & present** like the `improve-*` skills: a numbered list, each with the
   invalid value it permits today and the proposed representation. Let the user pick
   one. Don't batch a module-wide rewrite into one step.
5. **Impact gate.** Before editing production source, write a fresh entry to
   `.claude/impact-analysis.md` (the hook blocks edits otherwise).
6. **TDD (required, AGENTS.md).**
   - *Red:* write a test that pins the behavior — for a chokepoint, that the
     invalid construction is rejected; for a union conversion, that consumers handle
     each variant. Confirm it fails for the right reason.
   - *Green:* change the type; let the compiler list the consumers to update.
   - *Refactor:* delete the now-unreachable runtime guards and any dead branch
     (bottom-up, same change).
7. **Verify:** `mage qc:prerelease` before reporting complete.

## Audit greps

```bash
# Flag soup: 2+ boolean state flags near each other
grep -rnE "is(Loading|Error|Fetching|Empty|Ready|Connected|Pending|Stopping)\b\s*[:?]" \
  frontend/src "--include=*.ts" "--include=*.tsx" | grep -vE "\.test\.|\.stories\."

# Stringly-typed states that should be literal unions
grep -rnE "(status|phase|state):\s*string\b" frontend/src "--include=*.ts" "--include=*.tsx"

# Existing good unions to emulate
grep -rnE "status:\s*['\"](loading|error|ready|idle|empty)['\"]" frontend/src

# Backend string-typed states (candidates for validated constructors)
grep -rnE "type\s+\w*(State|Status|Phase|Lifecycle)\s+string" backend "--include=*.go"
```

## What NOT to do

- Don't add a new scattered runtime `if`-guard when a type change or the existing
  chokepoint is the correct fix.
- Don't widen a type to silence the compiler — that re-introduces the impossible
  state. Update consumers instead.
- Don't drop or guess `clusterId`/GVK to make a ref "fit" a tighter type; a ref
  without full identity *is* the impossible state (AGENTS.md).
- Don't leave the old runtime check behind once a type makes it unreachable.
- Don't convert a whole module in one commit; one impossible state at a time, each
  proven by a test.
- Don't change runtime behavior under the guise of a type refactor without a test
  that names the behavior change.
