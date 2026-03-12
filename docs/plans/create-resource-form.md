Create Resource Form Assessment

The form architecture is solid — declarative definitions, YAML as source of truth, server-side dry-run validation, multi-cluster awareness. But it covers roughly 30–40% of the Kubernetes Deployment API surface that
production teams commonly use.

What's well covered

Metadata, replicas, selectors/labels/annotations, containers (name, image, pullPolicy, command/args, literal env vars, ports, resources, readiness/liveness probes, volumeMounts), 5 volume types (configMap, secret, PVC,
hostPath, emptyDir), strategy (rollingUpdate/recreate with conditional fields), serviceAccountName, terminationGracePeriod, nodeSelector, priorityClassName, dnsPolicy, restartPolicy.

Critical gaps for production use

High impact — commonly needed:

- No envFrom (sourcing env from ConfigMaps/Secrets) — nearly every production deployment uses this ✅ Phase 3A
- No startupProbe ✅ Phase 2
- No pod or container securityContext (runAsUser, runAsNonRoot, readOnlyRootFilesystem, capabilities, etc.) ✅ Phase 3C
- No affinity / tolerations ✅ Phase 3D
- No topologySpreadConstraints — not yet implemented
- No initContainers ✅ Phase 3A
- No imagePullSecrets ✅ Phase 2
- No pod template annotations (used by Prometheus, Vault, Datadog, etc.) ✅ Phase 2
- Only 5 of ~25 volume source types (missing NFS, projected, CSI, downwardAPI) — not yet expanded
- Missing minReadySeconds, progressDeadlineSeconds, revisionHistoryLimit ✅ Phase 2

Bugs found

┌─────┬──────────────────────────────────────────────────────────────────────────────────────────┬──────────┬────────┐
│ #   │ Issue                                                                                    │ Severity │ Status │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────┤
│ 1   │ name field not marked required: true — no client-side error shown                        │ Medium   │ ✅     │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────┤
│ 2   │ env only supports literal values, no valueFrom (secretKeyRef, configMapKeyRef, fieldRef) │ High     │ ✅     │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────┤
│ 3   │ restartPolicy dropdown allows OnFailure/Never which are invalid for Deployments          │ Medium   │ ✅     │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────┤
│ 4   │ serviceAccountName mirrors to deprecated serviceAccount field (removed in k8s 1.24)      │ Medium   │ Kept   │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────┤
│ 5   │ Port protocol dropdown missing SCTP                                                      │ Low      │ ✅     │
└─────┴──────────────────────────────────────────────────────────────────────────────────────────┴──────────┴────────┘

Bug 4 note: the serviceAccount mirror is kept intentionally for backward compatibility with older clusters.

Test coverage gaps

- FormProbeField — zero unit tests ✅ Tests added (Phase 1)
- FormVolumeSourceField — zero unit tests ✅ Tests added (Phase 1)
- NestedGroupListField — zero unit tests ✅ Tests added
- getRequiredFieldErrors doesn't recurse into group-list sub-fields ✅ Fixed and tested

Remaining work

- topologySpreadConstraints — not yet implemented
- Additional volume source types (NFS, projected, CSI, downwardAPI, etc.) — still at the original 5

Bottom line

The form now covers the large majority of production Kubernetes use cases. Env sourcing (envFrom + valueFrom), security contexts, affinity/tolerations, init containers, probes, and pod-level settings are all supported.
The two remaining gaps (topologySpreadConstraints and additional volume types) are lower priority — most teams can use the YAML editor for these less common configurations.

311 tests passing across 19 test files. TypeScript clean, lint clean.
