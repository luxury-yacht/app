package namespaces

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// RemoveSpecFinalizer updates a deleting Namespace through Kubernetes'
// dedicated finalize subresource, preserving every other spec finalizer.
func (s *Service) RemoveSpecFinalizer(ctx context.Context, name, finalizer string) error {
	if err := s.ensureClient("namespace"); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name is required")
	}
	finalizer = strings.TrimSpace(finalizer)
	if finalizer == "" {
		return fmt.Errorf("finalizer is required")
	}

	namespace, err := s.deps.KubernetesClient.CoreV1().Namespaces().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		err = s.deps.LogResourceRequestFailure(err, fmt.Sprintf("Failed to get namespace %s for finalization", name), "get", Identity, logsources.ResourceLoader)
		return fmt.Errorf("failed to get namespace: %w", err)
	}
	if namespace.DeletionTimestamp == nil {
		return fmt.Errorf("namespace %s is not deleting", name)
	}
	remaining, removed := removeNamespaceFinalizer(namespace.Spec.Finalizers, finalizer)
	if !removed {
		return nil
	}
	updated := namespace.DeepCopy()
	updated.Spec.Finalizers = remaining
	if _, err := s.deps.KubernetesClient.CoreV1().Namespaces().Finalize(ctx, updated, metav1.UpdateOptions{}); err != nil {
		err = s.deps.LogResourceRequestFailure(err, fmt.Sprintf("Failed to finalize namespace %s", name), "update", Identity, logsources.ResourceLoader)
		return fmt.Errorf("failed to finalize namespace: %w", err)
	}
	return nil
}

func removeNamespaceFinalizer(current []corev1.FinalizerName, target string) ([]corev1.FinalizerName, bool) {
	remaining := make([]corev1.FinalizerName, 0, len(current))
	removed := false
	for _, value := range current {
		if string(value) == target {
			removed = true
			continue
		}
		remaining = append(remaining, value)
	}
	return remaining, removed
}
