/*
 * backend/resources/types/conditions_test.go
 *
 * Tests for the shared FormatConditions projection.
 */

package types

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestFormatConditions(t *testing.T) {
	got := FormatConditions([]resourcemodel.ConditionFacts{
		{Type: "Available", Status: "True"},
		{Type: "Progressing", Status: "False", Reason: "Timeout", Message: "deadline exceeded"},
	})
	want := []string{"Available: True", "Progressing: False (Timeout) - deadline exceeded"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("FormatConditions = %#v, want %#v", got, want)
	}
}
