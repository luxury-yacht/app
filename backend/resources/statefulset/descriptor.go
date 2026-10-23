package statefulset

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register statefulset's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place statefulset hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	ListDomain:      "namespace-workloads",
	Display:         kindspec.Display{ShortName: "sts"},
	DetailListsPods: true,
	DetailCacheable: true,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
	Graph:           kindspec.ObjectMapGraph{ScalableWorkload: true},
	Workload:        &kindspec.WorkloadOperations{Restart: workloadRestart, Scale: workloadScale, CurrentReplicas: workloadCurrentReplicas, RevisionHistory: revisionHistory, ApplyPodTemplate: applyPodTemplate},
	PortForward:     &kindspec.PortForwardTarget{ResolvePod: ForwardPodName, Reconnect: true},
	Panel:           kindspec.ObjectPanel{Pods: kindspec.PanelPodsByOwner},
	Logs:            &LogsTarget,
	Metrics:         kindspec.MetricsWorkloads,
}
