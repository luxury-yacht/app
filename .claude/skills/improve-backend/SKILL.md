---
name: improve-backend
description: Use when wanting to systematically improve the Go backend - scans for security vulnerabilities, stability risks, performance issues, and code simplification opportunities, then presents 5 ranked findings for the user to choose from
---

# Improve Backend

Systematically scan the Go backend for improvement opportunities. Identify 5 concrete
issues ranked by priority (security > stability > performance > simplicity), present
them to the user, and fix the one they choose.

## Arguments

`/improve-backend [area]` — optional focus area (e.g., `refresh`, `resources`,
`portforward`, `objectcatalog`). Without an argument, scan broadly.

## How It Works

1. **Scan** the backend code for issues across all priority tiers.
2. **Rank** findings: security first, then stability, performance, simplicity.
3. **Present** exactly 5 findings as a numbered list with severity, location, and
   one-line description.
4. **Wait** for the user to pick one (or request a rescan of a different area).
5. **Fix** the chosen issue, following all project rules from AGENTS.md.

## Scan Procedure

### Phase 1: Gather Context

- Read `backend/AGENTS.md` and `frontend/AGENTS.md` for current conventions.
- If an `[area]` argument was given, scope file discovery to that package tree.
  Otherwise, sample broadly: pick 8-12 files across different packages, weighting
  toward files with recent git activity or high line counts.
- Check git log for recently changed files — fresh churn often harbors fresh bugs.

### Phase 2: Security Scan (Priority 1)

Look for these patterns in Go code:

| Category | What to look for |
|----------|-----------------|
| **Input validation** | Unvalidated user/API input passed to shell commands, file paths, or K8s API calls. Watch for `os/exec`, `filepath.Join` with user strings, unsanitized label selectors. |
| **Secret exposure** | Secrets, tokens, or kubeconfig credentials logged, returned in error messages, or stored in plain text outside the intended persistence layer. |
| **RBAC gaps** | Operations that skip permission checks or don't gate on capabilities. Every K8s write must check permissions first. |
| **Concurrency** | Shared mutable state without synchronization — maps accessed from multiple goroutines, missing mutex guards, race-prone patterns. |
| **Error handling** | Errors silently swallowed (` _ = someFunc()`), or sensitive details leaked in error responses sent to the frontend. |
| **Dependency risk** | Outdated dependencies with known CVEs (check `go.mod` dates and versions). |

### Phase 3: Stability Scan (Priority 2)

| Category | What to look for |
|----------|-----------------|
| **Resource leaks** | Unclosed HTTP bodies, K8s watchers/informers not stopped on context cancellation, goroutines that can leak. |
| **Nil safety** | Pointer dereferences without nil checks, especially on K8s API responses where fields are optional pointers. |
| **Error propagation** | Errors returned without wrapping context (`return err` vs `return fmt.Errorf("doing X: %w", err)`). |
| **Context discipline** | Missing context propagation — long-running operations that ignore cancellation, blocking calls without timeouts. |
| **Graceful shutdown** | Resources or goroutines that survive app shutdown, watchers that don't respect stop channels. |
| **Multi-cluster correctness** | Any code path that assumes a single cluster or ignores `clusterId`. This is a project-wide rule. |

### Phase 4: Performance Scan (Priority 3)

| Category | What to look for |
|----------|-----------------|
| **Redundant K8s calls** | Multiple API calls that could be consolidated, or data fetched that's already in the object catalog. |
| **Missing caching** | Repeated expensive computations or API calls where the result doesn't change within a refresh cycle. |
| **Allocation waste** | Slices/maps created in hot paths without pre-sizing, string concatenation in loops, unnecessary copies of large structs. |
| **Blocking the event loop** | Synchronous operations on the Wails binding thread that should be async. |
| **N+1 patterns** | Loops making individual API calls where a list call would work. |

### Phase 5: Simplicity Scan (Priority 4)

| Category | What to look for |
|----------|-----------------|
| **Dead code** | Exported functions/types with zero callers, unreachable branches, commented-out blocks. |
| **Duplication** | Copy-pasted logic across resource handlers or packages that could be a shared helper. |
| **Over-abstraction** | Interfaces with a single implementation, wrapper types that add no value, unnecessary indirection. |
| **Consolidation** | Multiple small functions doing nearly the same thing that could be unified. |
| **Stale patterns** | Old patterns that the rest of the codebase has moved away from. |

### Phase 6: Cross-Boundary Check

For each finding, consider whether it has a frontend counterpart:

- Does the frontend assume a response shape that a backend fix would change?
- Does a backend security fix require the frontend to stop sending certain data?
- Would a backend performance fix let the frontend simplify its caching?

Note cross-boundary impacts in the finding description.

## Presenting Findings

Present findings as a numbered markdown list. Each item includes:

```
N. **[SEVERITY] Category — file:line**
   One-line description of the issue.
   Impact: What could go wrong / what improves.
   [Cross-boundary: note if frontend is affected]
```

Severity tags: `SECURITY`, `STABILITY`, `PERFORMANCE`, `SIMPLICITY`

Order by priority (security first), then by impact within the same tier.

Example:

```
1. **[SECURITY] Concurrency — backend/response_cache.go:47**
   Response cache map read/written from multiple goroutines without mutex.
   Impact: Data race under concurrent requests; potential crash.

2. **[STABILITY] Nil safety — backend/resources/workloads/deployments.go:83**
   Deployment.Spec.Replicas dereferenced without nil check (it's a *int32).
   Impact: Panic when API returns a deployment with nil replicas field.
   Cross-boundary: Frontend would see a WebSocket disconnect on panic.
```

After the list, ask: **"Which one should we fix? (pick a number, or say 'rescan' for a different area)"**

## Fixing the Chosen Issue

1. Read the full file context around the issue.
2. Make the minimal correct fix — don't refactor surrounding code.
3. If the fix changes a function signature or response shape, check all callers.
4. If cross-boundary, note what the frontend needs to change (but don't change it
   here — use `/improve-frontend` for that).
5. Write or update tests to cover the fix. Aim for the fix to be test-driven:
   write the failing test first when practical.
6. Run `mage qc:prerelease` to verify nothing breaks.

## What NOT to Do

- Don't report style-only issues (naming, formatting) — `goimports` handles style.
- Don't suggest adding comments or documentation as an "improvement."
- Don't flag things that are intentional patterns documented in AGENTS.md.
- Don't propose large-scale refactors as a single finding — break them down.
- Don't change dependencies without strong justification (CVE, bug).
