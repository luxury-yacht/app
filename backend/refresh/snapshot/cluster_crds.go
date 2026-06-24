package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	apiextv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apiextlisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

const clusterCRDDomainName = "cluster-crds"

// ClusterCRDBuilder produces CustomResourceDefinition snapshots. In production it serves
// from an informer-fed maintained store (maintained); the crdLister path is the list
// fallback (and the direct-builder unit tests).
type ClusterCRDBuilder struct {
	crdLister  apiextlisters.CustomResourceDefinitionLister
	maintained *typedMaintainedStore[ClusterCRDEntry]
}

// clusterCRDAvailableKinds is the single-kind availability set the maintained store filters
// by: the CRD adapter projects every row's Kind as "CustomResourceDefinition".
var clusterCRDAvailableKinds = map[string]bool{"CustomResourceDefinition": true}

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

// crdsQuerypageSchema derives the querypage Schema for the CRD table from its
// typed-table adapter (reusing the adapter's exact sort encoder + row key), so the
// engine orders rows byte-identically to the live executor.
func crdsQuerypageSchema() querypage.Schema[ClusterCRDEntry] {
	return querypageSchemaFromAdapter(clusterCRDTableQueryAdapter(), []string{"name", "kind", "group", "scope", "details", "version", "age"})
}

// ClusterCRDEntry represents an individual CRD in the table.
//
// StorageVersion is the name of the version that the API server persists
// to etcd (the canonical "source of truth" form). ExtraServedVersionCount
// is the number of *additional* served versions beyond the storage
// version, used by the frontend to render `v1` for single-version CRDs
// and `v1 (+2)` for multi-version CRDs.
type ClusterCRDEntry = streamrows.ClusterCRDEntry

// RegisterClusterCRDDomain registers the CRD domain with the registry. It serves from a
// maintained store fed by the apiext CRD informer (projected at intake by the same
// BuildStreamSummary the list path uses), so Build reads rows from RAM instead of listing
// + re-projecting every request. The handler is registered before the apiext factory
// starts, so the sync gate guarantees the store is populated before the first serve.
func RegisterClusterCRDDomain(
	reg *domain.Registry,
	factory apiextinformers.SharedInformerFactory,
	clusterMeta ClusterMeta,
) error {
	if factory == nil {
		return errors.New("apiextensions informer factory is nil")
	}
	crdInformer := factory.Apiextensions().V1().CustomResourceDefinitions()

	maintained := newTypedMaintainedStore(clusterMeta, crdsQuerypageSchema(), clusterCRDTableQueryAdapter())
	reg.RegisterMaintainedStore(clusterCRDDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	if err := registerMaintainedInformerHandler(maintained, crdInformer.Informer(),
		func(obj interface{}) (ClusterCRDEntry, metav1.Object, bool) {
			crd, ok := obj.(*apiextv1.CustomResourceDefinition)
			if !ok {
				return ClusterCRDEntry{}, nil, false
			}
			return apiextensions.BuildStreamSummary(clusterMeta, crd), crd, true
		},
	); err != nil {
		return err
	}

	builder := &ClusterCRDBuilder{
		crdLister:  crdInformer.Lister(),
		maintained: maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterCRDDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build constructs the CRD snapshot payload.
func (b *ClusterCRDBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.maintained == nil && b.crdLister == nil {
		return nil, fmt.Errorf("cluster crds: CRD source unavailable")
	}
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterCRDDomainName, "")
	if err != nil {
		return nil, err
	}

	var entries []ClusterCRDEntry
	var version uint64
	if b.maintained != nil {
		// Serve from the informer-fed store (rows projected at intake by the same
		// BuildStreamSummary the list path uses) instead of listing + re-projecting.
		entries = b.maintained.rows("", clusterCRDAvailableKinds)
		version = b.maintained.snapshotVersion()
	} else {
		crds, err := b.crdLister.List(labels.Everything())
		if err != nil {
			return nil, fmt.Errorf("cluster crds: failed to list CRDs: %w", err)
		}
		entries = make([]ClusterCRDEntry, 0, len(crds))
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
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})

	resolved := resolveTypedSnapshotPageViaStore(
		clusterCRDDomainName,
		entries,
		query,
		clusterCRDTableQueryAdapter(),
		crdsQuerypageSchema(),
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
