package pods

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// GetPod returns detailed information about a single pod.
func GetPod(deps common.Dependencies, namespace string, name string, detailed bool) (*restypes.PodDetailInfo, error) {
	return NewService(deps).GetPod(namespace, name, detailed)
}

func (s *Service) GetPod(namespace string, name string, detailed bool) (*restypes.PodDetailInfo, error) {
	s.deps.Logger.Debug(fmt.Sprintf("GetPod called for %s/%s (detailed: %v)", namespace, name, detailed), "Pod")
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	details, err := s.fetchSinglePodFull(namespace, name)
	if err != nil {
		return nil, err
	}
	s.deps.Logger.Debug(fmt.Sprintf("Successfully retrieved pod %s/%s", namespace, name), "Pod")
	return details, nil
}

// DeletePod removes the named pod from the cluster.
func DeletePod(deps common.Dependencies, namespace, name string) error {
	return NewService(deps).DeletePod(namespace, name)
}

func (s *Service) DeletePod(namespace, name string) error {
	if s.deps.KubernetesClient == nil || s.deps.Context == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}

	ctx, cancel := context.WithCancel(s.deps.Context)
	defer cancel()

	if err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to delete pod %s/%s: %v", namespace, name, err), "Pod")
		return fmt.Errorf("failed to delete pod: %v", err)
	}

	s.deps.Logger.Info(fmt.Sprintf("Deleted pod %s/%s", namespace, name), "Pod")
	return nil
}
