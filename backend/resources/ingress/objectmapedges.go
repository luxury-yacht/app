package ingress

import (
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this Ingress's edges: a "uses" edge to its IngressClass
// and a "routes" edge to each backend Service it references.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	ing, ok := obj.(*networkingv1.Ingress)
	if !ok {
		return nil
	}
	var edges []objectmapspec.Edge
	if className, tracedBy := ingressClassName(ing); className != "" {
		edges = append(edges, objectmapspec.Edge{Type: objectmapspec.EdgeUses, Label: "uses class", TracedBy: tracedBy, IngressClass: className})
	}
	for _, name := range ingressBackendServices(ing) {
		edges = append(edges, objectmapspec.Edge{Type: objectmapspec.EdgeRoutes, TracedBy: "spec.backend.service", CoreRef: &objectmapspec.CoreRef{Version: "v1", Kind: "Service", Namespace: ing.Namespace, Name: name}})
	}
	return edges
}

// ingressClassName returns the ingress class and the field that traced it, from
// spec.ingressClassName or the legacy annotation.
func ingressClassName(ing *networkingv1.Ingress) (string, string) {
	if ing == nil {
		return "", ""
	}
	if ing.Spec.IngressClassName != nil && strings.TrimSpace(*ing.Spec.IngressClassName) != "" {
		return strings.TrimSpace(*ing.Spec.IngressClassName), "spec.ingressClassName"
	}
	if ing.Annotations != nil && strings.TrimSpace(ing.Annotations["kubernetes.io/ingress.class"]) != "" {
		return strings.TrimSpace(ing.Annotations["kubernetes.io/ingress.class"]), "metadata.annotations[kubernetes.io/ingress.class]"
	}
	return "", ""
}

// ingressBackendServices returns the sorted, de-duplicated set of backend service
// names this ingress references (default backend plus per-path backends).
func ingressBackendServices(ing *networkingv1.Ingress) []string {
	if ing == nil {
		return nil
	}
	seen := map[string]struct{}{}
	add := func(name string) {
		if name == "" {
			return
		}
		seen[name] = struct{}{}
	}
	if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
		add(ing.Spec.DefaultBackend.Service.Name)
	}
	for _, rule := range ing.Spec.Rules {
		if rule.HTTP == nil {
			continue
		}
		for _, path := range rule.HTTP.Paths {
			if path.Backend.Service != nil {
				add(path.Backend.Service.Name)
			}
		}
	}
	result := make([]string, 0, len(seen))
	for name := range seen {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}
