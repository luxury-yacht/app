package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apiextlisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

const clusterCRDDomainName = "cluster-crds"

// ClusterCRDBuilder produces CustomResourceDefinition snapshots.
type ClusterCRDBuilder struct {
	crdLister apiextlisters.CustomResourceDefinitionLister
}

// ClusterCRDSnapshot is returned to the frontend. It embeds the canonical
// ResourceQueryEnvelope (flattened into top-level JSON) plus the domain-typed
// rows.
type ClusterCRDSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterCRDEntry `json:"rows"`
}

func clusterCRDQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "group", "scope", "details", "version", "age"},
		[]string{"kinds"},
		[]string{"kind", "typeAlias", "name", "group", "scope", "details", "storageVersion"},
		[]string{apiextensions.Identity.Kind},
	)
}

// ClusterCRDEntry represents an individual CRD in the table.
//
// StorageVersion is the name of the version that the API server persists
// to etcd (the canonical "source of truth" form). ExtraServedVersionCount
// is the number of *additional* served versions beyond the storage
// version, used by the frontend to render `v1` for single-version CRDs
// and `v1 (+2)` for multi-version CRDs.
type ClusterCRDEntry = streamrows.ClusterCRDEntry

// RegisterClusterCRDDomain registers the CRD domain with the registry.
func RegisterClusterCRDDomain(
	reg *domain.Registry,
	factory apiextinformers.SharedInformerFactory,
) error {
	if factory == nil {
		return errors.New("apiextensions informer factory is nil")
	}
	builder := &ClusterCRDBuilder{
		crdLister: factory.Apiextensions().V1().CustomResourceDefinitions().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterCRDDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build constructs the CRD snapshot payload.
func (b *ClusterCRDBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.crdLister == nil {
		return nil, fmt.Errorf("cluster crds: CRD lister unavailable")
	}
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterCRDDomainName, "")
	if err != nil {
		return nil, err
	}
	crds, err := b.crdLister.List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("cluster crds: failed to list CRDs: %w", err)
	}

	entries := make([]ClusterCRDEntry, 0, len(crds))
	var version uint64
	for _, crd := range crds {
		if crd == nil {
			continue
		}
		// Use the shared row builder so the full-snapshot path and the
		// streaming/incremental update path emit identical row shapes.
		// See BuildClusterCRDSummary in streaming_helpers.go.
		entries = append(entries, apiextensions.BuildStreamSummary(meta, crd))
		if v := resourceVersionOrTimestamp(crd); v > version {
			version = v
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})

	resolved := resolveTypedSnapshotPage(
		clusterCRDDomainName,
		entries,
		query,
		clusterCRDTableQueryAdapter(),
		clusterCRDQueryCapabilities(),
		config.SnapshotClusterCRDEntryLimit,
		"CRDs",
		func(ClusterCRDEntry) string { return "CustomResourceDefinition" },
		nil,
	)
	// The window snapshot is the canonical unscoped refresh payload; only the
	// query page publishes the request scope.
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:  clusterCRDDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: ClusterCRDSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
