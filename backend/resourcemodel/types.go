package resourcemodel

import (
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type ResourceSource string

const (
	ResourceSourceKubernetes ResourceSource = "kubernetes"
	ResourceSourceSynthetic  ResourceSource = "synthetic"
)

type ResourceScope string

const (
	ResourceScopeCluster    ResourceScope = "cluster"
	ResourceScopeNamespaced ResourceScope = "namespaced"
)

type ResourceModelBuildOptions struct {
	Materialization ResourceFactMaterialization
}

type ResourceFactMaterialization uint64

const (
	MaterializeSummaryFacts ResourceFactMaterialization = 1 << iota
	MaterializeRelationshipFacts
	MaterializeDetailFacts
	MaterializeReverseLinks
	MaterializeContainerTemplates
	MaterializeChildLists
	MaterializeMetrics
)

func (m ResourceFactMaterialization) Has(flag ResourceFactMaterialization) bool {
	return m&flag != 0
}

func BuildOptions(options ...ResourceModelBuildOptions) ResourceModelBuildOptions {
	if len(options) == 0 {
		return ResourceModelBuildOptions{Materialization: MaterializeSummaryFacts}
	}
	return options[0]
}

type StatusSignalType string

const (
	StatusSignalCondition     StatusSignalType = "condition"
	StatusSignalPhase         StatusSignalType = "phase"
	StatusSignalReadiness     StatusSignalType = "readiness"
	StatusSignalResourceState StatusSignalType = "resourceState"
	StatusSignalDeletion      StatusSignalType = "deletion"
)

type ResourceRef struct {
	ClusterID string `json:"clusterId"`
	Group     string `json:"group"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Resource  string `json:"resource,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
	UID       string `json:"uid,omitempty"`
}

type DisplayRef struct {
	ClusterID string `json:"clusterId"`
	Group     string `json:"group,omitempty"`
	Version   string `json:"version,omitempty"`
	Kind      string `json:"kind"`
	Resource  string `json:"resource,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
	UID       string `json:"uid,omitempty"`
}

type ResourceLink struct {
	Ref     *ResourceRef `json:"ref,omitempty"`
	Display *DisplayRef  `json:"display,omitempty"`
}

type ResourceMetadata struct {
	Labels            map[string]string `json:"labels,omitempty"`
	Annotations       map[string]string `json:"annotations,omitempty"`
	CreationTimestamp metav1.Time       `json:"creationTimestamp,omitempty"`
	ResourceVersion   string            `json:"resourceVersion,omitempty"`
	Finalizers        []string          `json:"finalizers,omitempty"`
}

type ResourceStatusSignal struct {
	Type    StatusSignalType `json:"type"`
	Name    string           `json:"name"`
	Status  string           `json:"status"`
	Reason  string           `json:"reason,omitempty"`
	Message string           `json:"message,omitempty"`
}

type ResourceStatusBadge struct {
	Text   string `json:"text"`
	Status string `json:"status"`
}

type ResourceLifecycle struct {
	Deleting         bool `json:"deleting"`
	FinalizerBlocked bool `json:"finalizerBlocked"`
}

type ResourceStatusPresentation struct {
	Label        string                 `json:"label"`
	State        string                 `json:"state"`
	Presentation string                 `json:"presentation,omitempty"`
	Reason       string                 `json:"reason,omitempty"`
	Message      string                 `json:"message,omitempty"`
	Signals      []ResourceStatusSignal `json:"signals,omitempty"`
	Badges       []ResourceStatusBadge  `json:"badges,omitempty"`
	Lifecycle    ResourceLifecycle      `json:"lifecycle"`
}

type ConditionFacts struct {
	Type               string      `json:"type"`
	Status             string      `json:"status"`
	Reason             string      `json:"reason,omitempty"`
	Message            string      `json:"message,omitempty"`
	LastTransitionTime metav1.Time `json:"lastTransitionTime,omitempty"`
}

type ResourceFacts struct {
}

type WorkloadCommonFacts struct {
	DesiredReplicas   int32            `json:"desiredReplicas"`
	CurrentReplicas   int32            `json:"currentReplicas"`
	ReadyReplicas     int32            `json:"readyReplicas"`
	UpdatedReplicas   int32            `json:"updatedReplicas,omitempty"`
	AvailableReplicas int32            `json:"availableReplicas,omitempty"`
	Conditions        []ConditionFacts `json:"conditions,omitempty"`
}

// DeploymentFacts (resources/deployment), StatefulSetFacts (resources/statefulset),
// DaemonSetFacts (resources/daemonset), and ReplicaSetFacts (resources/replicaset)
// moved to their kind packages and were removed from the ResourceFacts union to
// break the import cycle so each kind owns its own facts type.

// JobFacts (resources/job) and CronJobFacts (resources/cronjob) moved to their
// kind packages, removed from the ResourceFacts union (same cycle-break as the
// other workload kinds).

type ResourceListFacts struct {
	CPU              *resource.Quantity           `json:"cpu,omitempty"`
	Memory           *resource.Quantity           `json:"memory,omitempty"`
	Storage          *resource.Quantity           `json:"storage,omitempty"`
	EphemeralStorage *resource.Quantity           `json:"ephemeralStorage,omitempty"`
	Pods             *resource.Quantity           `json:"pods,omitempty"`
	Extended         map[string]resource.Quantity `json:"extended,omitempty"`
}

type ResourceQuantityMapFacts map[string]resource.Quantity

// PersistentVolumeFacts moved to resources/persistentvolume. ResourceListFacts
// stays here (shared primitive).

// PersistentVolumeClaimFacts moved to resources/persistentvolumeclaim. The shared
// primitives it referenced (ResourceListFacts/ConditionFacts/ResourceLink) stay here.

// StorageClassFacts moved to resources/storageclass (type storageclass.Facts),
// removed from the ResourceFacts union (same cycle-break as the other kinds).

// ConfigMapFacts moved to resources/configmap and SecretFacts moved to
// resources/secret, removed from the ResourceFacts union (same cycle-break).

// EndpointSliceFacts + EndpointAddressFacts/EndpointPortFacts moved to
// resources/endpointslice (EndpointSlice-only), removed from the ResourceFacts union.

// IngressClassFacts moved to resources/ingressclass (type ingressclass.Facts),
// removed from the ResourceFacts union (same cycle-break as the other kinds).

// NetworkPolicyFacts + its RuleFacts/PeerFacts/PortFacts/IPBlockFacts sub-types
// moved to resources/networkpolicy (NetworkPolicy-only), removed from the
// ResourceFacts union (same cycle-break as the other kinds).

type ConditionsSummaryFacts struct {
	Accepted   *ConditionFacts `json:"accepted,omitempty"`
	Programmed *ConditionFacts `json:"programmed,omitempty"`
	Ready      *ConditionFacts `json:"ready,omitempty"`
	Resolved   *ConditionFacts `json:"resolvedRefs,omitempty"`
}

type GatewayListenerFacts struct {
	Name           string           `json:"name,omitempty"`
	Hostname       string           `json:"hostname,omitempty"`
	Port           int32            `json:"port"`
	Protocol       string           `json:"protocol,omitempty"`
	AttachedRoutes int32            `json:"attachedRoutes"`
	Conditions     []ConditionFacts `json:"conditions,omitempty"`
}

type RouteCommonFacts struct {
	ParentRefs []ResourceLink         `json:"parentRefs,omitempty"`
	Hostnames  []string               `json:"hostnames,omitempty"`
	Rules      []RouteRuleFacts       `json:"rules,omitempty"`
	Backends   []ResourceLink         `json:"backends,omitempty"`
	Conditions []ConditionFacts       `json:"conditions,omitempty"`
	Summary    ConditionsSummaryFacts `json:"summary,omitempty"`
}

type RouteRuleFacts struct {
	Matches  []string       `json:"matches,omitempty"`
	Backends []ResourceLink `json:"backends,omitempty"`
}

type PolicyRuleFacts struct {
	APIGroups       []string `json:"apiGroups,omitempty"`
	Resources       []string `json:"resources,omitempty"`
	ResourceNames   []string `json:"resourceNames,omitempty"`
	Verbs           []string `json:"verbs,omitempty"`
	NonResourceURLs []string `json:"nonResourceURLs,omitempty"`
}

type SubjectFacts struct {
	Kind      string        `json:"kind"`
	APIGroup  string        `json:"apiGroup,omitempty"`
	Name      string        `json:"name"`
	Namespace string        `json:"namespace,omitempty"`
	Link      *ResourceLink `json:"link,omitempty"`
}

// PodDisruptionBudgetFacts moved to resources/poddisruptionbudget (type
// poddisruptionbudget.Facts), removed from the ResourceFacts union to break the
// import cycle so the kind owns its own facts type. IntOrStringFacts,
// DisruptedPodFacts, and ConditionFacts stay here (shared across kinds).

type IntOrStringFacts struct {
	Type   string `json:"type"`
	Value  string `json:"value"`
	IntVal int32  `json:"intVal,omitempty"`
	StrVal string `json:"strVal,omitempty"`
}

type DisruptedPodFacts struct {
	Pod            ResourceLink `json:"pod"`
	DisruptionTime metav1.Time  `json:"disruptionTime"`
}

// ResourceQuotaFacts (+ ScopeSelectorFacts/ScopeSelectorRequirementFacts) moved to
// resources/resourcequota and LimitRangeFacts (+ LimitRangeItemFacts) moved to
// resources/limitrange. ResourceQuantityMapFacts stays here (shared primitive).

type ResourceModel struct {
	Ref      ResourceRef                `json:"ref"`
	Source   ResourceSource             `json:"source"`
	Scope    ResourceScope              `json:"scope"`
	Metadata ResourceMetadata           `json:"metadata"`
	Status   ResourceStatusPresentation `json:"status"`
	Facts    ResourceFacts              `json:"facts"`
}
