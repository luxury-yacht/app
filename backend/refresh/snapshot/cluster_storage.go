package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
)

const clusterStorageDomainName = "cluster-storage"

// ClusterStorageBuilder constructs PersistentVolume summaries.
type ClusterStorageBuilder struct {
	pvLister corelisters.PersistentVolumeLister
}

// ClusterStorageSnapshot is the payload exposed to the frontend. It embeds the
// canonical ResourceQueryEnvelope (flattened into the top-level JSON) and adds
// the domain-typed rows, so every backend-query table presents one shape.
type ClusterStorageSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterStorageEntry `json:"rows"`
}

// clusterStorageQueryCapabilities reports the backend-supported global table
// behavior for the cluster storage table (matching clusterStorageTableQueryAdapter).
func clusterStorageQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "storageClass", "capacity", "accessModes", "status", "claim", "age"},
		[]string{"kinds"},
		[]string{"kind", "name", "storageClass", "capacity", "accessModes", "status", "claim"},
		[]string{"PersistentVolume"},
	)
}

// ClusterStorageEntry represents a persistent volume in the cluster view. The
// type lives in the streamrows leaf so the pv package can build it; this alias
// keeps the snapshot-side name and wire JSON unchanged.
type ClusterStorageEntry = streamrows.ClusterStorageEntry

// RegisterClusterStorageDomain registers the storage domain.
func RegisterClusterStorageDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterStorageBuilder{
		pvLister: factory.Core().V1().PersistentVolumes().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterStorageDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build creates a snapshot of persistent volumes.
func (b *ClusterStorageBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.pvLister == nil {
		return nil, fmt.Errorf("cluster storage: persistent volume lister unavailable")
	}
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterStorageDomainName, "")
	if err != nil {
		return nil, err
	}
	pvs, err := b.pvLister.List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("cluster storage: failed to list persistent volumes: %w", err)
	}
	entries := make([]ClusterStorageEntry, 0, len(pvs))
	var version uint64
	// The pv package owns the row builder; the full-snapshot path here and the
	// streaming/incremental path both call it so they cannot drift.
	for _, pv := range pvs {
		if pv == nil {
			continue
		}
		entries = append(entries, persistentvolume.BuildStreamSummary(meta, pv))
		if v := resourceVersionOrTimestamp(pv); v > version {
			version = v
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})

	resolved := resolveTypedSnapshotPage(
		clusterStorageDomainName,
		entries,
		query,
		clusterStorageTableQueryAdapter(),
		clusterStorageQueryCapabilities(),
		config.SnapshotClusterStorageEntryLimit,
		"persistent volumes",
		func(entry ClusterStorageEntry) string { return entry.Kind },
		nil,
	)
	// The window snapshot is the canonical unscoped refresh payload; only the
	// query page publishes the request scope.
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:  clusterStorageDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: ClusterStorageSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
