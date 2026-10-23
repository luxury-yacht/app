/*
 * backend/kind/kindspec/descriptor.go
 *
 * The single per-kind Descriptor: a kind's identity plus every typed behaviour the
 * app needs from it (stream summary, object-map node + edges, detail binding) and
 * the facet flags that tell each subsystem how to treat it (catalog source,
 * detail-cache eviction). One registry (kind/kindregistry) aggregates these;
 * every subsystem loops that registry and filters by facet, so no subsystem ever
 * names a kind itself.
 *
 * This package imports only leaves (resourcekind, streamspec, logspec,
 * objectmapnode, objectmapspec, appbinding + metav1) and NO kind packages, so a kind can declare
 * its Descriptor without an import cycle.
 */

package kindspec

import (
	"context"

	"github.com/luxury-yacht/app/backend/kind/logspec"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resources/appbinding"
	"github.com/luxury-yacht/app/backend/resources/common"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// WorkloadOperations are a workload kind's mutating actions, declared in the kind's
// package so the action handlers never switch on kind. A nil func means the kind
// does not support that action (e.g. DaemonSet is not scalable; ReplicaSet is not
// rollout-restartable). Each func makes the kind's own typed API call.
type WorkloadOperations struct {
	// Restart applies the rollout-restart patch to the workload's pod template.
	Restart func(ctx context.Context, client kubernetes.Interface, namespace, name string, patch []byte) error
	// Scale sets the workload's desired replica count via its scale subresource.
	Scale func(ctx context.Context, client kubernetes.Interface, namespace, name string, replicas int32) error
	// CurrentReplicas reads the workload's current desired replica count (1 when unset).
	CurrentReplicas func(ctx context.Context, client kubernetes.Interface, namespace, name string) (int32, error)
	// RevisionHistory returns the workload's rollout revision history, newest first.
	RevisionHistory func(ctx context.Context, client kubernetes.Interface, namespace, name string) ([]common.WorkloadRevision, error)
	// ApplyPodTemplate replaces the workload's pod template (used by rollback).
	ApplyPodTemplate func(ctx context.Context, client kubernetes.Interface, namespace, name string, template corev1.PodTemplateSpec) error
}

// scaleSpec builds the autoscaling/v1 Scale a kind's Scale op submits; shared so the
// per-kind ops stay one-liners.
func ScaleObject(namespace, name string, replicas int32) *autoscalingv1.Scale {
	return &autoscalingv1.Scale{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace},
		Spec:       autoscalingv1.ScaleSpec{Replicas: replicas},
	}
}

// ObjectMapGraph holds how a kind behaves in the object-map graph traversal — its
// graph ROLE, not its edges. The object-map walker reads these instead of
// hard-coding kind names: ScalableWorkload kinds carry HPA-managed action facts.
type ObjectMapGraph struct {
	ScalableWorkload bool
}

// ObjectActions declares non-workload mutation families whose handlers are
// implemented for a kind. Workload and port-forward capabilities are derived
// from their typed facets instead of repeated here.
type ObjectActions struct {
	Trigger bool
	Suspend bool
	Cordon  bool
	Drain   bool
	// NamespaceFinalizer offers removing a Namespace's spec finalizers.
	NamespaceFinalizer bool
}

// PanelPods selects how the object panel's Pods tab lists the object's pods.
type PanelPods int

const (
	// PanelPodsNone shows no Pods tab.
	PanelPodsNone PanelPods = iota
	// PanelPodsByOwner lists the pods the object owns (the pods domain's
	// workload selector).
	PanelPodsByOwner
	// PanelPodsByNode lists the pods scheduled on the node (the node selector).
	PanelPodsByNode
)

// PanelShell selects the object panel's Shell tab.
type PanelShell int

const (
	// PanelShellNone shows no Shell tab.
	PanelShellNone PanelShell = iota
	// PanelShellExec execs into one of the pod's containers.
	PanelShellExec
	// PanelShellNode opens a shell on the node through a debug pod.
	PanelShellNode
)

// ObjectPanel declares the object panel's kind-dependent tabs. The zero value is
// a kind with only the generic tabs.
type ObjectPanel struct {
	Pods PanelPods
	// Jobs shows a Jobs tab listing the Jobs the detail DTO carries.
	Jobs bool
	// NodeLogs shows a Logs tab of the node's journal and log files, served by
	// the node-log service. Container logs come from Descriptor.Logs instead.
	NodeLogs bool
	Shell    PanelShell
	// DebugContainer allows starting an ephemeral debug container.
	DebugContainer bool
	// HideEvents hides the Events tab (an Event has no events of its own).
	HideEvents bool
	// HideYAML hides the YAML tab.
	HideYAML bool
}

