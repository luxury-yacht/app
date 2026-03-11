⏺ Deployment Form Assessment

The form architecture is solid — declarative definitions, YAML as source of truth, server-side dry-run validation, multi-cluster awareness. But it covers roughly 30–40% of the Kubernetes Deployment API surface that
production teams commonly use.

What's well covered

Metadata, replicas, selectors/labels/annotations, containers (name, image, pullPolicy, command/args, literal env vars, ports, resources, readiness/liveness probes, volumeMounts), 5 volume types (configMap, secret, PVC,
hostPath, emptyDir), strategy (rollingUpdate/recreate with conditional fields), serviceAccountName, terminationGracePeriod, nodeSelector, priorityClassName, dnsPolicy, restartPolicy.

Critical gaps for production use

High impact — commonly needed:

- No envFrom (sourcing env from ConfigMaps/Secrets) — nearly every production deployment uses this
- No startupProbe
- No pod or container securityContext (runAsUser, runAsNonRoot, readOnlyRootFilesystem, capabilities, etc.)
- No affinity / tolerations / topologySpreadConstraints
- No initContainers
- No imagePullSecrets
- No pod template annotations (used by Prometheus, Vault, Datadog, etc.)
- Only 5 of ~25 volume source types (missing NFS, projected, CSI, downwardAPI)
- Missing minReadySeconds, progressDeadlineSeconds, revisionHistoryLimit

Bugs found

┌─────┬──────────────────────────────────────────────────────────────────────────────────────────┬──────────┐
│ # │ Issue │ Severity │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┤
│ 1 │ name field not marked required: true — no client-side error shown │ Medium │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┤
│ 2 │ env only supports literal values, no valueFrom (secretKeyRef, configMapKeyRef, fieldRef) │ High │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┤
│ 3 │ restartPolicy dropdown allows OnFailure/Never which are invalid for Deployments │ Medium │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┤
│ 4 │ serviceAccountName mirrors to deprecated serviceAccount field (removed in k8s 1.24) │ Medium │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────┤
│ 5 │ Port protocol dropdown missing SCTP │ Low │
└─────┴──────────────────────────────────────────────────────────────────────────────────────────┴──────────┘

Test coverage gaps

- FormProbeField — zero unit tests
- FormVolumeSourceField — zero unit tests
- NestedGroupListField — zero unit tests
- getRequiredFieldErrors doesn't recurse into group-list sub-fields (container name/image never validated client-side)

Bottom line

The form is a good v1 for basic deployments — users can create simple workloads and fall back to the YAML editor for advanced config. But it's not production-complete for teams that need security contexts, affinity
rules, init containers, or env sourcing from secrets/configmaps. The bugs listed above should be fixed regardless of scope.
