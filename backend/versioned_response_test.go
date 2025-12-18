package backend

import (
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/versioning"
)

func TestCreateVersionedEndpointHappyPath(t *testing.T) {
	app := NewApp()
	app.versionCache = versioning.NewCache()

	callCount := 0
	fetch := func() (interface{}, error) {
		callCount++
		return map[string]string{"foo": "bar"}, nil
	}

	resp, err := app.CreateVersionedEndpoint("pods", "default", fetch, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.NotModified {
		t.Fatalf("expected data payload, got notModified")
	}
	if resp.Data == nil || resp.Version == "" {
		t.Fatalf("expected data and version to be set: %+v", resp)
	}
	if callCount != 1 {
		t.Fatalf("expected fetch to be called once, got %d", callCount)
	}

	// Second call with same payload and clientVersion should short-circuit.
	resp2, err := app.CreateVersionedEndpoint("pods", "default", fetch, resp.Version)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp2.NotModified {
		t.Fatalf("expected notModified when versions match")
	}
	if resp2.Data != nil {
		t.Fatalf("expected no data on notModified response")
	}
	if resp2.Version == "" {
		t.Fatalf("expected version on notModified response")
	}
}

func TestCreateVersionedEndpointHandlesErrors(t *testing.T) {
	app := NewApp()
	app.versionCache = versioning.NewCache()

	boom := errors.New("boom")
	_, err := app.CreateVersionedEndpoint("nodes", "", func() (interface{}, error) {
		return nil, boom
	}, "")
	if !errors.Is(err, boom) {
		t.Fatalf("expected boom error, got %v", err)
	}
}
