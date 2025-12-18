package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
)

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

type noopTestLogger struct{}

func (noopTestLogger) Debug(string, ...string) {}
func (noopTestLogger) Info(string, ...string)  {}
func (noopTestLogger) Warn(string, ...string)  {}
func (noopTestLogger) Error(string, ...string) {}
