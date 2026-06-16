package resourcestream

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/streamregistry"
	"github.com/luxury-yacht/app/backend/resourcecontract"
)

// TestStreamRegistryMatchesContract ties every descriptor-driven stream
// registration to the canonical built-in resource contract so a typo or drift
// fails CI. streamregistry.Shared is the single source the manager loops; this
// guards it against the contract.
func TestStreamRegistryMatchesContract(t *testing.T) {
	for _, d := range streamregistry.Shared {
		if _, ok := resourcecontract.FindBuiltin(d.Group, d.Version, d.Kind); !ok {
			t.Errorf("stream descriptor %s/%s/%s (%s) not in BuiltinResources", d.Group, d.Version, d.Kind, d.Resource)
		}
	}
}
