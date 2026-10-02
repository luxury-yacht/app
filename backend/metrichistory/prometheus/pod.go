package prometheus

import "github.com/luxury-yacht/app/backend/metrichistory"

// Prometheus reports CPU in cores; the app's metric contract carries millicores.
const millicoresPerCore = 1000

// podGraphQuery is how this provider fills one catalog graph.
type podGraphQuery struct {
	scale    float64
	usage    QueryID
	resource string // kube-state-metrics "resource" label of this graph's requests and limits
}

var podGraphQueries = map[metrichistory.GraphID]podGraphQuery{
	metrichistory.GraphCPU:    {scale: millicoresPerCore, usage: QueryPodCPUUsage, resource: "cpu"},
	metrichistory.GraphMemory: {scale: 1, usage: QueryPodMemoryUsage, resource: "memory"},
}

var reservationRoles = []struct {
	query QueryID
	role  metrichistory.SeriesRole
}{
	{query: QueryPodRequests, role: metrichistory.RoleRequest},
	{query: QueryPodLimits, role: metrichistory.RoleLimit},
}

// PodGraphs folds the results of PodQueries into the Pod catalog's graphs, in catalog order.
// Usage is the sum of the pod's containers; requests and limits appear only when the pod sets them.
func PodGraphs(grid metrichistory.Grid, results map[QueryID][]Stream) []metrichistory.Graph {
	specs := metrichistory.PodGraphSpecs()
	graphs := make([]metrichistory.Graph, 0, len(specs))
	for _, spec := range specs {
		graphs = append(graphs, podGraph(spec, podGraphQueries[spec.ID], grid, results))
	}
	return graphs
}

func podGraph(spec metrichistory.GraphSpec, query podGraphQuery, grid metrichistory.Grid, results map[QueryID][]Stream) metrichistory.Graph {
	usage := sumStreams(results[query.usage], grid.Count, query.scale)
	status := metrichistory.GraphStatusNoData
	if hasSample(usage) {
		status = metrichistory.GraphStatusOK
	}
	series := []metrichistory.Series{{ID: string(metrichistory.RoleUsage), Role: metrichistory.RoleUsage, Values: usage}}
	for _, reservation := range reservationRoles {
		if values, ok := resourceValues(results[reservation.query], query.resource, query.scale); ok {
			series = append(series, metrichistory.Series{ID: string(reservation.role), Role: reservation.role, Values: values})
		}
	}
	return metrichistory.Graph{ID: spec.ID, Unit: spec.Unit, Status: status, Series: series}
}

// sumStreams adds the streams step by step. A step where no stream has a sample stays a gap.
func sumStreams(streams []Stream, count int, scale float64) []*float64 {
	totals := make([]*float64, count)
	for _, stream := range streams {
		for index, value := range stream.Values {
			if value == nil || index >= count {
				continue
			}
			if totals[index] == nil {
				totals[index] = new(float64)
			}
			*totals[index] += *value * scale
		}
	}
	return totals
}

func resourceValues(streams []Stream, resource string, scale float64) ([]*float64, bool) {
	for _, stream := range streams {
		if stream.Labels["resource"] == resource {
			return sumStreams([]Stream{stream}, len(stream.Values), scale), true
		}
	}
	return nil, false
}

func hasSample(values []*float64) bool {
	for _, value := range values {
		if value != nil {
			return true
		}
	}
	return false
}
