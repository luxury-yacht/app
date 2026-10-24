package cronjob

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register cronjob's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place cronjob hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	ListDomain:      "namespace-workloads",
	Display:         kindspec.Display{ShortName: "cron", SearchAliases: []string{"cj"}},
	DetailCacheable: true,
	DetailListsPods: true,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
	Actions:         kindspec.ObjectActions{Trigger: true, Suspend: true},
	// Its pods are listed per Job in the Jobs tab, not in a Pods tab.
	Panel: kindspec.ObjectPanel{Jobs: true},
	Logs:  &LogsTarget,
}
