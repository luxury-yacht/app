package namespaces

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Namespace returns a detailed description for the given namespace.
func (s *Service) Namespace(name string) (*restypes.NamespaceDetails, error) {
	if err := s.ensureClient("namespace"); err != nil {
		return nil, err
	}

	client := s.deps.KubernetesClient
	ns, err := client.CoreV1().Namespaces().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get namespace %s: %v", name, err))
		return nil, fmt.Errorf("failed to get namespace: %v", err)
	}

	return s.buildNamespaceDetails(ns), nil
}

func (s *Service) buildNamespaceDetails(namespace *corev1.Namespace) *restypes.NamespaceDetails {
	details := &restypes.NamespaceDetails{
		Kind:        "Namespace",
		Name:        namespace.Name,
		Age:         common.FormatAge(namespace.CreationTimestamp.Time),
		Status:      string(namespace.Status.Phase),
		Labels:      namespace.Labels,
		Annotations: namespace.Annotations,
	}

	hasWorkloads, workloadsUnknown := s.hasWorkloads(namespace.Name)
	details.HasWorkloads = hasWorkloads
	if workloadsUnknown {
		details.WorkloadsUnknown = true
	}
	details.ResourceQuotas, details.LimitRanges = s.collectQuotasAndLimits(namespace.Name)

	detailParts := []string{fmt.Sprintf("Status: %s", details.Status)}
	switch {
	case workloadsUnknown:
		detailParts = append(detailParts, "Workloads status unknown")
	case details.HasWorkloads:
		detailParts = append(detailParts, "Has workloads")
	default:
		detailParts = append(detailParts, "No workloads")
	}
	if len(details.ResourceQuotas) > 0 {
		detailParts = append(detailParts, fmt.Sprintf("%d quota(s)", len(details.ResourceQuotas)))
	}
	if len(details.LimitRanges) > 0 {
		detailParts = append(detailParts, fmt.Sprintf("%d limit(s)", len(details.LimitRanges)))
	}

	details.Details = strings.Join(detailParts, ", ")

	return details
}

func (s *Service) hasWorkloads(namespace string) (bool, bool) {
	client := s.deps.KubernetesClient
	if client == nil {
		s.logError("hasWorkloads: kubernetes client not initialised")
		return false, true
	}

	ctx, cancel := context.WithTimeout(s.deps.Context, config.NamespaceOperationTimeout)
	defer cancel()

	opts := metav1.ListOptions{Limit: 1}

	handleListError := func(resource string, err error) bool {
		if err == nil {
			return false
		}
		if apierrors.IsForbidden(err) {
			return true
		}
		s.logError(fmt.Sprintf("Failed to list %s in namespace %s: %v", resource, namespace, err))
		return true
	}

	if list, err := client.AppsV1().Deployments(namespace).List(ctx, opts); err != nil {
		if handleListError("deployments", err) {
			return false, true
		}
	} else if len(list.Items) > 0 {
		return true, false
	}
	if list, err := client.AppsV1().StatefulSets(namespace).List(ctx, opts); err != nil {
		if handleListError("statefulsets", err) {
			return false, true
		}
	} else if len(list.Items) > 0 {
		return true, false
	}
	if list, err := client.AppsV1().DaemonSets(namespace).List(ctx, opts); err != nil {
		if handleListError("daemonsets", err) {
			return false, true
		}
	} else if len(list.Items) > 0 {
		return true, false
	}
	if list, err := client.BatchV1().Jobs(namespace).List(ctx, opts); err != nil {
		if handleListError("jobs", err) {
			return false, true
		}
	} else if len(list.Items) > 0 {
		return true, false
	}
	if list, err := client.BatchV1().CronJobs(namespace).List(ctx, opts); err != nil {
		if handleListError("cronjobs", err) {
			return false, true
		}
	} else if len(list.Items) > 0 {
		return true, false
	}
	if list, err := client.CoreV1().Pods(namespace).List(ctx, opts); err != nil {
		if handleListError("pods", err) {
			return false, true
		}
	} else if len(list.Items) > 0 {
		return true, false
	}

	return false, false

}

func (s *Service) collectQuotasAndLimits(namespace string) (quotas, limits []string) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, nil
	}

	ctx, cancel := context.WithTimeout(s.deps.Context, config.NamespaceOperationTimeout)
	defer cancel()

	if rqList, err := client.CoreV1().ResourceQuotas(namespace).List(ctx, metav1.ListOptions{}); err == nil {
		for _, quota := range rqList.Items {
			quotas = append(quotas, quota.Name)
		}
	}

	if lrList, err := client.CoreV1().LimitRanges(namespace).List(ctx, metav1.ListOptions{}); err == nil {
		for _, lr := range lrList.Items {
			limits = append(limits, lr.Name)
		}
	}

	return quotas, limits
}

func (s *Service) ensureClient(resource string) error {
	if s.deps.EnsureClient != nil {
		if err := s.deps.EnsureClient(resource); err != nil {
			return err
		}
	}
	if s.deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}
	return nil
}

func (s *Service) logError(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Error(msg, "ResourceLoader")
	}
}
