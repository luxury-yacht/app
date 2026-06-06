package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apiextlisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
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
	)
}

// ClusterCRDEntry represents an individual CRD in the table.
//
// StorageVersion is the name of the version that the API server persists
// to etcd (the canonical "source of truth" form). ExtraServedVersionCount
// is the number of *additional* served versions beyond the storage
// version, used by the frontend to render `v1` for single-version CRDs
// and `v1 (+2)` for multi-version CRDs.
type ClusterCRDEntry struct {
	ClusterMeta
	Kind                    string `json:"kind"`
	Name                    string `json:"name"`
	Group                   string `json:"group"`
	Scope                   string `json:"scope"`
	Details                 string `json:"details"`
	StorageVersion          string `json:"storageVersion,omitempty"`
	ExtraServedVersionCount int    `json:"extraServedVersionCount,omitempty"`
	Age                     string `json:"age"`
	AgeTimestamp            int64  `json:"ageTimestamp,omitempty"`
	TypeAlias               string `json:"typeAlias,omitempty"`
}

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
		entries = append(entries, BuildClusterCRDSummary(meta, crd))
		if v := resourceVersionOrTimestamp(crd); v > version {
			version = v
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})

	if query.Enabled {
		page := applyTypedTableQuery(entries, query, clusterCRDTableQueryAdapter())
		return &refresh.Snapshot{
			Domain:  clusterCRDDomainName,
			Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
			Version: version,
			Payload: ClusterCRDSnapshot{
				ClusterMeta: meta,
				ResourceQueryEnvelope: ResourceQueryEnvelope{
					Provider:      ResourceQueryProviderTypedResource,
					Table:         clusterCRDDomainName,
					Continue:      page.Continue,
					CursorInvalid: page.CursorInvalid,
					Total:         page.Total,
					TotalIsExact:  page.TotalIsExact,
					Kinds:         page.Kinds,
					Namespaces:    page.Namespaces,
					FacetsExact:   page.FacetsExact,
					Completeness:  resourceQueryCompleteness(true),
					Dynamic:       page.Dynamic,
					Capabilities:  clusterCRDQueryCapabilities(),
				},
				Rows: page.Rows,
			},
			Stats: refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}, nil
	}

	var totalItems int
	entries, totalItems = truncateSnapshotWindow(entries, config.SnapshotClusterCRDEntryLimit)

	return &refresh.Snapshot{
		Domain:  clusterCRDDomainName,
		Version: version,
		Payload: ClusterCRDSnapshot{
			ClusterMeta: meta,
			ResourceQueryEnvelope: ResourceQueryEnvelope{
				Provider:     ResourceQueryProviderTypedResource,
				Table:        clusterCRDDomainName,
				Total:        totalItems,
				TotalIsExact: totalItems == len(entries),
				Kinds:        snapshotSortedKinds(entries, func(ClusterCRDEntry) string { return "CustomResourceDefinition" }),
				FacetsExact:  true,
				Completeness: resourceQueryCompleteness(totalItems == len(entries)),
				Capabilities: clusterCRDQueryCapabilities(),
			},
			Rows: entries,
		},
		Stats: snapshotWindowStats(len(entries), totalItems, "CRDs"),
	}, nil
}

// crdVersionSummary returns the storage version name and the count of
// *additional* served versions for the Version column. The frontend
// renders this as `storageVersion` when extraServed == 0 and
// `storageVersion (+N)` when extraServed >= 1.
//
// Storage version is the canonical persistence form: when a CRD serves
// multiple versions, exactly one is marked Storage and the API server
// converts to/from it.
//
// Fallback chain when no version is flagged Storage (rare/transient):
//  1. first served version
//  2. first version in the list
//  3. empty string (only if Spec.Versions is empty)
//
// extraServed counts versions where Served && Name != storageVersion. A
// CRD that serves only its storage version returns (storageVersion, 0).
func crdVersionSummary(crd *apiextensionsv1.CustomResourceDefinition) (storageVersion string, extraServed int) {
	if crd == nil || len(crd.Spec.Versions) == 0 {
		return "", 0
	}
	facts := resourcemodel.BuildCustomResourceDefinitionFacts(crd)
	return facts.StorageVersion, facts.ExtraServedVersionCount
}

func describeCRDVersions(crd *apiextensionsv1.CustomResourceDefinition) string {
	if crd == nil {
		return ""
	}
	return resourcemodel.CustomResourceDefinitionVersionDetails(resourcemodel.BuildCustomResourceDefinitionFacts(crd))
}
