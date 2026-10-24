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

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
)

// IsWorkloadHPAManaged checks whether any HorizontalPodAutoscaler in the given
// namespace targets the specified workload GVK + name. Used by the object panel
// to switch HPA-managed workloads from arbitrary scaling to fixed zero/resume
// actions.
func (g *ResourceGateway) IsWorkloadHPAManaged(target resourcemodel.ResourceRef) (bool, error) {
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return false, err
	}
	deps, _, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return false, err
	}
	ctx := g.CtxOrBackground()

	return isWorkloadHPAManaged(ctx, deps, target)
}

func isWorkloadHPAManaged(ctx context.Context, deps common.Dependencies, target resourcemodel.ResourceRef) (bool, error) {
	if deps.KubernetesClient == nil {
		return false, fmt.Errorf("kubernetes client is not initialized")
	}
	kind, err := normalizeAppsV1WorkloadKind(target.Group, target.Version, target.Kind, scalableWorkloadKinds)
	if err != nil {
		return false, fmt.Errorf("HPA-managed check not supported: %w", err)
	}
	targetGVK := schema.GroupVersionKind{Group: strings.TrimSpace(target.Group), Version: strings.TrimSpace(target.Version), Kind: kind}

	hpas, err := deps.KubernetesClient.AutoscalingV1().HorizontalPodAutoscalers(target.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return false, fmt.Errorf("failed to list HPAs in namespace %s: %w", target.Namespace, err)
	}

	for _, hpa := range hpas.Items {
		ref := hpa.Spec.ScaleTargetRef
		refGVK := schema.FromAPIVersionAndKind(ref.APIVersion, ref.Kind)
		if ref.Name == target.Name && refGVK == targetGVK {
			return true, nil
		}
	}
	return false, nil
}
