package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	sigsyaml "sigs.k8s.io/yaml"

	"github.com/luxury-yacht/app/backend/resources/common"
)

const (
	// revisionAnnotation is the annotation Kubernetes sets on ReplicaSets and Deployments
	// to track the current rollout revision number.
	revisionAnnotation = "deployment.kubernetes.io/revision"

	// changeCauseAnnotation is set by kubectl (or manually) to record a human-readable
	// description of what caused a rollout revision.
	changeCauseAnnotation = "kubernetes.io/change-cause"
)

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
func (a *App) GetRevisionHistory(clusterID, namespace, name, workloadKind string) ([]RevisionEntry, error) {
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

	switch workloadKind {
	case "Deployment":
		// Fetch the Deployment to determine its current revision.
		deploy, err := deps.KubernetesClient.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get deployment %s/%s: %w", namespace, name, err)
		}

		// The annotation on the Deployment itself identifies the current (live) revision.
		currentRevision, _ := strconv.ParseInt(deploy.Annotations[revisionAnnotation], 10, 64)

		// List all ReplicaSets in the namespace so we can filter by owner reference.
		rsList, err := deps.KubernetesClient.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to list replicasets in %s: %w", namespace, err)
		}

		var entries []RevisionEntry
		for i := range rsList.Items {
			rs := &rsList.Items[i]

			// Only consider ReplicaSets owned by this Deployment.
			if !isOwnedBy(rs.OwnerReferences, deploy.UID) {
				continue
			}

			// The revision number lives in the annotation; skip if missing or unparseable.
			revStr, ok := rs.Annotations[revisionAnnotation]
			if !ok {
				continue
			}
			rev, err := strconv.ParseInt(revStr, 10, 64)
			if err != nil {
				continue
			}

			// Serialise the pod template so the frontend can display a diff.
			podTemplateYAML, err := marshalPodTemplate(&rs.Spec.Template)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal pod template for replicaset %s: %w", rs.Name, err)
			}

			entries = append(entries, RevisionEntry{
				Revision:    rev,
				CreatedAt:   rs.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z"),
				ChangeCause: rs.Annotations[changeCauseAnnotation],
				Current:     rev == currentRevision,
				PodTemplate: podTemplateYAML,
			})
		}

		// Sort descending so the most recent revision is first.
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].Revision > entries[j].Revision
		})

		return entries, nil

	case "StatefulSet":
		return a.getStatefulSetRevisions(ctx, deps, namespace, name)

	case "DaemonSet":
		return a.getDaemonSetRevisions(ctx, deps, namespace, name)

	default:
		return nil, fmt.Errorf("revision history not supported for workload kind %q", workloadKind)
	}
}

// getStatefulSetRevisions retrieves revision history for a StatefulSet via ControllerRevisions.
// The StatefulSet's status.CurrentRevision name is used to mark the active revision.
func (a *App) getStatefulSetRevisions(ctx context.Context, deps common.Dependencies, namespace, name string) ([]RevisionEntry, error) {
	sts, err := deps.KubernetesClient.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get statefulset %s/%s: %w", namespace, name, err)
	}

	// status.CurrentRevision holds the name of the ControllerRevision that is currently active.
	currentRevisionName := sts.Status.CurrentRevision

	return getControllerRevisionEntries(ctx, deps, namespace, sts.UID, currentRevisionName, "StatefulSet")
}

// getDaemonSetRevisions retrieves revision history for a DaemonSet via ControllerRevisions.
// DaemonSets do not expose a currentRevision name in their status, so the highest revision
// number is treated as current.
func (a *App) getDaemonSetRevisions(ctx context.Context, deps common.Dependencies, namespace, name string) ([]RevisionEntry, error) {
	ds, err := deps.KubernetesClient.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get daemonset %s/%s: %w", namespace, name, err)
	}

	// Pass empty currentRevisionName; getControllerRevisionEntries will mark the highest revision
	// as current when no name is provided.
	return getControllerRevisionEntries(ctx, deps, namespace, ds.UID, "", "DaemonSet")
}

// getControllerRevisionEntries is a shared helper for StatefulSet and DaemonSet revision history.
// It lists all ControllerRevisions in the namespace, filters to those owned by the workload
// identified by ownerUID, extracts the pod template from each, and returns them sorted descending.
//
// If currentRevisionName is non-empty, the revision whose name matches is marked as Current.
// If currentRevisionName is empty (DaemonSet case), the entry with the highest revision number
// is marked as Current.
func getControllerRevisionEntries(
	ctx context.Context,
	deps common.Dependencies,
	namespace string,
	ownerUID types.UID,
	currentRevisionName string,
	workloadKind string,
) ([]RevisionEntry, error) {
	crList, err := deps.KubernetesClient.AppsV1().ControllerRevisions(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list controllerrevisions in %s: %w", namespace, err)
	}

	var entries []RevisionEntry
	for i := range crList.Items {
		cr := &crList.Items[i]

		// Only include revisions owned by the target workload.
		if !isOwnedBy(cr.OwnerReferences, ownerUID) {
			continue
		}

		// Extract the pod template embedded in the ControllerRevision's raw data.
		podTemplateYAML, err := extractPodTemplateFromControllerRevision(cr, workloadKind)
		if err != nil {
			return nil, fmt.Errorf("failed to extract pod template from controllerrevision %s: %w", cr.Name, err)
		}

		entries = append(entries, RevisionEntry{
			Revision:    cr.Revision,
			CreatedAt:   cr.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z"),
			ChangeCause: cr.Annotations[changeCauseAnnotation],
			// Current is resolved after sorting when currentRevisionName is empty.
			Current:     currentRevisionName != "" && cr.Name == currentRevisionName,
			PodTemplate: podTemplateYAML,
		})
	}

	// Sort descending so the most recent revision is first.
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Revision > entries[j].Revision
	})

	// For DaemonSets (currentRevisionName is empty), mark the highest revision as current.
	// After sorting descending, that is the first element.
	if currentRevisionName == "" && len(entries) > 0 {
		entries[0].Current = true
	}

	return entries, nil
}

