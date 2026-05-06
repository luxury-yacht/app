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

	"github.com/luxury-yacht/app/backend/resources/autoscaling"
)

func (a *App) GetHorizontalPodAutoscaler(clusterID, namespace, name string) (*HorizontalPodAutoscalerDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "HPA", namespace, name, func() (*HorizontalPodAutoscalerDetails, error) {
		return autoscaling.NewService(deps).HorizontalPodAutoscaler(namespace, name)
	})
}

// IsWorkloadHPAManaged checks whether any HorizontalPodAutoscaler in the given
// namespace targets the specified workload GVK + name. Used by the object panel
// to determine if the Scale action should be disabled.
func (a *App) IsWorkloadHPAManaged(clusterID, namespace, group, version, kind, name string) (bool, error) {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return false, err
	}
	kind, err := normalizeAppsV1WorkloadKind(group, version, kind, scalableWorkloadKinds)
	if err != nil {
		return false, fmt.Errorf("HPA-managed check not supported: %w", err)
	}
	targetGVK := schema.GroupVersionKind{Group: strings.TrimSpace(group), Version: strings.TrimSpace(version), Kind: kind}

	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return false, err
	}
	if deps.KubernetesClient == nil {
		return false, fmt.Errorf("kubernetes client is not initialized")
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

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
