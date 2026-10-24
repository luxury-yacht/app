package domain

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh"
)

// TestDomainScopesMatchAuthoredExamples executes every domain's authored scope
// examples through the backend codec. The frontend runs the same examples, so
// both layers accept the same scope language and encode it identically.
func TestDomainScopesMatchAuthoredExamples(t *testing.T) {
	raw, err := os.ReadFile("refresh-domain-contract.json")
	require.NoError(t, err)
	var contract struct {
		DomainInventory map[string]struct {
			ScopeContract struct {
				Valid   []string `json:"valid"`
				Invalid []string `json:"invalid"`
			} `json:"scopeContract"`
		} `json:"domainInventory"`
	}
	require.NoError(t, json.Unmarshal(raw, &contract))
	require.NotEmpty(t, contract.DomainInventory)

	for domainName, inventory := range contract.DomainInventory {
		for _, tail := range inventory.ScopeContract.Valid {
			scope := refresh.JoinClusterScope("c1", tail)
			t.Run(domainName+"/valid/"+tail, func(t *testing.T) {
				parsed, err := ParseDomainScope(domainName, scope)
				require.NoError(t, err)
				require.Equal(t, "c1", parsed.ClusterID)
				require.Equal(t, scope, parsed.String())
			})
		}
		for _, tail := range inventory.ScopeContract.Invalid {
			scope := refresh.JoinClusterScope("c1", tail)
			t.Run(domainName+"/invalid/"+tail, func(t *testing.T) {
				_, err := ParseDomainScope(domainName, scope)
				require.Error(t, err)
			})
		}
	}
}

func TestParseDomainScopeRejectsUnknownDomain(t *testing.T) {
	_, err := ParseDomainScope("mystery-domain", "c1|")
	require.Error(t, err)
}