// Display is how the UI names a kind. Every registered kind declares a short name.
type Display struct {
	// ShortName is shown when "short resource names" is on.
	ShortName string
	// Label overrides the full name shown for the kind; empty means the Kind.
	Label string
	// SearchAliases are extra command-palette tokens for the kind (kubectl short
	// names that its short name, kind, and resource plural do not cover).
	SearchAliases []string
}

// MetricsSource names the refresh domain whose rows carry the object's live
// usage. The zero value means the panel shows no metrics for the kind.
type MetricsSource int

const (
	MetricsNone MetricsSource = iota
	// MetricsPods reads the pods domain.
	MetricsPods
	// MetricsWorkloads reads the namespace-workloads domain.
	MetricsWorkloads
	// MetricsNodes reads the nodes domain.
	MetricsNodes
)

// CatalogSource names how the object catalog lists a kind's objects that no
// owned reflector ingests.
type CatalogSource int

const (
	// CatalogDynamic collects the kind from its owned reflector's store. It is
	// the default.
	CatalogDynamic CatalogSource = iota
	// CatalogNone excludes a built-in kind from object-catalog collection. The
	// kind can still participate in other descriptor-driven subsystems.
	CatalogNone
)

// Descriptor is the one place a kind hands the rest of the app everything it needs.
// Facet fields are nil/zero when the kind does not participate in that subsystem
// (e.g. Stream is nil for a kind that is not directly streamed). The catalog,
// resource-stream, snapshot, object-map, detail-binding, and cache-invalidation
// subsystems each read only the facets they care about.
type Descriptor struct {
	// Identity is the kind's canonical group/version/kind/resource. It is the
	// single source of identity; subsystems key reflectors and stores off it.
	Identity resourcekind.Identity

	// CatalogSource tells the object catalog whether it collects the kind, or
	// excludes it with CatalogNone.
	CatalogSource CatalogSource

	// DetailCacheable marks kinds whose cached detail/YAML responses the gateway
	// keeps; the kind's reflector evicts them on change.
	DetailCacheable bool

	// DetailListsPods marks kinds whose cached details embed their pods, so a
	// pod change in the namespace evicts them.
	DetailListsPods bool

	// Stream is the directly-streamed-table descriptor; nil when the kind is not
	// streamed via the generic descriptor dispatch (it streams via a bespoke path
	// or not at all).
	Stream *streamspec.Descriptor

	// Collector projects this kind into an object-map node; nil when the kind
	// has no object-map node.
	Collector *objectmapnode.Collector

	// Edges builds this kind's object-map relationship edges; nil when the kind
	// contributes no edges.
	Edges func(clusterID string, obj metav1.Object) []objectmapspec.Edge

	// Binding is the typed detail-service / app-binding spec; nil when the kind's
	// detail is served by a bespoke path (e.g. Pod, CustomResourceDefinition, Helm).
	Binding *appbinding.Spec

	// Graph is the kind's role in the object-map graph traversal (zero value for
	// kinds with no special graph behaviour).
	Graph ObjectMapGraph

	// Workload is the kind's mutating workload actions (restart/scale); nil for
	// non-workload kinds.
	Workload *WorkloadOperations

	// Actions declares the remaining object-action families supported by this kind.
	Actions ObjectActions

	// PortForward describes this kind as a port-forward target (how to resolve it to
	// a backing pod, plus reconnect / service-port-spec behaviour); nil for kinds
	// that cannot be port-forwarded.
	PortForward *PortForwardTarget

	// Panel declares the object panel's kind-dependent tabs (generated into the
	// frontend kind facets table).
	Panel ObjectPanel

	// Metrics names the domain whose rows carry the object's live usage.
	Metrics MetricsSource

	// Display is how the UI names the kind.
	Display Display

	// Logs is the kind's container-log target (how to find its pods and keep
	// following them); nil for kinds whose containers cannot be read.
	Logs *logspec.Target

	// ListDomain is the refresh domain whose table lists the kind, for kinds without
	// a Stream descriptor (Stream.Domain names it for the rest). Empty means no view
	// lists the kind, so navigation falls back to Browse.
	ListDomain string
}

// PortForwardTarget is a kind's port-forward behaviour, declared in the kind's
// package so the port-forward handlers never switch on kind.
type PortForwardTarget struct {
	// Reconnect reports whether a dropped forward to this kind should auto-reconnect
	// (workloads/services churn pods; a bare Pod does not).
	Reconnect bool
	// UsesServicePortSpec reports whether the requested port is a Service port that
	// must be mapped to the backing pod's container port (true only for Service).
	UsesServicePortSpec bool
	// ResolvePod resolves the target to a ready backing pod name.
	ResolvePod func(ctx context.Context, client kubernetes.Interface, namespace, name string) (string, error)
}
