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

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
)

const (
	namespaceQuotasDomainName = "namespace-quotas"
)

// NamespaceQuotasPermissions indicates which resources should be included in the domain.
type NamespaceQuotasPermissions struct {
	IncludeResourceQuotas       bool
	IncludeLimitRanges          bool
	IncludePodDisruptionBudgets bool
}

// NamespaceQuotasBuilder constructs ResourceQuota/LimitRange/PodDisruptionBudget summaries.
type NamespaceQuotasBuilder struct {
	quotaLister corelisters.ResourceQuotaLister
	limitLister corelisters.LimitRangeLister
	pdbLister   policylisters.PodDisruptionBudgetLister
}

// NamespaceQuotasSnapshot payload for quotas tab.
type NamespaceQuotasSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []QuotaSummary `json:"rows"`
}

func namespaceQuotasQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "details", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "details"},
		[]string{"ResourceQuota", "LimitRange", "PodDisruptionBudget"},
	)
}

// QuotaSummary captures quota/limit range/PDB info. The type lives in the
// streamrows leaf so the kind packages can build it; these aliases keep the
// snapshot-side names and wire JSON unchanged.
type QuotaSummary = streamrows.QuotaSummary

// QuotaStatus carries PDB status fields needed by the quotas table.
type QuotaStatus = streamrows.QuotaStatus

// RegisterNamespaceQuotasDomain registers quotas domain.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
func RegisterNamespaceQuotasDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	perms NamespaceQuotasPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceQuotasBuilder{}
	if perms.IncludeResourceQuotas {
		builder.quotaLister = factory.Core().V1().ResourceQuotas().Lister()
	}
	if perms.IncludeLimitRanges {
		builder.limitLister = factory.Core().V1().LimitRanges().Lister()
	}
	if perms.IncludePodDisruptionBudgets {
		builder.pdbLister = factory.Policy().V1().PodDisruptionBudgets().Lister()
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceQuotasDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles quota summaries for the namespace by looping the kind collectors.
func (b *NamespaceQuotasBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceQuotasDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), "namespace scope is required")
	if err != nil {
		return nil, err
	}

	collectors := []kindCollector[QuotaSummary]{
		newQuotaCollector(b.quotaLister),
		newLimitRangeCollector(b.limitLister),
		newPodDisruptionBudgetCollector(b.pdbLister),
	}
	resources, sources, version, err := collectDomainRows(ctx, namespaceQuotasDomainName, collectors, meta, parsedScope.Namespace)
	if err != nil {
		return nil, err
	}

	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Namespace == resources[j].Namespace {
			return resources[i].Name < resources[j].Name
		}
		return resources[i].Namespace < resources[j].Namespace
	})

	issues := typedTableQueryResourceIssues(ctx, namespaceQuotasDomainName, query, sources)
	resolved := resolveTypedSnapshotPage(
		namespaceQuotasDomainName,
		resources,
		query,
		quotaTableQueryAdapter(),
		capabilitiesWithAvailableKinds(namespaceQuotasQueryCapabilities(), sources),
		config.SnapshotNamespaceQuotasEntryLimit,
		"quota resources",
		func(resource QuotaSummary) string { return resource.Kind },
		issues,
	)
	return &refresh.Snapshot{
		Domain:  namespaceQuotasDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceQuotasSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

func newQuotaCollector(lister corelisters.ResourceQuotaLister) kindCollector[QuotaSummary] {
	collector := kindCollector[QuotaSummary]{kind: "ResourceQuota", group: "", resource: "resourcequotas", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, namespace string) ([]QuotaSummary, uint64, error) {
			items, err := listResourceQuotas(lister, namespace)
			if err != nil {
				return nil, 0, err
			}
			rows := make([]QuotaSummary, 0, len(items))
			var version uint64
			for _, quota := range items {
				if quota == nil {
					continue
				}
				rows = append(rows, resourcequota.BuildStreamSummary(meta, quota))
				if v := resourceVersionOrTimestamp(quota); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newLimitRangeCollector(lister corelisters.LimitRangeLister) kindCollector[QuotaSummary] {
	collector := kindCollector[QuotaSummary]{kind: "LimitRange", group: "", resource: "limitranges", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, namespace string) ([]QuotaSummary, uint64, error) {
			items, err := listLimitRanges(lister, namespace)
			if err != nil {
				return nil, 0, err
			}
			rows := make([]QuotaSummary, 0, len(items))
			var version uint64
			for _, limit := range items {
				if limit == nil {
					continue
				}
				rows = append(rows, limitrange.BuildStreamSummary(meta, limit))
				if v := resourceVersionOrTimestamp(limit); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newPodDisruptionBudgetCollector(lister policylisters.PodDisruptionBudgetLister) kindCollector[QuotaSummary] {
	collector := kindCollector[QuotaSummary]{kind: "PodDisruptionBudget", group: "policy", resource: "poddisruptionbudgets", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, namespace string) ([]QuotaSummary, uint64, error) {
			items, err := listPodDisruptionBudgets(lister, namespace)
			if err != nil {
				return nil, 0, err
			}
			rows := make([]QuotaSummary, 0, len(items))
			var version uint64
			for _, pdb := range items {
				if pdb == nil {
					continue
				}
				rows = append(rows, poddisruptionbudget.BuildStreamSummary(meta, pdb))
				if v := resourceVersionOrTimestamp(pdb); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func listResourceQuotas(lister corelisters.ResourceQuotaLister, namespace string) ([]*corev1.ResourceQuota, error) {
	if namespace == "" {
		return lister.List(labels.Everything())
	}
	return lister.ResourceQuotas(namespace).List(labels.Everything())
}

func listLimitRanges(lister corelisters.LimitRangeLister, namespace string) ([]*corev1.LimitRange, error) {
	if namespace == "" {
		return lister.List(labels.Everything())
	}
	return lister.LimitRanges(namespace).List(labels.Everything())
}

func listPodDisruptionBudgets(lister policylisters.PodDisruptionBudgetLister, namespace string) ([]*policyv1.PodDisruptionBudget, error) {
	if namespace == "" {
		return lister.List(labels.Everything())
	}
	return lister.PodDisruptionBudgets(namespace).List(labels.Everything())
}
