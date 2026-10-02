package prometheus

import (
	"math"
	"testing"

	"github.com/luxury-yacht/app/backend/metrichistory"
)

func decodeFixture(t *testing.T, name string) ([]Stream, metrichistory.Grid) {
	t.Helper()
	grid := fixtureGrid(t, loadManifest(t)[name])
	streams, err := DecodeMatrix(loadFixture(t, name), grid)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return streams, grid
}

func podFixtureResults(t *testing.T) (map[QueryID][]Stream, metrichistory.Grid) {
	t.Helper()
	results := map[QueryID][]Stream{}
	var grid metrichistory.Grid
	for id, name := range map[QueryID]string{
		QueryPodCPUUsage:    "pod_cpu_by_container",
		QueryPodMemoryUsage: "pod_memory_by_container",
		QueryPodRequests:    "pod_requests",
		QueryPodLimits:      "pod_limits",
	} {
		results[id], grid = decodeFixture(t, name)
	}
	return results, grid
}

func graphByID(t *testing.T, graphs []metrichistory.Graph, id metrichistory.GraphID) metrichistory.Graph {
	t.Helper()
	for _, graph := range graphs {
		if graph.ID == id {
			return graph
		}
	}
	t.Fatalf("graph %s missing from %+v", id, graphs)
	return metrichistory.Graph{}
}

func seriesByRole(graph metrichistory.Graph, role metrichistory.SeriesRole) *metrichistory.Series {
	for index := range graph.Series {
		if graph.Series[index].Role == role {
			return &graph.Series[index]
		}
	}
	return nil
}

func TestPodGraphsConvertVerifiedFixturesToAppUnits(t *testing.T) {
	results, grid := podFixtureResults(t)
	graphs := PodGraphs(grid, results)

	cpu := graphByID(t, graphs, metrichistory.GraphCPU)
	if cpu.Unit != metrichistory.UnitMillicores || cpu.Status != metrichistory.GraphStatusOK {
		t.Fatalf("cpu unit/status = %s/%s", cpu.Unit, cpu.Status)
	}
	usage := seriesByRole(cpu, metrichistory.RoleUsage)
	if usage == nil || usage.Values[0] != nil {
		t.Fatalf("cpu usage = %+v, want a leading gap", usage)
	}
	// Prometheus reports cores; the app's metric contract carries millicores.
	if got := *usage.Values[grid.Count-1]; math.Abs(got-2.5297544221962814) > 1e-9 {
		t.Errorf("latest cpu usage = %v millicores, want 2.5297544221962814", got)
	}
	assertConstant(t, "cpu request", seriesByRole(cpu, metrichistory.RoleRequest), 100)
	assertConstant(t, "cpu limit", seriesByRole(cpu, metrichistory.RoleLimit), 500)

	memory := graphByID(t, graphs, metrichistory.GraphMemory)
	if memory.Unit != metrichistory.UnitBytes || memory.Status != metrichistory.GraphStatusOK {
		t.Fatalf("memory unit/status = %s/%s", memory.Unit, memory.Status)
	}
	if got := *seriesByRole(memory, metrichistory.RoleUsage).Values[grid.Count-1]; got != 19800064 {
		t.Errorf("latest memory usage = %v bytes", got)
	}
	assertConstant(t, "memory request", seriesByRole(memory, metrichistory.RoleRequest), 268435456)
	assertConstant(t, "memory limit", seriesByRole(memory, metrichistory.RoleLimit), 536870912)
}

func assertConstant(t *testing.T, name string, series *metrichistory.Series, want float64) {
	t.Helper()
	if series == nil {
		t.Fatalf("%s series missing", name)
	}
	for index, value := range series.Values {
		if value != nil && *value != want {
			t.Fatalf("%s[%d] = %v, want %v", name, index, *value, want)
		}
	}
}

func TestPodGraphsSumContainersPerStepWithoutInventingZeros(t *testing.T) {
	grid := metrichistory.Grid{StartMs: 0, StepMs: 30_000, Count: 3}
	results := map[QueryID][]Stream{
		QueryPodCPUUsage: {
			{Labels: map[string]string{"container": "app"}, Values: []*float64{ptr(0.2), ptr(0.3), nil}},
			{Labels: map[string]string{"container": "sidecar"}, Values: []*float64{ptr(0.05), nil, nil}},
		},
	}
	usage := seriesByRole(graphByID(t, PodGraphs(grid, results), metrichistory.GraphCPU), metrichistory.RoleUsage)
	want := []*float64{ptr(250), ptr(300), nil}
	for index := range want {
		switch {
		case want[index] == nil && usage.Values[index] != nil:
			t.Errorf("step %d = %v, want a gap", index, *usage.Values[index])
		case want[index] != nil && (usage.Values[index] == nil || *usage.Values[index] != *want[index]):
			t.Errorf("step %d = %v, want %v", index, usage.Values[index], *want[index])
		}
	}
}

func TestPodGraphsOmitReservationsThePodDoesNotSet(t *testing.T) {
	results, grid := podFixtureResults(t)
	// Only a CPU request is set: no memory request line may appear, not even at zero.
	results[QueryPodRequests] = filterStreams(results[QueryPodRequests], "resource", "cpu")
	memory := graphByID(t, PodGraphs(grid, results), metrichistory.GraphMemory)
	if seriesByRole(memory, metrichistory.RoleRequest) != nil {
		t.Error("memory request series present although the pod sets none")
	}
}

func TestPodGraphsReportNoDataWhenThePodHasNoUsageSamples(t *testing.T) {
	results, grid := podFixtureResults(t)
	results[QueryPodCPUUsage] = nil
	results[QueryPodMemoryUsage] = nil
	for _, graph := range PodGraphs(grid, results) {
		if graph.Status != metrichistory.GraphStatusNoData {
			t.Errorf("%s status = %s, want noData", graph.ID, graph.Status)
		}
	}
}

func filterStreams(streams []Stream, label, value string) []Stream {
	var kept []Stream
	for _, stream := range streams {
		if stream.Labels[label] == value {
			kept = append(kept, stream)
		}
	}
	return kept
}

func ptr(value float64) *float64 { return &value }
