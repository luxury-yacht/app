package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
)

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

func TestSortNamespaceCustomSummaries(t *testing.T) {
	items := []NamespaceCustomSummary{
		{Namespace: "staging", APIGroup: "apps.example.com", Kind: "Widget", Name: "zeta"},
		{Namespace: "default", APIGroup: "alpha.example.com", Kind: "Gadget", Name: "beta"},
		{Namespace: "default", APIGroup: "alpha.example.com", Kind: "Gadget", Name: "alpha"},
		{Namespace: "default", APIGroup: "beta.example.com", Kind: "Gadget", Name: "a"},
	}

	sortNamespaceCustomSummaries(items)

	require.Equal(t, []NamespaceCustomSummary{
		{Namespace: "default", APIGroup: "alpha.example.com", Kind: "Gadget", Name: "alpha"},
		{Namespace: "default", APIGroup: "alpha.example.com", Kind: "Gadget", Name: "beta"},
		{Namespace: "default", APIGroup: "beta.example.com", Kind: "Gadget", Name: "a"},
		{Namespace: "staging", APIGroup: "apps.example.com", Kind: "Widget", Name: "zeta"},
	}, items)
}
