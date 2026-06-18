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
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceStorageBuilder{
		collectIndexer: unconditionalSharedIndexers(factory, namespaceStorageDomainName),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceStorageDomainName,
		BuildSnapshot: builder.Build,
	})
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

	resources, sources, version, err := collectDescriptorTableRows[StorageSummary](ctx, namespaceStorageDomainName, b.collectIndexer, meta, parsedScope.Namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace storage: failed to list pvcs: %w", err)
	}

	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Namespace == resources[j].Namespace {
			return resources[i].Name < resources[j].Name
		}
		return resources[i].Namespace < resources[j].Namespace
	})

	resolved := resolveTypedSnapshotPage(
		namespaceStorageDomainName,
		resources,
		query,
		storageTableQueryAdapter(),
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
