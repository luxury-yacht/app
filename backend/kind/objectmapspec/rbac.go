package objectmapspec

import "github.com/luxury-yacht/app/backend/resourcemodel"

// RBACBindingEdges is the shared RoleBinding/ClusterRoleBinding edge projection.
func RBACBindingEdges(role resourcemodel.ResourceLink, subjects []resourcemodel.SubjectFacts) []Edge {
	edges := []Edge{{Type: EdgeGrants, Link: role}}
	for _, subject := range subjects {
		if subject.Link != nil {
			edges = append(edges, Edge{Type: EdgeBinds, Link: *subject.Link})
		}
	}
	return edges
}
