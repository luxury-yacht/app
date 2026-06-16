package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
)

const (
	namespaceConfigDomainName       = "namespace-config"
	errNamespaceConfigScopeRequired = "namespace scope is required"
)

// NamespaceConfigBuilder constructs config summaries for a namespace by listing
// each registered kind (ConfigMap, Secret) from its informer indexer and
// projecting it via the kind package's stream-summary builder; Build loops the
// stream descriptor registry via collectDescriptorTableRows.
type NamespaceConfigBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
}

// NamespaceConfigSnapshot payload returned to the frontend. It embeds the
// canonical ResourceQueryEnvelope (flattened into top-level JSON) plus the
// domain-typed rows.
type NamespaceConfigSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ConfigSummary `json:"rows"`
}

func namespaceConfigQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "data", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "typeAlias", "name", "namespace", "data"},
		[]string{"ConfigMap", "Secret"},
	)
}

// ConfigSummary describes a ConfigMap or Secret entry. The type lives in the
// streamrows leaf so the kind packages can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type ConfigSummary = streamrows.ConfigSummary

// RegisterNamespaceConfigDomain registers the namespace config domain.
// Only indexers for permitted resources are wired; denied resources are skipped
// so they still appear in the source list (for query capabilities/issues) but
// are not listed.
func RegisterNamespaceConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceConfigBuilder{
		collectIndexer: sharedFactoryIndexers(factory, allowed, namespaceConfigDomainName),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles the namespace-config rows by looping the stream descriptors.
func (b *NamespaceConfigBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceConfigDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceConfigScopeRequired)
	if err != nil {
		return nil, err
	}

	resources, sources, version, err := collectDescriptorTableRows[ConfigSummary](ctx, namespaceConfigDomainName, b.collectIndexer, meta, parsedScope.Namespace)
	if err != nil {
		return nil, err
	}

	sortConfigSummaries(resources)

	issues := typedTableQueryResourceIssues(ctx, namespaceConfigDomainName, query, sources)
	resolved := resolveTypedSnapshotPage(
		namespaceConfigDomainName,
		resources,
		query,
		configTableQueryAdapter(),
		capabilitiesWithAvailableKinds(namespaceConfigQueryCapabilities(), sources),
		config.SnapshotNamespaceConfigEntryLimit,
		"config resources",
		func(resource ConfigSummary) string { return resource.Kind },
		issues,
	)
	return &refresh.Snapshot{
		Domain:  namespaceConfigDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceConfigSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

func sortConfigSummaries(resources []ConfigSummary) {
	sort.SliceStable(resources, func(i, j int) bool {
		if resources[i].Namespace != resources[j].Namespace {
			return resources[i].Namespace < resources[j].Namespace
		}
		if resources[i].Name != resources[j].Name {
			return resources[i].Name < resources[j].Name
		}
		if resources[i].Kind != resources[j].Kind {
			return resources[i].Kind < resources[j].Kind
		}
		return resources[i].TypeAlias < resources[j].TypeAlias
	})
}
