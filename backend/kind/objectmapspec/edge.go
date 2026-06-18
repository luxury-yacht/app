// Package objectmapspec is the leaf that lets each kind declare its object-map
// relationship edges without importing the snapshot package. A kind's
// ObjectMapEdges returns Edges; the snapshot edge resolver looks up each Edge's
// relationship metadata and resolves its target descriptor to graph node(s). This
// keeps a kind's relationship logic in the kind's own package.
package objectmapspec

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Edge type identifiers. These are the single source for both the kind edge
// declarations and the snapshot relationship table keys.
const (
	EdgeOwner         = "owner"
	EdgeSelector      = "selector"
	EdgeEndpoint      = "endpoint"
	EdgeRoutes        = "routes"
	EdgeScales        = "scales"
	EdgeGrants        = "grants"
	EdgeBinds         = "binds"
	EdgeAggregates    = "aggregates"
	EdgeUses          = "uses"
	EdgeMounts        = "mounts"
	EdgeSchedules     = "schedules"
	EdgeVolumeBinding = "volume-binding"
	EdgeStorageClass  = "storage-class"
)

// CoreRef identifies a graph node by GVK + namespace + name (the snapshot resolver
// looks it up by identity). Group is empty for core-group targets (Pod, Service,
// ConfigMap, …) and set for others a kind references by name (e.g. a PVC's
// StorageClass, an Ingress's IngressClass). Namespace is empty for cluster-scoped
// targets (e.g. a PersistentVolume or StorageClass).
type CoreRef struct {
	Group     string
	Version   string
	Kind      string
	Namespace string
	Name      string
}

// Edge is one relationship from a kind's object to a target. Exactly one target
// descriptor is set; the snapshot resolver picks the matching branch and falls
// back to Link when none of the richer descriptors is set. Label and TracedBy are
// optional overrides; when empty the resolver uses the edge type's defaults.
type Edge struct {
	Type     string
	Label    string
	TracedBy string

	Link                resourcemodel.ResourceLink // default target
	CoreRef             *CoreRef                   // resolved by identity
	PodsSelector        map[string]string          // pods matching this selector in the source namespace
	PodsLabelSelector   *metav1.LabelSelector      // pods matching this label selector in the source namespace
	ServiceSlices       bool                       // endpoint slices for this service (source namespace + name)
	CoreObjectRef       *corev1.ObjectReference    // a core object reference (endpoints.targetRef)
	ClusterRoleSelector *metav1.LabelSelector      // cluster roles matching this selector
}

// RouteEdges is the shared Gateway-API route projection (HTTPRoute/GRPCRoute/
// TLSRoute): a "uses" edge to each parent and a "routes" edge to each backend.
func RouteEdges(facts resourcemodel.RouteCommonFacts) []Edge {
	edges := make([]Edge, 0, len(facts.ParentRefs)+len(facts.Backends))
	for _, parent := range facts.ParentRefs {
		edges = append(edges, Edge{Type: EdgeUses, TracedBy: "spec.parentRefs", Link: parent})
	}
	for _, backend := range facts.Backends {
		edges = append(edges, Edge{Type: EdgeRoutes, TracedBy: "spec.rules.backendRefs", Link: backend})
	}
	return edges
}

// PodEdges is the shared pod relationship projection: the node the pod is
// scheduled on, its service account, and the config/secret/PVC objects its volumes
// and containers reference. Shared by the Pod kind (here) and every workload's pod
// template (via PodTemplateEdges).
func PodEdges(pod *corev1.Pod) []Edge {
	edges := []Edge{}
	if pod.Spec.NodeName != "" {
		edges = append(edges, Edge{Type: EdgeSchedules, CoreRef: &CoreRef{Version: "v1", Kind: "Node", Name: pod.Spec.NodeName}})
	}
	serviceAccount := pod.Spec.ServiceAccountName
	if serviceAccount == "" {
		serviceAccount = "default"
	}
	edges = append(edges, Edge{Type: EdgeUses, TracedBy: "spec.serviceAccountName", CoreRef: &CoreRef{Version: "v1", Kind: "ServiceAccount", Namespace: pod.Namespace, Name: serviceAccount}})
	return append(edges, podSpecEdges(pod.Namespace, pod.Spec)...)
}

