package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const rolloutAnnotation = "kubectl.kubernetes.io/restartedAt"

// RestartWorkload performs a rollout restart by patching the pod template metadata on the target workload.
// Supported workload kinds: Deployment, StatefulSet, DaemonSet.
func (a *App) RestartWorkload(clusterID, namespace, name, workloadKind string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}

	annotationValue := time.Now().UTC().Format(time.RFC3339)
	patch := map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{
					"annotations": map[string]any{
						rolloutAnnotation: annotationValue,
					},
				},
			},
		},
	}

	patchBytes, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("failed to marshal restart patch: %w", err)
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	switch workloadKind {
	case "Deployment":
		_, err = deps.KubernetesClient.AppsV1().Deployments(namespace).Patch(
			ctx,
			name,
			types.StrategicMergePatchType,
			patchBytes,
			metav1.PatchOptions{},
		)
	case "StatefulSet":
		_, err = deps.KubernetesClient.AppsV1().StatefulSets(namespace).Patch(
			ctx,
			name,
			types.StrategicMergePatchType,
			patchBytes,
			metav1.PatchOptions{},
		)
	case "DaemonSet":
		_, err = deps.KubernetesClient.AppsV1().DaemonSets(namespace).Patch(
			ctx,
			name,
			types.StrategicMergePatchType,
			patchBytes,
			metav1.PatchOptions{},
		)
	default:
		return fmt.Errorf("restart not supported for workload kind %q", workloadKind)
	}

	if err != nil {
		return fmt.Errorf("failed to restart %s/%s (%s): %w", namespace, name, workloadKind, err)
	}

	if deps.Logger != nil {
		deps.Logger.Info(fmt.Sprintf("Restarted %s %s/%s", workloadKind, namespace, name), "RestartWorkload")
	}
	return nil
}

// ScaleWorkload updates the replica count on a scalable workload.
// Supported workload kinds: Deployment, StatefulSet, ReplicaSet.
func (a *App) ScaleWorkload(clusterID, namespace, name, workloadKind string, replicas int) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}

	if replicas < 0 {
		return fmt.Errorf("replicas must be non-negative")
	}

	scale := &autoscalingv1.Scale{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Spec: autoscalingv1.ScaleSpec{Replicas: int32(replicas)},
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	switch workloadKind {
	case "Deployment":
		_, err := deps.KubernetesClient.AppsV1().Deployments(namespace).UpdateScale(
			ctx,
			name,
			scale,
			metav1.UpdateOptions{},
		)
		if err != nil {
			return fmt.Errorf("failed to scale deployment %s/%s: %w", namespace, name, err)
		}
	case "StatefulSet":
		_, err := deps.KubernetesClient.AppsV1().StatefulSets(namespace).UpdateScale(
			ctx,
			name,
			scale,
			metav1.UpdateOptions{},
		)
		if err != nil {
			return fmt.Errorf("failed to scale statefulset %s/%s: %w", namespace, name, err)
		}
	case "ReplicaSet":
		_, err := deps.KubernetesClient.AppsV1().ReplicaSets(namespace).UpdateScale(
			ctx,
			name,
			scale,
			metav1.UpdateOptions{},
		)
		if err != nil {
			return fmt.Errorf("failed to scale replicaset %s/%s: %w", namespace, name, err)
		}
	default:
		return fmt.Errorf("scaling not supported for workload kind %q", workloadKind)
	}

	if deps.Logger != nil {
		deps.Logger.Info(
			fmt.Sprintf("Scaled %s %s/%s to %d replicas", workloadKind, namespace, name, replicas),
			"ScaleWorkload",
		)
	}
	return nil
}

// Helper to obtain context even when Startup not yet run.
func (a *App) CtxOrBackground() context.Context {
	if a.Ctx != nil {
		return a.Ctx
	}
	return context.Background()
}
