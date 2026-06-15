/*
 * backend/resources_autoscaling.go
 *
 * App-level autoscaling resource wrappers.
 * - Exposes HorizontalPodAutoscaler handlers.
 */

package backend

import (
	"context"
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/resources/common"
)

// IsWorkloadHPAManaged checks whether any HorizontalPodAutoscaler in the given
// namespace targets the specified workload GVK + name. Used by the object panel
// to switch HPA-managed workloads from arbitrary scaling to fixed zero/resume
// actions.
func (a *App) IsWorkloadHPAManaged(clusterID, namespace, group, version, kind, name string) (bool, error) {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return false, err
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return false, err
	}
	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	return isWorkloadHPAManaged(ctx, deps, namespace, group, version, kind, name)
}

func isWorkloadHPAManaged(ctx context.Context, deps common.Dependencies, namespace, group, version, kind, name string) (bool, error) {
	if deps.KubernetesClient == nil {
		return false, fmt.Errorf("kubernetes client is not initialized")
	}
	kind, err := normalizeAppsV1WorkloadKind(group, version, kind, scalableWorkloadKinds)
	if err != nil {
		return false, fmt.Errorf("HPA-managed check not supported: %w", err)
	}
	targetGVK := schema.GroupVersionKind{Group: strings.TrimSpace(group), Version: strings.TrimSpace(version), Kind: kind}

	hpas, err := deps.KubernetesClient.AutoscalingV1().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return false, fmt.Errorf("failed to list HPAs in namespace %s: %w", namespace, err)
	}

	for _, hpa := range hpas.Items {
		ref := hpa.Spec.ScaleTargetRef
		refGVK := schema.FromAPIVersionAndKind(ref.APIVersion, ref.Kind)
		if ref.Name == name && refGVK == targetGVK {
			return true, nil
		}
	}
	return false, nil
}
