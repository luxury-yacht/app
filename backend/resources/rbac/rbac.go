package rbac

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type stubLogger struct{}

func (stubLogger) Debug(string, ...string) {}
func (stubLogger) Info(string, ...string)  {}
func (stubLogger) Warn(string, ...string)  {}
func (stubLogger) Error(string, ...string) {}

type Dependencies struct {
	Common common.Dependencies
}

type Service struct {
	deps Dependencies
}

func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}

func newManagerWithClient(client *fake.Clientset) *Service {
	return NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           stubLogger{},
			KubernetesClient: client,
		},
	})
}

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return pods
}
