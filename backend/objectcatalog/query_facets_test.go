package objectcatalog

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestCatalogFacetPathsPreserveTheirNamespaceUniverses(t *testing.T) {
	rows := []Summary{
		{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "team-a", Name: "match"}, Scope: ScopeNamespace},
		{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "team-b", Name: "other"}, Scope: ScopeNamespace},
		{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: "example.com", Version: "v1", Kind: "Widget", Resource: "widgets", Namespace: "team-c", Name: "custom"}, Scope: ScopeNamespace},
	}
	allKinds := []KindInfo{{Kind: "Pod", Namespaced: true}, {Kind: "Widget", Namespaced: true}}
	cachedKinds := []KindInfo{{Kind: "Cached", Namespaced: true}}
	for _, tc := range []struct {
		name             string
		opts             QueryOptions
		exact            bool
		cachedKinds      []KindInfo
		cachedNamespaces []string
		wantMaintained   []KindInfo
		wantSnapshot     []KindInfo
		wantMaintainedNS []string
		wantSnapshotNS   []string
	}{
		{
			name: "search and kind affect uncached maintained namespaces only", exact: true,
			opts:           QueryOptions{Kinds: []string{"Pod"}, Search: "match"},
			wantMaintained: allKinds, wantSnapshot: allKinds,
			wantMaintainedNS: []string{"team-a"}, wantSnapshotNS: []string{"team-a", "team-b", "team-c"},
		},
		{
			name: "published vocabularies survive filtered queries", exact: true,
			opts: QueryOptions{Search: "match"}, cachedKinds: cachedKinds, cachedNamespaces: []string{"cached-ns"},
			wantMaintained: cachedKinds, wantSnapshot: allKinds,
			wantMaintainedNS: []string{"cached-ns"}, wantSnapshotNS: []string{"team-a", "team-b", "team-c"},
		},
		{
			name: "dependent filters constrain kinds without constraining snapshot namespaces", exact: true,
			opts:           QueryOptions{Namespaces: []string{"team-c"}, Groups: []string{"example.com"}, ResourceScopes: []Scope{ScopeNamespace}},
			wantMaintained: []KindInfo{{Kind: "Widget", Namespaced: true}}, wantSnapshot: []KindInfo{{Kind: "Widget", Namespaced: true}},
			wantMaintainedNS: []string{"team-c"}, wantSnapshotNS: []string{"team-a", "team-b", "team-c"},
		},
		{
			name: "custom-only restricts both universes", exact: true,
			opts:           QueryOptions{CustomOnly: true},
			wantMaintained: []KindInfo{{Kind: "Widget", Namespaced: true}}, wantSnapshot: []KindInfo{{Kind: "Widget", Namespaced: true}},
			wantMaintainedNS: []string{"team-c"}, wantSnapshotNS: []string{"team-c"},
		},
		{
			name:        "approximate queries retain published vocabularies only",
			cachedKinds: cachedKinds, cachedNamespaces: []string{"cached-ns"},
			wantMaintained: cachedKinds, wantMaintainedNS: []string{"cached-ns"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			maintained, maintainedNS := catalogEngineFacets(rows, tc.opts, tc.cachedKinds, tc.cachedNamespaces, tc.exact)
			snapshot, snapshotNS := catalogEngineSnapshotFacets(rows, tc.opts, tc.exact)
			if !reflect.DeepEqual(maintained, tc.wantMaintained) || !reflect.DeepEqual(maintainedNS, tc.wantMaintainedNS) {
				t.Fatalf("maintained facets = %v / %v, want %v / %v", maintained, maintainedNS, tc.wantMaintained, tc.wantMaintainedNS)
			}
			if !reflect.DeepEqual(snapshot, tc.wantSnapshot) || !reflect.DeepEqual(snapshotNS, tc.wantSnapshotNS) {
				t.Fatalf("snapshot facets = %v / %v, want %v / %v", snapshot, snapshotNS, tc.wantSnapshot, tc.wantSnapshotNS)
			}
		})
	}
}
