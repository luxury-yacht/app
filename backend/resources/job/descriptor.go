package job

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register job's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place job hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	ListDomain:      "namespace-workloads",
	Display:         kindspec.Display{ShortName: "job"},
	DetailCacheable: true,
	DetailListsPods: true,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
	Panel:           kindspec.ObjectPanel{Pods: kindspec.PanelPodsByOwner},
	Logs:            &LogsTarget,
}
