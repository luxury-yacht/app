package resourcestream

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcecontract"
)

// TestSharedStreamRegistrationsMatchContract ties the shared stream-registration
// table to the canonical built-in resource contract so a typo or drift fails CI.
func TestSharedStreamRegistrationsMatchContract(t *testing.T) {
	for _, d := range sharedStreamRegistrations {
		found := false
		for _, b := range resourcecontract.BuiltinResources {
			if b.Group == d.group && b.Resource == d.resource {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("shared stream registration %q/%q not in BuiltinResources", d.group, d.resource)
		}
	}
}
