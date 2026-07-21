package genobjectactions

import (
	"strings"
	"testing"
)

func TestRenderIncludesBackendActionAndKindCapabilities(t *testing.T) {
	generated, err := Render()
	if err != nil {
		t.Fatalf("render object actions: %v", err)
	}
	contract := string(generated)

	for _, expected := range []string{
		"export const OBJECT_ACTION_IDS",
		`"backendAction":"restart"`,
		`"kind":"Deployment"`,
		`"restart":true`,
		`"kind":"Pod"`,
		`"portForward":true`,
		`"kind":"CronJob"`,
		`"trigger":true`,
		`"kind":"Node"`,
		`"drain":true`,
	} {
		if !strings.Contains(contract, expected) {
			t.Errorf("generated contract missing %q", expected)
		}
	}
}
