package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	policylisters "k8s.io/client-go/listers/policy/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	namespaceQuotasDomainName = "namespace-quotas"
	namespaceQuotasEntryLimit = 1000
)

// NamespaceQuotasBuilder constructs ResourceQuota/LimitRange/PodDisruptionBudget summaries.
type NamespaceQuotasBuilder struct {
	quotaLister corelisters.ResourceQuotaLister
	limitLister corelisters.LimitRangeLister
	pdbLister   policylisters.PodDisruptionBudgetLister
}

// NamespaceQuotasSnapshot payload for quotas tab.
type NamespaceQuotasSnapshot struct {
	ClusterMeta
	Resources []QuotaSummary `json:"resources"`
}

// QuotaSummary captures quota/limit range/PDB info.
type QuotaSummary struct {
	ClusterMeta
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"`
	Age       string `json:"age"`
	// PDB-specific fields used by the quotas view.
	MinAvailable   *string      `json:"minAvailable,omitempty"`
	MaxUnavailable *string      `json:"maxUnavailable,omitempty"`
	Status         *QuotaStatus `json:"status,omitempty"`
}

// QuotaStatus carries PDB status fields needed by the quotas table.
type QuotaStatus struct {
	DisruptionsAllowed int32 `json:"disruptionsAllowed"`
	CurrentHealthy     int32 `json:"currentHealthy"`
	DesiredHealthy     int32 `json:"desiredHealthy"`
}

// RegisterNamespaceQuotasDomain registers quotas domain.
func RegisterNamespaceQuotasDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceQuotasBuilder{
		quotaLister: factory.Core().V1().ResourceQuotas().Lister(),
		limitLister: factory.Core().V1().LimitRanges().Lister(),
		pdbLister:   factory.Policy().V1().PodDisruptionBudgets().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceQuotasDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles quota summaries for the namespace.
func (b *NamespaceQuotasBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, fmt.Errorf("namespace scope is required")
	}

	isAll := isAllNamespaceScope(trimmed)
	var (
		namespace  string
		err        error
		scopeLabel string
	)
	if isAll {
		scopeLabel = refresh.JoinClusterScope(clusterID, "namespace:all")
	} else {
		namespace, err = parseAutoscalingNamespace(trimmed)
		if err != nil {
			return nil, err
		}
		scopeLabel = refresh.JoinClusterScope(clusterID, trimmed)
	}

	quotas, err := b.listResourceQuotas(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace quotas: failed to list resourcequotas: %w", err)
	}
	limits, err := b.listLimitRanges(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace quotas: failed to list limitranges: %w", err)
	}

	pdbs, err := b.listPodDisruptionBudgets(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace quotas: failed to list poddisruptionbudgets: %w", err)
	}

	return b.buildSnapshot(meta, scopeLabel, quotas, limits, pdbs)
}

func (b *NamespaceQuotasBuilder) listResourceQuotas(namespace string) ([]*corev1.ResourceQuota, error) {
	if namespace == "" {
		return b.quotaLister.List(labels.Everything())
	}
	return b.quotaLister.ResourceQuotas(namespace).List(labels.Everything())
}

func (b *NamespaceQuotasBuilder) listLimitRanges(namespace string) ([]*corev1.LimitRange, error) {
	if namespace == "" {
		return b.limitLister.List(labels.Everything())
	}
	return b.limitLister.LimitRanges(namespace).List(labels.Everything())
}

func (b *NamespaceQuotasBuilder) listPodDisruptionBudgets(namespace string) ([]*policyv1.PodDisruptionBudget, error) {
	if namespace == "" {
		return b.pdbLister.List(labels.Everything())
	}
	return b.pdbLister.PodDisruptionBudgets(namespace).List(labels.Everything())
}

func (b *NamespaceQuotasBuilder) buildSnapshot(
	meta ClusterMeta,
	namespace string,
	quotas []*corev1.ResourceQuota,
	limits []*corev1.LimitRange,
	pdbs []*policyv1.PodDisruptionBudget,
) (*refresh.Snapshot, error) {
	resources := make([]QuotaSummary, 0, len(quotas)+len(limits)+len(pdbs))
	var version uint64

	for _, quota := range quotas {
		if quota == nil {
			continue
		}
		summary := QuotaSummary{
			ClusterMeta: meta,
			Kind:      "ResourceQuota",
			Name:      quota.Name,
			Namespace: quota.Namespace,
			Details:   describeResourceQuota(quota),
			Age:       formatAge(quota.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(quota); v > version {
			version = v
		}
	}

	for _, limit := range limits {
		if limit == nil {
			continue
		}
		summary := QuotaSummary{
			ClusterMeta: meta,
			Kind:      "LimitRange",
			Name:      limit.Name,
			Namespace: limit.Namespace,
			Details:   describeLimitRange(limit),
			Age:       formatAge(limit.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(limit); v > version {
			version = v
		}
	}

	for _, pdb := range pdbs {
		if pdb == nil {
			continue
		}
		summary := QuotaSummary{
			ClusterMeta: meta,
			Kind:      "PodDisruptionBudget",
			Name:      pdb.Name,
			Namespace: pdb.Namespace,
			Details:   describePodDisruptionBudget(pdb),
			Age:       formatAge(pdb.CreationTimestamp.Time),
			Status: &QuotaStatus{
				DisruptionsAllowed: pdb.Status.DisruptionsAllowed,
				CurrentHealthy:     pdb.Status.CurrentHealthy,
				DesiredHealthy:     pdb.Status.DesiredHealthy,
			},
		}
		if pdb.Spec.MinAvailable != nil {
			value := pdb.Spec.MinAvailable.String()
			summary.MinAvailable = &value
		}
		if pdb.Spec.MaxUnavailable != nil {
			value := pdb.Spec.MaxUnavailable.String()
			summary.MaxUnavailable = &value
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(pdb); v > version {
			version = v
		}
	}

	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Namespace == resources[j].Namespace {
			return resources[i].Name < resources[j].Name
		}
		return resources[i].Namespace < resources[j].Namespace
	})

	if len(resources) > namespaceQuotasEntryLimit {
		resources = resources[:namespaceQuotasEntryLimit]
	}

	return &refresh.Snapshot{
		Domain:  namespaceQuotasDomainName,
		Scope:   namespace,
		Version: version,
		Payload: NamespaceQuotasSnapshot{ClusterMeta: meta, Resources: resources},
		Stats:   refresh.SnapshotStats{ItemCount: len(resources)},
	}, nil
}

func describeResourceQuota(quota *corev1.ResourceQuota) string {
	if quota == nil {
		return ""
	}
	return fmt.Sprintf("Hard: %d, Used: %d", len(quota.Status.Hard), len(quota.Status.Used))
}

func describeLimitRange(limit *corev1.LimitRange) string {
	if limit == nil {
		return ""
	}
	return fmt.Sprintf("Limits: %d", len(limit.Spec.Limits))
}

func describePodDisruptionBudget(pdb *policyv1.PodDisruptionBudget) string {
	if pdb == nil {
		return ""
	}
	parts := []string{}
	if pdb.Spec.MinAvailable != nil {
		parts = append(parts, fmt.Sprintf("MinAvailable: %s", pdb.Spec.MinAvailable.String()))
	}
	if pdb.Spec.MaxUnavailable != nil {
		parts = append(parts, fmt.Sprintf("MaxUnavailable: %s", pdb.Spec.MaxUnavailable.String()))
	}
	parts = append(parts, fmt.Sprintf("Disruptions Allowed: %d", pdb.Status.DisruptionsAllowed))
	return strings.Join(parts, ", ")
}
