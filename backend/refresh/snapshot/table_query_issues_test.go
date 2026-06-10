package snapshot

import (
	"testing"
)

// The published kind vocabulary narrows to the kinds that can currently
// produce rows: a source that is unavailable (the cluster does not serve the
// resource, or this user cannot list it — the same Available semantics the
// issues channel uses) drops its kind from the Kinds dropdown options.
// Vocabulary kinds without a source entry are unconditional and stay.
func TestCapabilitiesWithAvailableKindsFiltersUnavailableSources(t *testing.T) {
	capabilities := newTypedResourceCapabilities(
		[]string{"name"},
		[]string{"kinds"},
		[]string{"name"},
		[]string{"Service", "Ingress", "Gateway", "HTTPRoute"},
	)

	filtered := capabilitiesWithAvailableKinds(capabilities, []typedTableResourceSource{
		{Kind: "Service", Available: true},
		{Kind: "Ingress", Available: true},
		{Kind: "Gateway", Available: false},
		{Kind: "HTTPRoute", Available: false},
	})

	if got, want := filtered.KindVocabulary, []string{"Service", "Ingress"}; !equalStringSlices(got, want) {
		t.Errorf("kind vocabulary mismatch\n got: %v\nwant: %v", got, want)
	}
	// The static family vocabulary is untouched (the conformance table pins it).
	if got, want := capabilities.KindVocabulary, []string{"Service", "Ingress", "Gateway", "HTTPRoute"}; !equalStringSlices(got, want) {
		t.Errorf("input capabilities mutated\n got: %v\nwant: %v", got, want)
	}
}

func TestCapabilitiesWithAvailableKindsKeepsKindsWithoutSources(t *testing.T) {
	capabilities := newTypedResourceCapabilities(
		[]string{"name"},
		[]string{"kinds"},
		[]string{"name"},
		[]string{"ConfigMap", "Secret"},
	)

	// Only ConfigMap has a source entry; Secret is unconditional and stays.
	filtered := capabilitiesWithAvailableKinds(capabilities, []typedTableResourceSource{
		{Kind: "ConfigMap", Available: true},
	})
	if got, want := filtered.KindVocabulary, []string{"ConfigMap", "Secret"}; !equalStringSlices(got, want) {
		t.Errorf("kind vocabulary mismatch\n got: %v\nwant: %v", got, want)
	}

	// No vocabulary → nothing to filter.
	empty := capabilitiesWithAvailableKinds(newTypedResourceCapabilities(nil, nil, nil, nil), nil)
	if len(empty.KindVocabulary) != 0 {
		t.Errorf("expected empty vocabulary, got %v", empty.KindVocabulary)
	}
}
