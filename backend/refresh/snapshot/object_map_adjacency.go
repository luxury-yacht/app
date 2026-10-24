package snapshot

import "sort"

// objectMapAdjacency indexes a build's edges by endpoint for traversal. Each
// node's entries are sorted the first time traversal reads them, in the order
// a sort of every edge would give, so visits stay deterministic without
// sorting every edge in the cluster on every build.
type objectMapAdjacency struct {
	edges  []ObjectMapEdge
	byNode map[string][]objectMapTraversalEdge
	sorted map[string]bool
}

// objectMapTraversalEdge is one edge seen from a node: forward when the node
// is the edge's source, reverse when it is the target.
type objectMapTraversalEdge struct {
	edge    int
	reverse bool
}

// newObjectMapAdjacency indexes the edges that usable accepts (all of them
// when usable is nil).
func newObjectMapAdjacency(edges []ObjectMapEdge, usable func(ObjectMapEdge) bool) *objectMapAdjacency {
	adjacency := &objectMapAdjacency{
		edges:  make([]ObjectMapEdge, 0, len(edges)),
		byNode: make(map[string][]objectMapTraversalEdge),
		sorted: make(map[string]bool),
	}
	for _, edge := range edges {
		if usable != nil && !usable(edge) {
			continue
		}
		index := len(adjacency.edges)
		adjacency.edges = append(adjacency.edges, edge)
		adjacency.byNode[edge.Source] = append(adjacency.byNode[edge.Source], objectMapTraversalEdge{edge: index})
		adjacency.byNode[edge.Target] = append(adjacency.byNode[edge.Target], objectMapTraversalEdge{edge: index, reverse: true})
	}
	return adjacency
}

// neighbors returns a node's edge entries in deterministic order.
func (a *objectMapAdjacency) neighbors(id string) []objectMapTraversalEdge {
	entries := a.byNode[id]
	if !a.sorted[id] {
		sort.Slice(entries, func(i, j int) bool {
			return lessObjectMapEdge(a.edges[entries[i].edge], a.edges[entries[j].edge])
		})
		a.sorted[id] = true
	}
	return entries
}

func (a *objectMapAdjacency) edge(entry objectMapTraversalEdge) ObjectMapEdge {
	return a.edges[entry.edge]
}

// edgesBetween returns the edges whose endpoints are both in nodes.
func (a *objectMapAdjacency) edgesBetween(nodes map[string]ObjectMapNode) map[string]ObjectMapEdge {
	result := make(map[string]ObjectMapEdge)
	for id := range nodes {
		for _, entry := range a.byNode[id] {
			if entry.reverse {
				continue
			}
			edge := a.edges[entry.edge]
			if _, included := nodes[edge.Target]; included {
				result[edge.ID] = edge
			}
		}
	}
	return result
}

func lessObjectMapEdge(a, b ObjectMapEdge) bool {
	if a.Type != b.Type {
		return a.Type < b.Type
	}
	if a.Source != b.Source {
		return a.Source < b.Source
	}
	if a.Target != b.Target {
		return a.Target < b.Target
	}
	return a.ID < b.ID
}