// PodTemplateEdges is the pod relationship projection for a workload's pod
// template: its service account (when set) and the objects its volumes and
// containers reference. A template never schedules onto a node.
func PodTemplateEdges(namespace string, tpl *corev1.PodTemplateSpec) []Edge {
	if tpl == nil {
		return nil
	}
	var edges []Edge
	if sa := tpl.Spec.ServiceAccountName; sa != "" {
		edges = append(edges, Edge{Type: EdgeUses, TracedBy: "template.spec.serviceAccountName", CoreRef: &CoreRef{Version: "v1", Kind: "ServiceAccount", Namespace: namespace, Name: sa}})
	}
	return append(edges, podSpecEdges(namespace, tpl.Spec)...)
}

func podSpecEdges(namespace string, spec corev1.PodSpec) []Edge {
	var edges []Edge
	for _, volume := range spec.Volumes {
		edges = append(edges, volumeEdges(namespace, volume)...)
	}
	for _, container := range spec.InitContainers {
		edges = append(edges, containerEdges(namespace, container)...)
	}
	for _, container := range spec.Containers {
		edges = append(edges, containerEdges(namespace, container)...)
	}
	return edges
}

func volumeEdges(namespace string, volume corev1.Volume) []Edge {
	var edges []Edge
	if volume.ConfigMap != nil && volume.ConfigMap.Name != "" {
		edges = append(edges, Edge{Type: EdgeUses, TracedBy: "volume.configMap", CoreRef: &CoreRef{Version: "v1", Kind: "ConfigMap", Namespace: namespace, Name: volume.ConfigMap.Name}})
	}
	if volume.Secret != nil && volume.Secret.SecretName != "" {
		edges = append(edges, Edge{Type: EdgeUses, TracedBy: "volume.secret", CoreRef: &CoreRef{Version: "v1", Kind: "Secret", Namespace: namespace, Name: volume.Secret.SecretName}})
	}
	if volume.PersistentVolumeClaim != nil && volume.PersistentVolumeClaim.ClaimName != "" {
		edges = append(edges, Edge{Type: EdgeMounts, TracedBy: "volume.persistentVolumeClaim", CoreRef: &CoreRef{Version: "v1", Kind: "PersistentVolumeClaim", Namespace: namespace, Name: volume.PersistentVolumeClaim.ClaimName}})
	}
	return edges
}

func containerEdges(namespace string, container corev1.Container) []Edge {
	var edges []Edge
	for _, envFrom := range container.EnvFrom {
		if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name != "" {
			edges = append(edges, Edge{Type: EdgeUses, TracedBy: "envFrom.configMapRef", CoreRef: &CoreRef{Version: "v1", Kind: "ConfigMap", Namespace: namespace, Name: envFrom.ConfigMapRef.Name}})
		}
		if envFrom.SecretRef != nil && envFrom.SecretRef.Name != "" {
			edges = append(edges, Edge{Type: EdgeUses, TracedBy: "envFrom.secretRef", CoreRef: &CoreRef{Version: "v1", Kind: "Secret", Namespace: namespace, Name: envFrom.SecretRef.Name}})
		}
	}
	for _, env := range container.Env {
		if env.ValueFrom == nil {
			continue
		}
		if env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name != "" {
			edges = append(edges, Edge{Type: EdgeUses, TracedBy: "env.configMapKeyRef", CoreRef: &CoreRef{Version: "v1", Kind: "ConfigMap", Namespace: namespace, Name: env.ValueFrom.ConfigMapKeyRef.Name}})
		}
		if env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name != "" {
			edges = append(edges, Edge{Type: EdgeUses, TracedBy: "env.secretKeyRef", CoreRef: &CoreRef{Version: "v1", Kind: "Secret", Namespace: namespace, Name: env.ValueFrom.SecretKeyRef.Name}})
		}
	}
	return edges
}
