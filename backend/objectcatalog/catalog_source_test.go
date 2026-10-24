package objectcatalog

import (
	"sort"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
)

// The object catalog is the source of truth for namespace/cluster listings, so a
// built-in kind that silently stops being collected vanishes from Browse. Every
// registry kind is collected from its owned reflector's store, except the kinds
// CatalogNone excludes. Literal kind names in tests are sanctioned by the
// resource-kind-registry contract (docs/architecture/resource-kind-registry.md).
func TestEveryBuiltinKindIsCollectedFromIngestOrExcluded(t *testing.T) {
	var excluded []string
	for _, d := range kindregistry.All {
		if d.CatalogSource == kindspec.CatalogNone {
			excluded = append(excluded, d.Identity.Kind)
		}
	}
	sort.Strings(excluded)
	require.Equal(t, []string{"Event"}, excluded, "update this guard deliberately when a kind leaves the catalog")
}
