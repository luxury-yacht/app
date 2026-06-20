package resourcestream

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestNotifyOnlyStreamDomainsMatchContract keeps the Go notify-only set in
// lockstep with refresh-domain-contract.json, the documented source of truth
// the frontend reads at runtime. Adding/removing a notify-only domain must
// touch both, or this fails.
func TestNotifyOnlyStreamDomainsMatchContract(t *testing.T) {
	path := filepath.Join("..", "domain", "refresh-domain-contract.json")
	raw, err := os.ReadFile(path)
	require.NoError(t, err)

	var contract struct {
		DomainInventory map[string]struct {
			NotifyOnly bool `json:"notifyOnly"`
		} `json:"domainInventory"`
	}
	require.NoError(t, json.Unmarshal(raw, &contract))
	require.NotEmpty(t, contract.DomainInventory)

	contractDomains := map[string]bool{}
	for domain, entry := range contract.DomainInventory {
		if entry.NotifyOnly {
			contractDomains[domain] = true
		}
	}

	require.Equal(t, contractDomains, notifyOnlyStreamDomains,
		"backend notifyOnlyStreamDomains must match contract domainInventory notifyOnly flags")
}
