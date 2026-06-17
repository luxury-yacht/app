package backend

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	sigsyaml "sigs.k8s.io/yaml"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/refresh/kindspec"
)

var (
	revisionHistoryWorkloadKinds = workloadKindStringMap(func(w *kindspec.WorkloadOperations) bool { return w.RevisionHistory != nil })
	scalableWorkloadKinds        = workloadKindStringMap(func(w *kindspec.WorkloadOperations) bool { return w.Scale != nil })
)

// workloadKindStringMap returns a lowercased-kind→canonical-kind map of the workload
// kinds whose operations satisfy pred, derived from the registry so normalize/scale
// validation names no kind by hand.
func workloadKindStringMap(pred func(*kindspec.WorkloadOperations) bool) map[string]string {
	m := map[string]string{}
	for kind, ops := range workloadOperationsByKind {
		if pred(ops) {
			m[strings.ToLower(kind)] = kind
		}
	}
	return m
}

func normalizeAppsV1WorkloadKind(group, version, kind string, supported map[string]string) (string, error) {
	gvk := schema.GroupVersionKind{
		Group:   strings.TrimSpace(group),
		Version: strings.TrimSpace(version),
		Kind:    strings.TrimSpace(kind),
	}
	if gvk.Group != "apps" || gvk.Version != "v1" || gvk.Kind == "" {
		return "", fmt.Errorf("unsupported workload GVK %s", gvk.String())
	}
	canonical, ok := supported[strings.ToLower(gvk.Kind)]
	if !ok {
		return "", fmt.Errorf("unsupported workload GVK %s", gvk.String())
	}
	return canonical, nil
}

// RevisionEntry describes a single historical revision of a workload rollout.
type RevisionEntry struct {
	// Revision is the monotonically increasing revision number.
	Revision int64 `json:"revision"`
	// CreatedAt is the ISO-8601 creation timestamp of the underlying ReplicaSet or ControllerRevision.
	CreatedAt string `json:"createdAt"`
	// ChangeCause is the value of the kubernetes.io/change-cause annotation, if present.
	ChangeCause string `json:"changeCause"`
	// Current indicates that this revision matches the workload's active revision.
	Current bool `json:"current"`
	// PodTemplate is the YAML-serialised pod template spec for this revision.
	PodTemplate string `json:"podTemplate"`
}

// GetRevisionHistory returns the rollout revision history for a named workload.
// Supports Deployment, StatefulSet, and DaemonSet. Other kinds return an error.
// Results are sorted descending by revision number (newest first).
//
// Multi-cluster safety: all Kubernetes requests are scoped to the cluster
// identified by clusterID, preventing cross-cluster data leakage.
func (a *App) GetRevisionHistory(clusterID, namespace, group, version, workloadKind, name string) ([]RevisionEntry, error) {
	workloadKind, err := normalizeAppsV1WorkloadKind(group, version, workloadKind, revisionHistoryWorkloadKinds)
	if err != nil {
		return nil, fmt.Errorf("revision history not supported: %w", err)
	}

	ops := workloadOperationsByKind[workloadKind]
	if ops == nil || ops.RevisionHistory == nil {
		return nil, fmt.Errorf("revision history not supported for workload kind %q", workloadKind)
	}

	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	if deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client is not initialized")
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	revisions, err := ops.RevisionHistory(ctx, deps.KubernetesClient, namespace, name)
	if err != nil {
		return nil, err
	}
	entries := make([]RevisionEntry, 0, len(revisions))
	for _, r := range revisions {
		entries = append(entries, RevisionEntry{
			Revision:    r.Revision,
			CreatedAt:   r.CreatedAt,
			ChangeCause: r.ChangeCause,
			Current:     r.Current,
			PodTemplate: r.PodTemplate,
		})
	}
	return entries, nil
}

// rollbackWorkload rolls a workload back to a specific historical revision by replacing
// its pod template spec with the one stored in that revision.
//
// The target revision is located by calling GetRevisionHistory. If no entry matches
// toRevision, an error is returned. Supports Deployment, StatefulSet, and DaemonSet.
//
// Multi-cluster safety: all Kubernetes requests are scoped to the cluster identified
// by clusterID, preventing cross-cluster data leakage or modification.
func (a *App) rollbackWorkload(clusterID, namespace, group, version, workloadKind, name string, toRevision int64) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionRollback,
		Target: objectActionTarget(
			clusterID,
			group,
			version,
			workloadKind,
			namespace,
			name,
		),
		Revision: &toRevision,
	})
	return err
}

func (a *App) rollbackWorkloadAction(target ObjectActionTargetRef, toRevision int64) error {
	return a.rollbackWorkloadInternal(target.ClusterID, target.Namespace, target.Group, target.Version, target.Kind, target.Name, toRevision)
}

func (a *App) rollbackWorkloadInternal(clusterID, namespace, group, version, workloadKind, name string, toRevision int64) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	workloadKind, err := normalizeAppsV1WorkloadKind(group, version, workloadKind, revisionHistoryWorkloadKinds)
	if err != nil {
		return fmt.Errorf("rollback not supported: %w", err)
	}

	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	// Fetch the full revision history to locate the target revision's pod template.
	entries, err := a.GetRevisionHistory(clusterID, namespace, group, version, workloadKind, name)
	if err != nil {
		return fmt.Errorf("failed to get revision history for %s %s/%s: %w", workloadKind, namespace, name, err)
	}

	// Find the entry matching the requested revision number.
	var targetEntry *RevisionEntry
	for i := range entries {
		if entries[i].Revision == toRevision {
			targetEntry = &entries[i]
			break
		}
	}
	if targetEntry == nil {
		return fmt.Errorf("revision %d not found for %s %s/%s", toRevision, workloadKind, namespace, name)
	}
	if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Group:     group,
		Version:   version,
		Kind:      workloadKind,
		Namespace: namespace,
		Name:      name,
		Verb:      "update",
	}); err != nil {
		return err
	}

	// Unmarshal the stored YAML pod template back into a typed PodTemplateSpec.
	var podTemplate corev1.PodTemplateSpec
	if err := sigsyaml.Unmarshal([]byte(targetEntry.PodTemplate), &podTemplate); err != nil {
		return fmt.Errorf("failed to unmarshal pod template for revision %d: %w", toRevision, err)
	}

	// Replace the workload's pod template with the target revision's template via the
	// kind's own apply op from the registry.
	ops := workloadOperationsByKind[workloadKind]
	if ops == nil || ops.ApplyPodTemplate == nil {
		return fmt.Errorf("rollback not supported for workload kind %q", workloadKind)
	}
	if err := ops.ApplyPodTemplate(ctx, deps.KubernetesClient, namespace, name, podTemplate); err != nil {
		return err
	}

	applog.Info(
		deps.Logger,
		fmt.Sprintf("Rolled back %s %s/%s to revision %d", workloadKind, namespace, name, toRevision),
		"rollbackWorkload",
	)
	a.invalidateResponseCache(selectionKey, workloadKind, namespace, name)
	return nil
}
