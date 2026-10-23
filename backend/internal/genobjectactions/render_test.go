package genobjectactions

import (
	"strings"
	"testing"
)

// Per-kind action eligibility is generated into the kind facets table
// (genkindfacets); this catalog carries only the action vocabulary.
func TestRenderIncludesBackendActionVocabulary(t *testing.T) {
	generated, err := Render()
	if err != nil {
		t.Fatalf("render object actions: %v", err)
	}
	contract := string(generated)

	for _, expected := range []string{
		"export const OBJECT_ACTION_IDS",
		`"backendAction":"restart"`,
		`"backendAction":"startDrain"`,
		"export const NODE_ACTION_PERMISSIONS",
	} {
		if !strings.Contains(contract, expected) {
			t.Errorf("generated contract missing %q", expected)
		}
	}
	for _, unexpected := range []string{"kindCapabilities", "OBJECT_ACTION_KIND_CAPABILITIES"} {
		if strings.Contains(contract, unexpected) {
			t.Errorf("generated contract still carries per-kind data %q", unexpected)
		}
	}
}