// extractPodTemplateFromControllerRevision unmarshals the raw JSON stored in a ControllerRevision's
// Data field into the appropriate workload type (StatefulSet or DaemonSet), then extracts and
// serialises the pod template spec to YAML.
func extractPodTemplateFromControllerRevision(cr *appsv1.ControllerRevision, workloadKind string) (string, error) {
	if cr.Data.Raw == nil {
		return "", nil
	}

	switch workloadKind {
	case "StatefulSet":
		var sts appsv1.StatefulSet
		if err := json.Unmarshal(cr.Data.Raw, &sts); err != nil {
			return "", fmt.Errorf("failed to unmarshal statefulset data: %w", err)
		}
		return marshalPodTemplate(&sts.Spec.Template)

	case "DaemonSet":
		var ds appsv1.DaemonSet
		if err := json.Unmarshal(cr.Data.Raw, &ds); err != nil {
			return "", fmt.Errorf("failed to unmarshal daemonset data: %w", err)
		}
		return marshalPodTemplate(&ds.Spec.Template)

	default:
		return "", fmt.Errorf("unsupported workload kind for controller revision extraction: %q", workloadKind)
	}
}

// isOwnedBy reports whether any of the supplied OwnerReferences has the given UID.
// Used to associate ReplicaSets or ControllerRevisions with their parent workload.
func isOwnedBy(refs []metav1.OwnerReference, uid types.UID) bool {
	for _, ref := range refs {
		if ref.UID == uid {
			return true
		}
	}
	return false
}

// marshalPodTemplate serialises a PodTemplateSpec to YAML using the sigs.k8s.io/yaml
// library, which round-trips through JSON so all field names match the Kubernetes API.
func marshalPodTemplate(template *corev1.PodTemplateSpec) (string, error) {
	if template == nil {
		return "", nil
	}
	b, err := sigsyaml.Marshal(template)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// RollbackWorkload rolls a workload back to a specific historical revision by replacing
// its pod template spec with the one stored in that revision.
//
// The target revision is located by calling GetRevisionHistory. If no entry matches
// toRevision, an error is returned. Supports Deployment, StatefulSet, and DaemonSet.
//
// Multi-cluster safety: all Kubernetes requests are scoped to the cluster identified
// by clusterID, preventing cross-cluster data leakage or modification.
func (a *App) RollbackWorkload(clusterID, namespace, name, workloadKind string, toRevision int64) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
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
	entries, err := a.GetRevisionHistory(clusterID, namespace, name, workloadKind)
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

	// Unmarshal the stored YAML pod template back into a typed PodTemplateSpec.
	var podTemplate corev1.PodTemplateSpec
	if err := sigsyaml.Unmarshal([]byte(targetEntry.PodTemplate), &podTemplate); err != nil {
		return fmt.Errorf("failed to unmarshal pod template for revision %d: %w", toRevision, err)
	}

	// Replace the workload's pod template with the target revision's template and update.
	switch workloadKind {
	case "Deployment":
		deploy, err := deps.KubernetesClient.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("failed to get deployment %s/%s: %w", namespace, name, err)
		}
		deploy.Spec.Template = podTemplate
		if _, err := deps.KubernetesClient.AppsV1().Deployments(namespace).Update(ctx, deploy, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("failed to update deployment %s/%s: %w", namespace, name, err)
		}

	case "StatefulSet":
		sts, err := deps.KubernetesClient.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("failed to get statefulset %s/%s: %w", namespace, name, err)
		}
		sts.Spec.Template = podTemplate
		if _, err := deps.KubernetesClient.AppsV1().StatefulSets(namespace).Update(ctx, sts, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("failed to update statefulset %s/%s: %w", namespace, name, err)
		}

	case "DaemonSet":
		ds, err := deps.KubernetesClient.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("failed to get daemonset %s/%s: %w", namespace, name, err)
		}
		ds.Spec.Template = podTemplate
		if _, err := deps.KubernetesClient.AppsV1().DaemonSets(namespace).Update(ctx, ds, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("failed to update daemonset %s/%s: %w", namespace, name, err)
		}

	default:
		return fmt.Errorf("rollback not supported for workload kind %q", workloadKind)
	}

	if deps.Logger != nil {
		deps.Logger.Info(
			fmt.Sprintf("Rolled back %s %s/%s to revision %d", workloadKind, namespace, name, toRevision),
			"RollbackWorkload",
		)
	}
	return nil
}
