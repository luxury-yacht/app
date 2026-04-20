---
name: improve-frontend
description: Use when wanting to systematically improve the React/TypeScript frontend - scans for security vulnerabilities, stability risks, performance issues, and code simplification opportunities, then presents 5 ranked findings for the user to choose from
---

# Improve Frontend

Systematically scan the React/TypeScript frontend for improvement opportunities.
Identify 5 concrete issues ranked by priority (security > stability > performance >
simplicity), present them to the user, and fix the one they choose.

## Arguments

`/improve-frontend [area]` — optional focus area (e.g., `refresh`, `object-panel`,
`browse`, `tables`, `streaming`). Without an argument, scan broadly.

## How It Works

1. **Scan** the frontend code for issues across all priority tiers.
2. **Rank** findings: security first, then stability, performance, simplicity.
3. **Present** exactly 5 findings as a numbered list with severity, location, and
   one-line description.
4. **Wait** for the user to pick one (or request a rescan of a different area).
5. **Fix** the chosen issue, following all project rules from AGENTS.md.

## Scan Procedure

### Phase 1: Gather Context

- Read `frontend/AGENTS.md` and `backend/AGENTS.md` for current conventions.
- If an `[area]` argument was given, scope file discovery to that module/directory.
  Otherwise, sample broadly: pick 8-12 files across `core/`, `modules/`, `shared/`,
  and `ui/`, weighting toward files with recent git activity or high line counts.
- Check git log for recently changed files — fresh churn often harbors fresh bugs.

### Phase 2: Security Scan (Priority 1)

Look for these patterns in React/TypeScript code:

| Category | What to look for |
|----------|-----------------|
| **XSS vectors** | Use of `dangerouslySetInnerHTML` (the React escape hatch for raw HTML), unescaped interpolation into DOM attributes, rendering untrusted HTML from K8s annotations/labels/events. |
| **Sensitive data exposure** | Kubeconfig contents, tokens, or secrets logged to console, stored in localStorage without encryption, or visible in React DevTools state. |
| **Insecure communication** | Direct `fetch`/`XMLHttpRequest` calls bypassing the refresh client (`core/refresh/client.ts` is the only approved fetch path). |
| **Injection via K8s data** | K8s object names, labels, and annotations are user-controlled strings. Check they're not used unsanitized in URLs, DOM IDs, or template literals that construct code. |
| **Prototype pollution** | Deep-merge utilities, spread of unvalidated external objects, `Object.assign` from API responses without allowlisting keys. |
| **Dependency risk** | Outdated frontend dependencies with known CVEs (check `package.json` versions). |

### Phase 3: Stability Scan (Priority 2)

| Category | What to look for |
|----------|-----------------|
| **Memory leaks** | Subscriptions, event listeners, timers, or WebSocket handlers not cleaned up in `useEffect` return. Streams not closed on unmount. |
| **Missing error boundaries** | Component trees that can crash the whole app on a bad K8s response. Detail panels and streaming components are high-risk. |
| **Race conditions** | Stale closure bugs in `useEffect`/`useCallback`, async operations that don't check if the component is still mounted, state updates after unmount. |
| **Null/undefined safety** | Optional chaining missing on K8s API response fields (many are nullable), array methods called on potentially undefined values. |
| **Multi-cluster correctness** | Any component or hook that assumes a single cluster context, ignores `clusterId`, or doesn't reset state on cluster switch. This is a project-wide rule. |
| **State consistency** | Stale cache after cluster/namespace switch, contexts that don't clear on disconnect, derived state that can desync from source. |

### Phase 4: Performance Scan (Priority 3)

| Category | What to look for |
|----------|-----------------|
| **Unnecessary re-renders** | Components re-rendering on every parent render due to missing `memo`, inline object/array/function props, or unstable context values. |
| **Large bundle impact** | Heavy imports that could be lazy-loaded, barrel file re-exports pulling in entire modules. |
| **Expensive computations** | `useMemo`/`useCallback` missing where computation is non-trivial, or present with incorrect dependency arrays. |
| **Redundant data fetching** | Multiple components requesting the same data independently instead of sharing via the refresh orchestrator. |
| **Table performance** | GridTable rendering issues — missing row virtualization for large resource lists, column factory functions recreated each render. |
| **CSS waste** | Unused CSS classes, overly broad selectors causing layout thrash, missing `will-change` for animated elements. |

### Phase 5: Simplicity Scan (Priority 4)

| Category | What to look for |
|----------|-----------------|
| **Dead code** | Exported components/hooks/utils with zero imports, unreachable branches, commented-out JSX. |
| **Duplication** | Copy-pasted component logic, repeated fetch-and-transform patterns, similar components that could share a base. |
| **Over-abstraction** | Wrapper components that just pass props through, hooks that wrap a single `useState`, unnecessary HOCs. |
| **Consolidation** | Multiple small utility functions doing nearly the same thing, similar type definitions that could be unified. |
| **Stale patterns** | Class components, legacy context API usage, patterns the rest of the codebase has moved away from. |

### Phase 6: Cross-Boundary Check

For each finding, consider whether it has a backend counterpart:

- Does the backend send data that the frontend processes unsafely?
- Would a frontend fix require the backend to change its response shape?
- Is a frontend performance issue actually caused by backend over-fetching?

Note cross-boundary impacts in the finding description.

## Presenting Findings

Present findings as a numbered markdown list. Each item includes:

```
N. **[SEVERITY] Category — file:line**
   One-line description of the issue.
   Impact: What could go wrong / what improves.
   [Cross-boundary: note if backend is affected]
```

Severity tags: `SECURITY`, `STABILITY`, `PERFORMANCE`, `SIMPLICITY`

Order by priority (security first), then by impact within the same tier.

Example:

```
1. **[SECURITY] XSS vector — frontend/src/modules/object-panel/components/EventsTab.tsx:62**
   K8s event message rendered as raw unescaped HTML.
   Impact: Malicious event messages could execute arbitrary JS in the app.

2. **[STABILITY] Memory leak — frontend/src/core/refresh/streaming/resourceStreamManager.ts:104**
   WebSocket onmessage handler not removed on reconnect, accumulating listeners.
   Impact: Memory growth over long sessions; eventual tab crash.
   Cross-boundary: Backend WebSocket endpoint sends binary frames that amplify the leak.
```

After the list, ask: **"Which one should we fix? (pick a number, or say 'rescan' for a different area)"**

## Fixing the Chosen Issue

1. Read the full file context around the issue.
2. Make the minimal correct fix — don't refactor surrounding code.
3. If the fix changes a component's props or a hook's return type, check all consumers.
4. If cross-boundary, note what the backend needs to change (but don't change it
   here — use `/improve-backend` for that).
5. Write or update tests to cover the fix. Use Vitest with specs next to the
   implementation (`*.test.ts[x]`).
6. Run `mage qc:prerelease` to verify nothing breaks.

## What NOT to Do

- Don't report style-only issues (formatting, import order) — Prettier handles style.
- Don't suggest adding comments, JSDoc, or type annotations as an "improvement."
- Don't flag things that are intentional patterns documented in AGENTS.md.
- Don't propose large-scale refactors as a single finding — break them down.
- Don't change dependencies without strong justification (CVE, bug).
- Don't suggest adding inline styles — the project forbids them (use CSS classes).
