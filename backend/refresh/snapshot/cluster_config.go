package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

const clusterConfigDomainName = "cluster-config"

// ClusterConfigBuilder aggregates configuration resources for the cluster tab by
// listing each registered kind (shared- or Gateway-API-factory) from its indexer.
type ClusterConfigBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[ClusterConfigEntry]
}

// clusterConfigQuerypageSchema derives the querypage Schema for the cluster config
// table from the existing typed-table adapter, via the shared generic schema builder.
// It REUSES the adapter's exact comparable sort-value encoder and row key, so the
// querypage engine orders rows byte-identically to the live typed-table executor.
func clusterConfigQuerypageSchema() querypage.Schema[ClusterConfigEntry] {
	return querypageSchemaFromAdapter(clusterConfigTableQueryAdapter(), []string{"name", "kind", "details", "age"})
}

// ClusterConfigSnapshot represents the payload exposed to the UI. It embeds the
// canonical ResourceQueryEnvelope (flattened into top-level JSON) plus the
// domain-typed rows.
type ClusterConfigSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterConfigEntry `json:"rows"`
}

func clusterConfigQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "details", "age"},
		[]string{"kinds"},
		[]string{"kind", "name", "details"},
		[]string{storageclass.Identity.Kind, ingressclass.Identity.Kind, gatewayclass.Identity.Kind, admission.MutatingIdentity.Kind, admission.ValidatingIdentity.Kind},
	)
}

// ClusterConfigEntry covers a storage class, ingress class, or webhook config.
// The type lives in the streamrows leaf so the kind packages can build it; this
// alias keeps the snapshot-side name and wire JSON unchanged.
type ClusterConfigEntry = streamrows.ClusterConfigEntry

// RegisterClusterConfigDomain registers the domain with the registry.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
func RegisterClusterConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	return RegisterClusterConfigDomainWithGatewayAPI(reg, factory, nil, allowed, clusterMeta, ingestManager)
}

// RegisterClusterConfigDomainWithGatewayAPI registers the cluster-config domain.
//
// This domain is MIXED: StorageClass, IngressClass, and the admission webhook kinds
// are owned-reflector ingest kinds (IngestOwned), fed from the ingest reflectors'
// Table-half Sink; GatewayClass is NOT cut and is still fed from the Gateway-API
// informer via registerMaintainedHandlers (which skips the ingest-owned kinds). When
// ingestManager is nil (a unit test) the cut kinds have no feed.
func RegisterClusterConfigDomainWithGatewayAPI(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := factoryIndexers(factory, gatewayFactory, allowed, clusterConfigDomainName, ingestManager)

	// Maintain a per-cluster store fed by each available config kind's source: the
	// ingest Sink for the cut kinds (StorageClass/IngressClass/webhooks), the
	// Gateway-API informer handler for the uncut GatewayClass.
	maintained := newTypedMaintainedStore(clusterMeta, clusterConfigQuerypageSchema(), clusterConfigTableQueryAdapter())
	// Register the store so the governor can spill it on Cold and re-paint + reconcile it on
	// re-warm (domain.Registry.{Spill,Restore,Reconcile}MaintainedStores).
	reg.RegisterMaintainedStore(clusterConfigDomainName, maintained)
	feedMaintainedFromIngest(maintained, clusterConfigDomainName, ingestManager)
	if err := registerMaintainedHandlers(maintained, clusterConfigDomainName, collectIndexer, factory, gatewayFactory); err != nil {
		return err
	}

	builder := &ClusterConfigBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// clusterConfigSources computes per-descriptor availability for THIS request (indexer
// present AND runtimeResourceAllowed), returning the snapshot sources and a
// Kind→available map — the same gating collectDescriptorTableRows applies, so the
// maintained-store path and the list path agree on which kinds are visible.
func (b *ClusterConfigBuilder) clusterConfigSources(ctx context.Context) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(clusterConfigDomainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := b.collectIndexer(d) != nil && runtimeResourceAllowed(ctx, clusterConfigDomainName, d.Group, d.Resource)
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

// Build produces the cluster configuration snapshot.
func (b *ClusterConfigBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterConfigDomainName, "")
	if err != nil {
		return nil, err
	}

	sortClusterConfigEntries := func(entries []ClusterConfigEntry) {
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].Kind == entries[j].Kind {
				return entries[i].Name < entries[j].Name
			}
			return entries[i].Kind < entries[j].Kind
		})
	}

	var resolved typedSnapshotPage[ClusterConfigEntry]
	var version uint64
	if b.maintained != nil {
		// Serve the query straight from the informer-fed store, querying it in place
		// (O(log N + page)) rather than snapshotting + rebuilding a per-Build store. The
		// domain is cluster-scoped, so the store is queried for all rows ("").
		sources, available := b.clusterConfigSources(ctx)
		resolved = resolveMaintainedDirect(
			b.maintained.store,
			query,
			available,
			"",
			clusterConfigTableQueryAdapter(),
			clusterConfigQuerypageSchema(),
			capabilitiesWithAvailableKinds(clusterConfigQueryCapabilities(), sources),
			config.SnapshotClusterConfigEntryLimit,
			"cluster configuration resources",
			func(entry ClusterConfigEntry) string { return entry.Kind },
			func() []ClusterConfigEntry {
				rows := b.maintained.rows("", available)
				sortClusterConfigEntries(rows)
				return rows
			},
			typedTableQueryResourceIssues(ctx, clusterConfigDomainName, query, sources),
		)
		version = b.maintained.snapshotVersion()
	} else {
		entries, sources, v, listErr := collectDescriptorTableRows[ClusterConfigEntry](ctx, clusterConfigDomainName, b.collectIndexer, meta, "")
		if listErr != nil {
			return nil, listErr
		}
		version = v
		sortClusterConfigEntries(entries)
		resolved = resolveTypedSnapshotPageViaStore(
			clusterConfigDomainName,
			entries,
			query,
			clusterConfigTableQueryAdapter(),
			clusterConfigQuerypageSchema(),
			capabilitiesWithAvailableKinds(clusterConfigQueryCapabilities(), sources),
			config.SnapshotClusterConfigEntryLimit,
			"cluster configuration resources",
			func(entry ClusterConfigEntry) string { return entry.Kind },
			typedTableQueryResourceIssues(ctx, clusterConfigDomainName, query, sources),
		)
	}
	// The window snapshot is the canonical unscoped refresh payload; only the
	// query page publishes the request scope.
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:  clusterConfigDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: ClusterConfigSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
