// Package domainpermissions tests the shared refresh-domain composition table.
package domainpermissions

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStreamDomainsDeriveFromCompositions(t *testing.T) {
	compositions := CompositionByDomain()

	for _, domain := range StreamDomains() {
		composition, ok := compositions[domain]
		require.Truef(t, ok, "stream domain %s must have a composition", domain)
		require.NotEmptyf(t, composition.Stream, "stream domain %s must declare stream resources", domain)
	}

	for _, composition := range compositions {
		if len(composition.Stream) == 0 {
			require.NotContains(t, StreamDomains(), composition.Domain)
		}
	}
}

func TestCompositionsReturnDefensiveCopies(t *testing.T) {
	compositions := Compositions()
	require.NotEmpty(t, compositions)

	compositions[0].Domain = "mutated"
	compositions[0].Runtime = append(compositions[0].Runtime, Resource{Resource: "mutated"})
	if len(compositions[0].Stream) > 0 {
		compositions[0].Stream[0].Resource = "mutated"
	}

	next := Compositions()
	require.NotEqual(t, "mutated", next[0].Domain)
	require.NotContains(t, next[0].Runtime, Resource{Resource: "mutated"})
	if len(next[0].Stream) > 0 {
		require.NotEqual(t, "mutated", next[0].Stream[0].Resource)
	}
}
