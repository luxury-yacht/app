package system

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
)

// Each built-in kind reaches the cluster through one feed: its owned
// reflector. The subsystem has one feed technology, so no second
// watch can double a kind's API load and memory.
func TestEachKindIsFedByItsOwnedReflector(t *testing.T) {
	h := newIngestHarness(t)
	for _, descriptor := range kindregistry.All {
		identity := descriptor.Identity
		require.Truef(t, h.subsystem.IngestManager.Tracks(identity.GVR()), "%s has no owned reflector", identity.GVR())
	}
}
