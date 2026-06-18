package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
)

const (
	namespaceQuotasDomainName = "namespace-quotas"
)

// NamespaceQuotasBuilder constructs ResourceQuota/LimitRange/PodDisruptionBudget
// summaries by listing each registered kind from its informer indexer.
type NamespaceQuotasBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
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
		[]string{resourcequota.Identity.Kind, limitrange.Identity.Kind, poddisruptionbudget.Identity.Kind},
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
	allowed domainpermissions.AllowedResources,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceQuotasBuilder{
		collectIndexer: sharedFactoryIndexers(factory, allowed, namespaceQuotasDomainName),
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

	resources, sources, version, err := collectDescriptorTableRows[QuotaSummary](ctx, namespaceQuotasDomainName, b.collectIndexer, meta, parsedScope.Namespace)
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
