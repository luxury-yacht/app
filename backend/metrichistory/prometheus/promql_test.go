package prometheus

import (
	"strings"
	"testing"
	"time"
)

func TestPodQueriesAreTheQueriesVerifiedInPhaseZero(t *testing.T) {
	manifest := loadManifest(t)
	queries := PodQueries(fixtureNamespace, fixturePod, nil, 2*time.Minute)
	want := map[QueryID]string{
		QueryPodCPUUsage:    manifest["pod_cpu_by_container"].Query,
		QueryPodMemoryUsage: manifest["pod_memory_by_container"].Query,
		QueryPodRequests:    manifest["pod_requests"].Query,
		QueryPodLimits:      manifest["pod_limits"].Query,
	}
	if len(queries) != len(want) {
		t.Fatalf("got %d queries, want %d", len(queries), len(want))
	}
	for _, query := range queries {
		if query.PromQL != want[query.ID] {
			t.Errorf("%s:\n got  %s\n want %s", query.ID, query.PromQL, want[query.ID])
		}
	}
}

func TestPodQueriesEscapeObjectNamesSoTheyCannotAlterTheQuery(t *testing.T) {
	queries := PodQueries(`ns"},up{x="`, "a\\b\nc", nil, 2*time.Minute)
	for _, query := range queries {
		if !strings.Contains(query.PromQL, `namespace="ns\"},up{x=\""`) {
			t.Errorf("%s: namespace not escaped: %s", query.ID, query.PromQL)
		}
		if !strings.Contains(query.PromQL, `pod="a\\b\nc"`) {
			t.Errorf("%s: pod not escaped: %s", query.ID, query.PromQL)
		}
	}
}

func TestPodQueriesApplyClusterLabelFilters(t *testing.T) {
	filter, err := NewMatcher("cluster", `prod-"east"`)
	if err != nil {
		t.Fatal(err)
	}
	for _, query := range PodQueries(fixtureNamespace, fixturePod, []Matcher{filter}, 2*time.Minute) {
		if !strings.Contains(query.PromQL, `pod="podinfo-66888d8d86-5lpbr",cluster="prod-\"east\""`) {
			t.Errorf("%s: filter missing from selector: %s", query.ID, query.PromQL)
		}
	}
}

func TestNewMatcherRejectsLabelNamesPromQLWouldMisparse(t *testing.T) {
	for _, name := range []string{"cluster", "_k8s_cluster", "k8s_cluster2"} {
		if _, err := NewMatcher(name, "x"); err != nil {
			t.Errorf("NewMatcher(%q) rejected a valid name: %v", name, err)
		}
	}
	for _, name := range []string{"", "1cluster", "k8s-cluster", `cluster="x"}`, "cluster name"} {
		if _, err := NewMatcher(name, "x"); err == nil {
			t.Errorf("NewMatcher(%q) accepted an invalid name", name)
		}
	}
}

func TestRateWindowsUsePrometheusDurationSyntax(t *testing.T) {
	for window, want := range map[time.Duration]string{
		2 * time.Minute:   "[2m]",
		330 * time.Second: "[330s]",
	} {
		query := PodQueries(fixtureNamespace, fixturePod, nil, window)[0].PromQL
		if !strings.Contains(query, want) {
			t.Errorf("window %s: %s lacks %s", window, query, want)
		}
	}
}
