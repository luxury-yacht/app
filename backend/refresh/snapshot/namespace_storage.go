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
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
)

const (
	namespaceStorageDomainName       = "namespace-storage"
	errNamespaceStorageScopeRequired = "namespace scope is required"
)

// NamespaceStorageBuilder constructs PVC summaries for a namespace by listing the
// kind's informer indexer and projecting it via the pvc package's stream-summary
// builder; Build loops the stream descriptor registry via collectDescriptorTableRows.
type NamespaceStorageBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[StorageSummary]
}

// storageQuerypageSchema derives the querypage Schema for the storage table from the
// existing typed-table adapter, via the shared generic schema builder. It REUSES the
// adapter's exact comparable sort-value encoder and row key, so the querypage engine
// orders rows byte-identically to the live typed-table executor.
func storageQuerypageSchema() querypage.Schema[StorageSummary] {
	return querypageSchemaFromAdapter(storageTableQueryAdapter(), []string{"name", "kind", "namespace", "capacity", "status", "storageClass", "age"})
}

// NamespaceStorageSnapshot payload for storage tab.
type NamespaceStorageSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []StorageSummary `json:"rows"`
}

func namespaceStorageQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "capacity", "status", "storageClass", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "capacity", "status", "storageClass"},
		[]string{persistentvolumeclaim.Identity.Kind},
	)
}

// StorageSummary captures PVC info for UI consumption. The type lives in the
// streamrows leaf so the pvc package can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type StorageSummary = streamrows.StorageSummary

// RegisterNamespaceStorageDomain registers the storage domain.
func RegisterNamespaceStorageDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	clusterMeta ClusterMeta,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := unconditionalSharedIndexers(factory, namespaceStorageDomainName)

	// Maintain a per-cluster store fed by each available storage kind's informer.
	maintained := newTypedMaintainedStore(clusterMeta, storageQuerypageSchema(), storageTableQueryAdapter())
	if err := registerMaintainedHandlers(maintained, namespaceStorageDomainName, collectIndexer, factory, nil); err != nil {
		return err
	}

	builder := &NamespaceStorageBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceStorageDomainName,
		BuildSnapshot: builder.Build,
	})
}

// storageSources computes per-descriptor availability for THIS request (indexer
// present AND runtimeResourceAllowed), returning the snapshot sources and a
// Kind→available map — the same gating collectDescriptorTableRows applies, so the
// maintained-store path and the list path agree on which kinds are visible.
func (b *NamespaceStorageBuilder) storageSources(ctx context.Context) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(namespaceStorageDomainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := b.collectIndexer(d) != nil && runtimeResourceAllowed(ctx, namespaceStorageDomainName, d.Group, d.Resource)
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

// Build assembles PVC summaries for the namespace.
func (b *NamespaceStorageBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceStorageDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceStorageScopeRequired)
	if err != nil {
		return nil, err
	}

	var resources []StorageSummary
	var sources []typedTableResourceSource
	var version uint64
	if b.maintained != nil {
		// Serve projected rows straight from the informer-fed store (no re-listing /
		// re-projecting); availability + sources mirror the list path exactly.
		var available map[string]bool
		sources, available = b.storageSources(ctx)
		resources = b.maintained.rows(parsedScope.Namespace, available)
		version = b.maintained.snapshotVersion()
	} else {
		var err error
		resources, sources, version, err = collectDescriptorTableRows[StorageSummary](ctx, namespaceStorageDomainName, b.collectIndexer, meta, parsedScope.Namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace storage: failed to list pvcs: %w", err)
		}
	}

	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Namespace == resources[j].Namespace {
			return resources[i].Name < resources[j].Name
		}
		return resources[i].Namespace < resources[j].Namespace
	})

	resolved := resolveTypedSnapshotPageViaStore(
		namespaceStorageDomainName,
		resources,
		query,
		storageTableQueryAdapter(),
		storageQuerypageSchema(),
		capabilitiesWithAvailableKinds(namespaceStorageQueryCapabilities(), sources),
		config.SnapshotNamespaceStorageEntryLimit,
		"storage resources",
		func(resource StorageSummary) string { return resource.Kind },
		typedTableQueryResourceIssues(ctx, namespaceStorageDomainName, query, sources),
	)
	return &refresh.Snapshot{
		Domain:  namespaceStorageDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceStorageSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
