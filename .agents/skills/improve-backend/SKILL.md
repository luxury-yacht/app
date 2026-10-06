---
name: improve-backend
description: Use when wanting to systematically improve the Go backend - scans for security vulnerabilities, stability risks, performance issues, and code simplification opportunities, then presents 5 ranked findings for the user to choose from
---

# Improve Backend

Scan the Go backend, present exactly 5 concrete findings ranked security >
stability > performance > simplicity, wait for the user to pick one (or ask for
a rescan of another area), then fix only that one.

`/improve-backend [area]` takes an optional focus area (for example `refresh`,
`resources`, `portforward`, `objectcatalog`); without one, scan broadly.

## Scan

With `[area]`, limit discovery to that package tree. Otherwise sample 8-12
files across packages, weighted toward recent git activity (fresh churn often
harbors fresh bugs) or high line counts. Open frontend contracts only when a
candidate crosses into a frontend consumer. Check the tiers in order:

| Tier | Category | Look for |
| --- | --- | --- |
| Security | Input validation | Unvalidated user/API input reaching `os/exec`, `filepath.Join`, label selectors, or K8s API calls |
| Security | Secret exposure | Tokens, secrets, or kubeconfig credentials logged, returned in errors, or stored in plain text outside the intended persistence layer |
| Security | RBAC gaps | K8s writes or operations that skip permission/capability checks |
| Security | Concurrency | Shared mutable state (maps, structs) touched by several goroutines without synchronization |
| Security | Error handling | Swallowed errors (`_ = f()`) or sensitive details in errors sent to the frontend |
| Security | Dependency risk | `go.mod` versions with known CVEs |
| Stability | Resource leaks | Unclosed HTTP bodies; watchers, informers, or goroutines not stopped on context cancellation |
| Stability | Nil safety | Dereferences of optional K8s pointer fields without nil checks |
| Stability | Error propagation | `return err` without `fmt.Errorf("doing X: %w", err)` context |
| Stability | Context discipline | Long operations ignoring cancellation; blocking calls without timeouts |
| Stability | Graceful shutdown | Goroutines, resources, or watchers that outlive app shutdown or ignore stop channels |
| Stability | Multi-cluster | Paths that assume one cluster or ignore `clusterId` |
| Performance | Redundant K8s calls | Consolidatable calls, or fetching data the object catalog already has |
| Performance | Missing caching | Repeated expensive work whose result is stable within a refresh cycle |
| Performance | Allocation waste | Unsized slices/maps in hot paths, string concatenation in loops, copies of large structs |
| Performance | Blocking bindings | Synchronous work on the Wails binding thread that should be async |
| Performance | N+1 | Per-item API calls where a list call would work |
| Simplicity | Dead code | Exported functions/types with no callers, unreachable branches, commented-out blocks |
| Simplicity | Duplication | Copy-pasted logic across resource handlers or packages |
| Simplicity | Over-abstraction | Single-implementation interfaces, value-free wrappers, needless indirection |
| Simplicity | Consolidation | Near-identical small functions that could be unified |
| Simplicity | Stale patterns | Patterns the rest of the codebase has moved away from |

For each finding, note cross-boundary effects: the frontend assumes a response
shape the fix would change, must stop sending certain data, or could simplify
its caching after the fix.

## Present

List findings in priority order, then by impact within a tier:

```
N. **[SECURITY|STABILITY|PERFORMANCE|SIMPLICITY] Category — file:line**
   One-line description of the issue.
   Impact: What could go wrong / what improves.
   [Cross-boundary: frontend effect, if any]
```

Then ask: **"Which one should we fix? (pick a number, or say 'rescan' for a
different area)"**

## Fix

- Read the full context around the issue. When a function signature or
  response shape changes, update every caller.
- A fix that crosses into frontend consumers changes both layers together;
  read the owning frontend guidance first.

## Do not

- Report style-only issues (naming, formatting); `gofmt` owns formatting.
- Propose comments or documentation as an improvement.
- Flag intentional patterns documented in AGENTS.md or owning docs, or
  consolidations recorded in the
  [settled findings](../app-review/references/settled-findings.md).
- Present a large-scale refactor as one finding; break it down.
- Change dependencies without strong justification (CVE, bug).
