---
name: improve-frontend
description: Use when wanting to systematically improve the React/TypeScript frontend - scans for security vulnerabilities, stability risks, performance issues, and code simplification opportunities, then presents 5 ranked findings for the user to choose from
---

# Improve Frontend

Scan the React/TypeScript frontend, present exactly 5 concrete findings ranked
security > stability > performance > simplicity, wait for the user to pick one
(or ask for a rescan of another area), then fix only that one.

`/improve-frontend [area]` takes an optional focus area (for example `refresh`,
`object-panel`, `browse`, `tables`, `streaming`); without one, scan broadly.

## Scan

With `[area]`, limit discovery to that module or directory. Otherwise sample
8-12 files across `core/`, `modules/`, `shared/`, and `ui/`, weighted toward
recent git activity (fresh churn often harbors fresh bugs) or high line counts.
Open backend contracts only when a candidate crosses into a backend producer.
Check the tiers in order:

| Tier | Category | Look for |
| --- | --- | --- |
| Security | XSS vectors | `dangerouslySetInnerHTML`, unescaped DOM-attribute interpolation, untrusted HTML from K8s annotations, labels, or events |
| Security | Sensitive data | Kubeconfig contents, tokens, or secrets in console logs, unencrypted `localStorage`, or React DevTools-visible state |
| Security | Bypassed network boundary | `fetch`/`XMLHttpRequest` outside `core/refresh/**` and `core/data-access/**` (Biome `no-direct-fetch` catches only `fetch`) |
| Security | Injection via K8s data | User-controlled names, labels, or annotations used unsanitized in URLs, DOM IDs, or code-building template literals |
| Security | Prototype pollution | Deep merges, spreads of unvalidated external objects, `Object.assign` from API responses without key allowlists |
| Security | Dependency risk | `package.json` versions with known CVEs |
| Stability | Memory leaks | Subscriptions, listeners, timers, or stream handlers not cleaned up in the `useEffect` return; streams left open on unmount |
| Stability | Error boundaries | Trees (especially detail panels and streaming components) where one bad K8s response crashes the app |
| Stability | Race conditions | Stale closures in `useEffect`/`useCallback`; async work that updates state after unmount |
| Stability | Null safety | Missing optional chaining on nullable K8s fields; array methods on possibly undefined values |
| Stability | Multi-cluster | Components or hooks that assume one cluster, ignore `clusterId`, or keep state across a cluster switch |
| Stability | State consistency | Stale cache after cluster/namespace switch, contexts not cleared on disconnect, derived state that can desync |
| Performance | Re-renders | Missing `memo`, inline object/array/function props, unstable context values |
| Performance | Bundle size | Heavy imports that could be lazy-loaded; barrel re-exports pulling whole modules |
| Performance | Computation | Missing `useMemo`/`useCallback` for nontrivial work, or wrong dependency arrays |
| Performance | Redundant fetching | Components requesting the same data independently instead of sharing via the refresh orchestrator |
| Performance | Tables | GridTable lists without row virtualization; column factories recreated each render |
| Performance | CSS waste | Unused classes, broad selectors causing layout thrash, missing `will-change` on animated elements |
| Simplicity | Dead code | Exported components/hooks/utils with no imports, unreachable branches, commented-out JSX |
| Simplicity | Duplication | Copy-pasted component logic, repeated fetch-and-transform code, similar components that could share a base |
| Simplicity | Over-abstraction | Pass-through wrapper components, hooks wrapping a single `useState`, unnecessary HOCs |
| Simplicity | Consolidation | Near-identical utilities or type definitions that could be unified |
| Simplicity | Stale patterns | Class components, legacy context API, patterns the codebase has moved away from |

For each finding, note cross-boundary effects: the backend sends data the
frontend processes unsafely, the fix needs a backend response-shape change, or
a frontend performance issue is really backend over-fetching.

## Present

List findings in priority order, then by impact within a tier:

```
N. **[SECURITY|STABILITY|PERFORMANCE|SIMPLICITY] Category — file:line**
   One-line description of the issue.
   Impact: What could go wrong / what improves.
   [Cross-boundary: backend effect, if any]
```

Then ask: **"Which one should we fix? (pick a number, or say 'rescan' for a
different area)"**

## Fix

- Read the full context around the issue. When a component's props or a hook's
  return type changes, update every consumer.
- A fix that crosses into backend producers changes both layers together; read
  the owning backend guidance first.

## Do not

- Report style-only issues (formatting, import order); Biome owns style.
- Propose comments, JSDoc, or type annotations as an improvement.
- Flag intentional patterns documented in AGENTS.md or owning docs, or
  consolidations recorded in the
  [settled findings](../app-review/references/settled-findings.md).
- Present a large-scale refactor as one finding; break it down.
- Change dependencies without strong justification (CVE, bug).
