package backend

import (
	"os"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/gengatewaybindings"
)

// TestGatewayBindingsGeneratedInSync fails if resources_gatewayapi_generated.go
// drifts from what the generator produces — i.e. it was hand-edited, or a gateway
// kind was added to the contract without running `go generate ./backend`.
func TestGatewayBindingsGeneratedInSync(t *testing.T) {
	want, err := gengatewaybindings.Render()
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	got, err := os.ReadFile("resources_gatewayapi_generated.go")
	if err != nil {
		t.Fatalf("read generated file: %v", err)
	}
	if string(got) != string(want) {
		t.Fatal("resources_gatewayapi_generated.go is stale; run `go generate ./backend`")
	}
}
