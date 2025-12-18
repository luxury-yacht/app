package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	namespaceQuotasDomainName = "namespace-quotas"
	namespaceQuotasEntryLimit = 1000
)

// NamespaceQuotasBuilder constructs ResourceQuota/LimitRange summaries.
type NamespaceQuotasBuilder struct {
	quotaLister corelisters.ResourceQuotaLister
	limitLister corelisters.LimitRangeLister
}

// NamespaceQuotasSnapshot payload for quotas tab.
type NamespaceQuotasSnapshot struct {
	Resources []QuotaSummary `json:"resources"`
}

// QuotaSummary captures quota/limit range info.
type QuotaSummary struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"`
	Age       string `json:"age"`
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
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceQuotasDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles quota summaries for the namespace.
func (b *NamespaceQuotasBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	trimmed := strings.TrimSpace(scope)
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
		scopeLabel = "namespace:all"
	} else {
		namespace, err = parseAutoscalingNamespace(trimmed)
		if err != nil {
			return nil, err
		}
		scopeLabel = trimmed
	}

	quotas, err := b.listResourceQuotas(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace quotas: failed to list resourcequotas: %w", err)
	}
	limits, err := b.listLimitRanges(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace quotas: failed to list limitranges: %w", err)
	}

	return b.buildSnapshot(scopeLabel, quotas, limits)
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

func (b *NamespaceQuotasBuilder) buildSnapshot(namespace string, quotas []*corev1.ResourceQuota, limits []*corev1.LimitRange) (*refresh.Snapshot, error) {
	resources := make([]QuotaSummary, 0, len(quotas)+len(limits))
	var version uint64

	for _, quota := range quotas {
		if quota == nil {
			continue
		}
		summary := QuotaSummary{
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
		Payload: NamespaceQuotasSnapshot{Resources: resources},
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
