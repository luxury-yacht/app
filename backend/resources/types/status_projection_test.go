/*
 * backend/resources/types/status_projection_test.go
 *
 * Tests for the shared StatusProjection DTO base.
 */

package types

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestNewStatusProjection(t *testing.T) {
	got := NewStatusProjection(resourcemodel.ResourceStatusPresentation{
		Label:        "Running",
		State:        "2/2",
		Presentation: "ready",
		Reason:       "AllReady",
	})
	want := StatusProjection{
		Status:             "Running",
		StatusState:        "2/2",
		StatusPresentation: "ready",
		StatusReason:       "AllReady",
	}
	if got != want {
		t.Fatalf("NewStatusProjection = %+v, want %+v", got, want)
	}
}
