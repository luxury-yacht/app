package metrichistory

// GraphSpec is one entry of the fixed graph catalog: which graph, in which unit.
type GraphSpec struct {
	ID   GraphID
	Unit Unit
}

// podGraphs is the Pod graph set in display order. Providers map these IDs to their queries.
var podGraphs = []GraphSpec{
	{ID: GraphCPU, Unit: UnitMillicores},
	{ID: GraphMemory, Unit: UnitBytes},
}

// PodGraphSpecs returns the Pod graph catalog in display order.
func PodGraphSpecs() []GraphSpec {
	return append([]GraphSpec(nil), podGraphs...)
}

// LiveGraphs returns the catalog's graphs without source data, for live-mode responses.
func LiveGraphs(specs []GraphSpec) []Graph {
	graphs := make([]Graph, 0, len(specs))
	for _, spec := range specs {
		graphs = append(graphs, Graph{ID: spec.ID, Unit: spec.Unit, Status: GraphStatusLive})
	}
	return graphs
}
