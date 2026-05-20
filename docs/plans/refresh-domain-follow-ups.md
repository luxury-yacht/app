# Refresh Domain Follow-Ups

These are non-blocking follow-ups from the completed refresh-domain contract
coverage plan. They should be handled as separate scoped changes with
compatibility tests before any behavior changes.

## Object YAML Contract

Question: should `object-yaml` remain under `detail-payload`, or should it get a
separate mutation/read contract because apply flows are adjacent?

Current safe state:

- `object-yaml` remains a read payload with full object scope input.
- Apply/edit behavior must stay covered by object action and permission tests.

Required guardrail before changing:

- Add a contract test proving `object-yaml` scope, cache invalidation, and
  permission behavior remain compatible with object details.
- If split into a new behavior class, update `domainInventory`, backend and
  frontend coverage registries, and architecture docs in one change.

## Helm Release Identity

Question: should Helm release content scopes migrate from `namespace:name` to a
synthetic full `helm.sh/v3:HelmRelease` object ref, or should Helm release
identity remain a separate contract?

Current safe state:

- Helm content domains use cluster-prefixed `namespace:name` release scopes.
- Rendered manifest links still carry full resource-link identity for Kubernetes
  objects found in the manifest.

Required guardrail before changing:

- Add a compatibility test proving old release scopes either continue to work or
  fail with an explicit migration error.
- Prove object panel navigation, Helm manifest/values fetches, cache keys, and
  related resource links agree on the same identity model.

## Runtime Smoke Automation

Question: which checks from
[refresh-smoke.md](../workflows/refresh-smoke.md) should become CI automation?

Current safe state:

- Runtime smoke remains manual until the checklist is repeatable in development
  builds.

Automation candidates:

- Two-cluster stream reconnect integration test using fake stream servers.
- Restricted-RBAC fixture asserting allowed and denied diagnostics.
- Runtime rebuild test proving transient stream errors are suppressed.
- CRD signature-change test for custom resource stream recovery.

Required guardrail before changing:

- Keep the manual checklist as the release fallback until automated coverage can
  reproduce the multi-cluster and rebuild scenarios deterministically.
