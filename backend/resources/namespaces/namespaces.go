/*
 * backend/resources/namespaces/namespaces.go
 *
 * Namespace resource handlers.
 * - Builds detail and list views for the frontend.
 */

package namespaces

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Namespace returns a detailed description for the given namespace.
func (s *Service) Namespace(name string) (*NamespaceDetails, error) {
	if err := s.ensureClient("namespace"); err != nil {
		return nil, err
	}

	client := s.deps.KubernetesClient
	ns, err := client.CoreV1().Namespaces().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.LogRequestFailure(err, fmt.Sprintf("Failed to get namespace %s", name), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get namespace: %w", err)
	}

	return s.buildNamespaceDetails(ns), nil
}

func (s *Service) buildNamespaceDetails(namespace *corev1.Namespace) *NamespaceDetails {
	hasWorkloads, workloadsUnknown := s.hasWorkloads(namespace.Name)
	quotas, limits := s.collectQuotasAndLimits(namespace.Name)
	opts := resourcemodel.ResourceModelBuildOptions{
		Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeRelationshipFacts | resourcemodel.MaterializeDetailFacts,
	}
	model := BuildResourceModel(s.deps.ClusterID, namespace, hasWorkloads, !workloadsUnknown, quotas, limits, opts)
	facts := BuildFacts(s.deps.ClusterID, namespace, hasWorkloads, !workloadsUnknown, quotas, limits, opts)
	details := &NamespaceDetails{
		Kind:             model.Ref.Kind,
		Name:             model.Ref.Name,
		StatusProjection: restypes.NewStatusProjection(model.Status),
		Labels:           model.Metadata.Labels,
		Annotations:      model.Metadata.Annotations,
		HasWorkloads:     facts.HasWorkloads,
		WorkloadsUnknown: !facts.WorkloadsKnown,
		ResourceQuotas:   restypes.ObjectRefsFromResourceLinks(facts.ResourceQuotas),
		LimitRanges:      restypes.ObjectRefsFromResourceLinks(facts.LimitRanges),
	}

	detailParts := []string{fmt.Sprintf("Status: %s", details.Status)}
	switch facts.WorkloadState {
	case workloadStateUnknown:
		detailParts = append(detailParts, "Workloads status unknown")
	case workloadStatePresent:
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
	probes := namespaceWorkloadProbes(client, ctx, namespace, opts)
	for _, probe := range probes {
		hasAny, err := probe.hasAny()
		if err != nil {
			s.logWorkloadProbeError(probe.resource, namespace, err)
			return false, true
		}
		if hasAny {
			return true, false
		}
	}

	return false, false
}

type namespaceWorkloadProbe struct {
	resource string
	hasAny   func() (bool, error)
}

func namespaceWorkloadProbes(client kubernetes.Interface, ctx context.Context, namespace string, opts metav1.ListOptions) []namespaceWorkloadProbe {
	return []namespaceWorkloadProbe{
		{resource: "deployments", hasAny: func() (bool, error) {
			list, err := client.AppsV1().Deployments(namespace).List(ctx, opts)
			return list != nil && len(list.Items) > 0, err
		}},
		{resource: "statefulsets", hasAny: func() (bool, error) {
			list, err := client.AppsV1().StatefulSets(namespace).List(ctx, opts)
			return list != nil && len(list.Items) > 0, err
		}},
		{resource: "daemonsets", hasAny: func() (bool, error) {
			list, err := client.AppsV1().DaemonSets(namespace).List(ctx, opts)
			return list != nil && len(list.Items) > 0, err
		}},
		{resource: "jobs", hasAny: func() (bool, error) {
			list, err := client.BatchV1().Jobs(namespace).List(ctx, opts)
			return list != nil && len(list.Items) > 0, err
		}},
		{resource: "cronjobs", hasAny: func() (bool, error) {
			list, err := client.BatchV1().CronJobs(namespace).List(ctx, opts)
			return list != nil && len(list.Items) > 0, err
		}},
		{resource: "pods", hasAny: func() (bool, error) {
			list, err := client.CoreV1().Pods(namespace).List(ctx, opts)
			return list != nil && len(list.Items) > 0, err
		}},
	}
}

func (s *Service) logWorkloadProbeError(resource, namespace string, err error) {
	if !apierrors.IsForbidden(err) {
		s.deps.LogRequestFailure(err, fmt.Sprintf("Failed to list %s in namespace %s", resource, namespace), logsources.ResourceLoader)
	}
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
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
}
