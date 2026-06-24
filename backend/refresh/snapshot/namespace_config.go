package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/secret"
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
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[ConfigSummary]
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
		[]string{configmap.Identity.Kind, secret.Identity.Kind},
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
//
// ConfigMap and Secret are owned-reflector ingest kinds (IngestOwned): when
// ingestManager is non-nil their maintained-store feed comes from the ingest
// reflectors' Table-half Sink and registerMaintainedHandlers skips them (the shared
// factory no longer caches them). When ingestManager is nil (a unit test) the store
// has no feed for the cut kinds.
func RegisterNamespaceConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := sharedFactoryIndexers(factory, allowed, namespaceConfigDomainName, ingestManager)

	// Maintain a per-cluster store fed by each available config kind's source: the
	// ingest Sink for cut kinds, the shared-informer handler for any uncut kind.
	maintained := newTypedMaintainedStore(clusterMeta, configQuerypageSchema(), configTableQueryAdapter())
	reg.RegisterMaintainedStore(namespaceConfigDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	feedMaintainedFromIngest(maintained, namespaceConfigDomainName, ingestManager)
	if err := registerMaintainedHandlers(maintained, namespaceConfigDomainName, collectIndexer, factory, nil); err != nil {
		return err
	}

	builder := &NamespaceConfigBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// configSources computes per-descriptor availability for THIS request (indexer
// present AND runtimeResourceAllowed), returning the snapshot sources and a
// Kind→available map — the same gating collectDescriptorTableRows applies, so the
// maintained-store path and the list path agree on which kinds are visible.
func (b *NamespaceConfigBuilder) configSources(ctx context.Context) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(namespaceConfigDomainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := b.collectIndexer(d) != nil && runtimeResourceAllowed(ctx, namespaceConfigDomainName, d.Group, d.Resource)
		sources = append(sources, typedTableResourceSource{
			Kind:      d.Kind,
			Group:     d.Group,
			Resource:  d.Resource,
			Available: ok,
		})
		available[d.Kind] = ok
	}
	return sources, available
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

	var resolved typedSnapshotPage[ConfigSummary]
	var version uint64
	if b.maintained != nil {
		// Serve the query straight from the informer-fed store, querying it in place
		// (O(log N + page)) rather than snapshotting + rebuilding a per-Build store.
		// availability + sources mirror the list path exactly.
		sources, available := b.configSources(ctx)
		resolved = resolveMaintainedDirect(
			b.maintained.store,
			query,
			available,
			parsedScope.Namespace,
			configTableQueryAdapter(),
			configQuerypageSchema(),
			capabilitiesWithAvailableKinds(namespaceConfigQueryCapabilities(), sources),
			config.SnapshotNamespaceConfigEntryLimit,
			"config resources",
			func(resource ConfigSummary) string { return resource.Kind },
			func() []ConfigSummary {
				rows := b.maintained.rows(parsedScope.Namespace, available)
				sortConfigSummaries(rows)
				return rows
			},
			typedTableQueryResourceIssues(ctx, namespaceConfigDomainName, query, sources),
		)
		version = b.maintained.snapshotVersion()
	} else {
		resources, sources, v, err := collectDescriptorTableRows[ConfigSummary](ctx, namespaceConfigDomainName, b.collectIndexer, meta, parsedScope.Namespace)
		if err != nil {
			return nil, err
		}
		version = v
		sortConfigSummaries(resources)
		// Serve the query branch through the querypage engine (proven byte-equivalent to
		// the bespoke typed-table executor in querypage_config_test.go); the window branch
		// and all envelope wiring are unchanged.
		resolved = resolveTypedSnapshotPageViaStore(
			namespaceConfigDomainName,
			resources,
			query,
			configTableQueryAdapter(),
			configQuerypageSchema(),
			capabilitiesWithAvailableKinds(namespaceConfigQueryCapabilities(), sources),
			config.SnapshotNamespaceConfigEntryLimit,
			"config resources",
			func(resource ConfigSummary) string { return resource.Kind },
			typedTableQueryResourceIssues(ctx, namespaceConfigDomainName, query, sources),
		)
	}
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
