package pods

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register pods's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place pods hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	ListDomain:      "pods",
	Display:         kindspec.Display{ShortName: "pod", SearchAliases: []string{"po"}},
	DetailCacheable: true,
	// A bespoke pod reflector (snapshot.NewPodIngestProjector, wired via
	// IngestManager.RegisterReflector) projects each Pod at intake into a four-half
	// Bundle that every pod consumer reads (the catalog, the object map, the
	// response-cache invalidator, the pods maintained store). Pods has no Stream
	// descriptor, so the generic ingest loop does not build it; the system wires the
	// bespoke reflector explicitly.
	Collector:   &ObjectMapNode,
	Edges:       ObjectMapEdges,
	PortForward: &kindspec.PortForwardTarget{ResolvePod: ForwardPodName},
	Panel:       kindspec.ObjectPanel{Shell: kindspec.PanelShellExec, DebugContainer: true},
	Logs:        &LogsTarget,
	Metrics:     kindspec.MetricsPods,
}
