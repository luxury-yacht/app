package versioning

import "testing"

type samplePayload struct {
	Name  string
	Count int
}

func TestCheckAndUpdate_NewAndRepeat(t *testing.T) {
	t.Parallel()

	cache := NewCache()
	key := "pods:ns:demo"
	payload := samplePayload{Name: "demo", Count: 3}

	version, unchanged, err := cache.CheckAndUpdate(key, payload, "")
	if err != nil {
		t.Fatalf("CheckAndUpdate returned error: %v", err)
	}
	if unchanged {
		t.Fatalf("expected first insert to report changed state")
	}
	if version == "" {
		t.Fatalf("expected version to be populated")
	}

	// Client sends matching version, expect short-circuit.
	version2, unchanged2, err := cache.CheckAndUpdate(key, payload, version)
	if err != nil {
		t.Fatalf("CheckAndUpdate returned error on repeat: %v", err)
	}
	if !unchanged2 {
		t.Fatalf("expected unchanged=true when client version matches")
	}
	if version2 != version {
		t.Fatalf("expected version to remain the same, got %q want %q", version2, version)
	}
}

func TestCheckAndUpdate_UpdateOnChange(t *testing.T) {
	t.Parallel()

	cache := NewCache()
	key := "pods:ns:demo"

	version1, unchanged1, err := cache.CheckAndUpdate(key, samplePayload{Name: "demo", Count: 1}, "")
	if err != nil {
		t.Fatalf("CheckAndUpdate returned error: %v", err)
	}
	if unchanged1 {
		t.Fatalf("expected first insert to report changed state")
	}

	version2, unchanged2, err := cache.CheckAndUpdate(key, samplePayload{Name: "demo", Count: 2}, version1)
	if err != nil {
		t.Fatalf("CheckAndUpdate returned error on update: %v", err)
	}
	if unchanged2 {
		t.Fatalf("expected changed payload to report unchanged=false")
	}
	if version2 == version1 {
		t.Fatalf("expected different payload to yield a new version")
	}
}

func TestCheckAndUpdate_MarshalError(t *testing.T) {
	t.Parallel()

	cache := NewCache()
	key := "pods:ns:demo"

	_, _, err := cache.CheckAndUpdate(key, struct{ Ch chan int }{Ch: make(chan int)}, "")
	if err == nil {
		t.Fatalf("expected error when payload cannot be marshalled")
	}
}
