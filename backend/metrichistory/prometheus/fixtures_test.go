package prometheus

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/metrichistory"
)

// Phase 0 fixtures: verbatim kube-prometheus-stack responses (see testdata README).
const fixtureDir = "testdata/kube-prometheus-stack"

const (
	fixtureNamespace = "podinfo"
	fixturePod       = "podinfo-66888d8d86-5lpbr"
)

type manifestEntry struct {
	File  string `json:"file"`
	Query string `json:"query"`
	Range string `json:"range"`
}

func loadManifest(t *testing.T) map[string]manifestEntry {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(fixtureDir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var entries []manifestEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		t.Fatal(err)
	}
	byFile := make(map[string]manifestEntry, len(entries))
	for _, entry := range entries {
		byFile[strings.TrimSuffix(entry.File, ".json")] = entry
	}
	return byFile
}

func loadFixture(t *testing.T, name string) []byte {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(fixtureDir, name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	return body
}

// fixtureGrid rebuilds the grid a range fixture was captured with ("start=… end=… step=…").
func fixtureGrid(t *testing.T, entry manifestEntry) metrichistory.Grid {
	t.Helper()
	params := map[string]int64{}
	for _, field := range strings.Fields(entry.Range) {
		key, value, _ := strings.Cut(field, "=")
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			t.Fatalf("manifest range %q: %v", entry.Range, err)
		}
		params[key] = parsed
	}
	step := time.Duration(params["step"]) * time.Second
	return metrichistory.Grid{
		StartMs: params["start"] * 1000,
		StepMs:  step.Milliseconds(),
		Count:   int((params["end"]-params["start"])/params["step"]) + 1,
	}
}
