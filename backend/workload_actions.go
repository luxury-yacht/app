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
func (a *App) RestartWorkload(namespace, name, workloadKind string) error {
	if a.client == nil {
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

	switch workloadKind {
	case "Deployment":
		_, err = a.client.AppsV1().Deployments(namespace).Patch(
			a.CtxOrBackground(),
			name,
			types.StrategicMergePatchType,
			patchBytes,
			metav1.PatchOptions{},
		)
	case "StatefulSet":
		_, err = a.client.AppsV1().StatefulSets(namespace).Patch(
			a.CtxOrBackground(),
			name,
			types.StrategicMergePatchType,
			patchBytes,
			metav1.PatchOptions{},
		)
	case "DaemonSet":
		_, err = a.client.AppsV1().DaemonSets(namespace).Patch(
			a.CtxOrBackground(),
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

	a.logger.Info(fmt.Sprintf("Restarted %s %s/%s", workloadKind, namespace, name), "RestartWorkload")
	return nil
}

// ScaleWorkload updates the replica count on a scalable workload.
// Supported workload kinds: Deployment, StatefulSet, ReplicaSet.
func (a *App) ScaleWorkload(namespace, name, workloadKind string, replicas int) error {
	if a.client == nil {
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

	switch workloadKind {
	case "Deployment":
		_, err := a.client.AppsV1().Deployments(namespace).UpdateScale(
			a.CtxOrBackground(),
			name,
			scale,
			metav1.UpdateOptions{},
		)
		if err != nil {
			return fmt.Errorf("failed to scale deployment %s/%s: %w", namespace, name, err)
		}
	case "StatefulSet":
		_, err := a.client.AppsV1().StatefulSets(namespace).UpdateScale(
			a.CtxOrBackground(),
			name,
			scale,
			metav1.UpdateOptions{},
		)
		if err != nil {
			return fmt.Errorf("failed to scale statefulset %s/%s: %w", namespace, name, err)
		}
	case "ReplicaSet":
		_, err := a.client.AppsV1().ReplicaSets(namespace).UpdateScale(
			a.CtxOrBackground(),
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

	a.logger.Info(fmt.Sprintf("Scaled %s %s/%s to %d replicas", workloadKind, namespace, name, replicas), "ScaleWorkload")
	return nil
}

// Helper to obtain context even when Startup not yet run.
func (a *App) CtxOrBackground() context.Context {
	if a.Ctx != nil {
		return a.Ctx
	}
	return context.Background()
}
