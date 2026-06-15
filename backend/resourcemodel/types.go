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

type TaintFacts struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Effect string `json:"effect,omitempty"`
}

type NodeFacts struct {
	Roles         []string         `json:"roles,omitempty"`
	Unschedulable bool             `json:"unschedulable"`
	Cordoned      bool             `json:"cordoned"`
	Conditions    []ConditionFacts `json:"conditions,omitempty"`
	Taints        []TaintFacts     `json:"taints,omitempty"`
}

type ResourceFacts struct {
	Node                           *NodeFacts                           `json:"node,omitempty"`
	Pod                            *PodFacts                            `json:"pod,omitempty"`
	GatewayClass                   *GatewayClassFacts                   `json:"gatewayClass,omitempty"`
	Gateway                        *GatewayFacts                        `json:"gateway,omitempty"`
	HTTPRoute                      *HTTPRouteFacts                      `json:"httpRoute,omitempty"`
	GRPCRoute                      *GRPCRouteFacts                      `json:"grpcRoute,omitempty"`
	TLSRoute                       *TLSRouteFacts                       `json:"tlsRoute,omitempty"`
	ListenerSet                    *ListenerSetFacts                    `json:"listenerSet,omitempty"`
	ReferenceGrant                 *ReferenceGrantFacts                 `json:"referenceGrant,omitempty"`
	BackendTLSPolicy               *BackendTLSPolicyFacts               `json:"backendTLSPolicy,omitempty"`
	CustomResourceDefinition       *CustomResourceDefinitionFacts       `json:"customResourceDefinition,omitempty"`
	MutatingWebhookConfiguration   *MutatingWebhookConfigurationFacts   `json:"mutatingWebhookConfiguration,omitempty"`
	ValidatingWebhookConfiguration *ValidatingWebhookConfigurationFacts `json:"validatingWebhookConfiguration,omitempty"`
	HelmRelease                    *HelmReleaseFacts                    `json:"helmRelease,omitempty"`
	Event                          *EventFacts                          `json:"event,omitempty"`
	CustomResource                 *CustomResourceFacts                 `json:"customResource,omitempty"`
}


type PodFacts struct {
	Phase           string           `json:"phase,omitempty"`
	NodeName        string           `json:"nodeName,omitempty"`
	PodIP           string           `json:"podIP,omitempty"`
	ReadyContainers int32            `json:"readyContainers"`
	TotalContainers int32            `json:"totalContainers"`
	RestartCount    int32            `json:"restartCount"`
	Conditions      []ConditionFacts `json:"conditions,omitempty"`
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

type GatewayClassFacts struct {
	ControllerName string                 `json:"controllerName,omitempty"`
	Parameters     *ResourceLink          `json:"parameters,omitempty"`
	UsedBy         []ResourceLink         `json:"usedBy,omitempty"`
	Conditions     []ConditionFacts       `json:"conditions,omitempty"`
	Summary        ConditionsSummaryFacts `json:"summary,omitempty"`
}

type GatewayFacts struct {
	Class      *ResourceLink          `json:"class,omitempty"`
	Addresses  []string               `json:"addresses,omitempty"`
	Listeners  []GatewayListenerFacts `json:"listeners,omitempty"`
	Conditions []ConditionFacts       `json:"conditions,omitempty"`
	Summary    ConditionsSummaryFacts `json:"summary,omitempty"`
}

type GatewayListenerFacts struct {
	Name           string           `json:"name,omitempty"`
	Hostname       string           `json:"hostname,omitempty"`
	Port           int32            `json:"port"`
	Protocol       string           `json:"protocol,omitempty"`
	AttachedRoutes int32            `json:"attachedRoutes"`
	Conditions     []ConditionFacts `json:"conditions,omitempty"`
}

type ListenerSetFacts struct {
	ParentRef  ResourceLink           `json:"parentRef"`
	Listeners  []GatewayListenerFacts `json:"listeners,omitempty"`
	Conditions []ConditionFacts       `json:"conditions,omitempty"`
	Summary    ConditionsSummaryFacts `json:"summary,omitempty"`
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

type HTTPRouteFacts struct {
	RouteCommonFacts
}

type GRPCRouteFacts struct {
	RouteCommonFacts
}

type TLSRouteFacts struct {
	RouteCommonFacts
}

type ReferenceGrantFacts struct {
	From []ReferenceGrantFromFacts `json:"from,omitempty"`
	To   []ResourceLink            `json:"to,omitempty"`
}

type ReferenceGrantFromFacts struct {
	Group     string `json:"group,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Namespace string `json:"namespace,omitempty"`
}

type BackendTLSPolicyFacts struct {
	TargetRefs []ResourceLink         `json:"targetRefs,omitempty"`
	Conditions []ConditionFacts       `json:"conditions,omitempty"`
	Summary    ConditionsSummaryFacts `json:"summary,omitempty"`
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

type CustomResourceDefinitionFacts struct {
	Group                   string            `json:"group,omitempty"`
	Scope                   string            `json:"scope,omitempty"`
	Names                   CRDNamesFacts     `json:"names"`
	Versions                []CRDVersionFacts `json:"versions,omitempty"`
	Conditions              []ConditionFacts  `json:"conditions,omitempty"`
	ConversionStrategy      string            `json:"conversionStrategy,omitempty"`
	StorageVersion          string            `json:"storageVersion,omitempty"`
	ExtraServedVersionCount int               `json:"extraServedVersionCount,omitempty"`
}

type CRDNamesFacts struct {
	Plural     string   `json:"plural,omitempty"`
	Singular   string   `json:"singular,omitempty"`
	Kind       string   `json:"kind,omitempty"`
	ListKind   string   `json:"listKind,omitempty"`
	ShortNames []string `json:"shortNames,omitempty"`
	Categories []string `json:"categories,omitempty"`
}

type CRDVersionFacts struct {
	Name       string `json:"name"`
	Served     bool   `json:"served"`
	Storage    bool   `json:"storage"`
	Deprecated bool   `json:"deprecated"`
	HasSchema  bool   `json:"hasSchema"`
}

type LabelSelectorFacts struct {
	MatchLabels      map[string]string               `json:"matchLabels,omitempty"`
	MatchExpressions []LabelSelectorRequirementFacts `json:"matchExpressions,omitempty"`
}

type LabelSelectorRequirementFacts struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
}

type MutatingWebhookConfigurationFacts struct {
	Webhooks []MutatingWebhookFacts `json:"webhooks,omitempty"`
}

type ValidatingWebhookConfigurationFacts struct {
	Webhooks []ValidatingWebhookFacts `json:"webhooks,omitempty"`
}

type WebhookFacts struct {
	Name                    string                   `json:"name,omitempty"`
	AdmissionReviewVersions []string                 `json:"admissionReviewVersions,omitempty"`
	ClientConfig            WebhookClientConfigFacts `json:"clientConfig"`
	FailurePolicy           string                   `json:"failurePolicy,omitempty"`
	MatchPolicy             string                   `json:"matchPolicy,omitempty"`
	SideEffects             string                   `json:"sideEffects,omitempty"`
	TimeoutSeconds          *int32                   `json:"timeoutSeconds,omitempty"`
	NamespaceSelector       *LabelSelectorFacts      `json:"namespaceSelector,omitempty"`
	ObjectSelector          *LabelSelectorFacts      `json:"objectSelector,omitempty"`
	Rules                   []WebhookRuleFacts       `json:"rules,omitempty"`
}

type MutatingWebhookFacts struct {
	WebhookFacts
	ReinvocationPolicy string `json:"reinvocationPolicy,omitempty"`
}

type ValidatingWebhookFacts struct {
	WebhookFacts
}

type WebhookClientConfigFacts struct {
	Service *WebhookServiceFacts `json:"service,omitempty"`
	URL     string               `json:"url,omitempty"`
}

type WebhookServiceFacts struct {
	Namespace string        `json:"namespace,omitempty"`
	Name      string        `json:"name,omitempty"`
	Path      *string       `json:"path,omitempty"`
	Port      *int32        `json:"port,omitempty"`
	Service   *ResourceLink `json:"service,omitempty"`
}

type WebhookRuleFacts struct {
	APIGroups   []string `json:"apiGroups,omitempty"`
	APIVersions []string `json:"apiVersions,omitempty"`
	Resources   []string `json:"resources,omitempty"`
	Operations  []string `json:"operations,omitempty"`
	Scope       string   `json:"scope,omitempty"`
}

type HelmReleaseFacts struct {
	Chart       string              `json:"chart,omitempty"`
	Version     string              `json:"version,omitempty"`
	AppVersion  string              `json:"appVersion,omitempty"`
	Revision    int                 `json:"revision"`
	RawStatus   string              `json:"rawStatus,omitempty"`
	Updated     *metav1.Time        `json:"updated,omitempty"`
	Description string              `json:"description,omitempty"`
	Notes       string              `json:"notes,omitempty"`
	Resources   []ResourceLink      `json:"resources,omitempty"`
	History     []HelmRevisionFacts `json:"history,omitempty"`
}

type HelmRevisionFacts struct {
	Revision    int          `json:"revision"`
	Updated     *metav1.Time `json:"updated,omitempty"`
	Status      string       `json:"status,omitempty"`
	Chart       string       `json:"chart,omitempty"`
	AppVersion  string       `json:"appVersion,omitempty"`
	Description string       `json:"description,omitempty"`
}

type EventFacts struct {
	EventType      string        `json:"eventType,omitempty"`
	Reason         string        `json:"reason,omitempty"`
	Message        string        `json:"message,omitempty"`
	Count          int32         `json:"count"`
	Source         string        `json:"source,omitempty"`
	FirstTimestamp metav1.Time   `json:"firstTimestamp,omitempty"`
	LastTimestamp  metav1.Time   `json:"lastTimestamp,omitempty"`
	InvolvedObject *ResourceLink `json:"involvedObject,omitempty"`
}

type CustomResourceFacts struct {
	CRD                *ResourceLink    `json:"crd,omitempty"`
	Phase              string           `json:"phase,omitempty"`
	State              string           `json:"state,omitempty"`
	Ready              *bool            `json:"ready,omitempty"`
	ObservedGeneration *int64           `json:"observedGeneration,omitempty"`
	Conditions         []ConditionFacts `json:"conditions,omitempty"`
	RawStatus          map[string]any   `json:"rawStatus,omitempty"`
}

type ResourceModel struct {
	Ref      ResourceRef                `json:"ref"`
	Source   ResourceSource             `json:"source"`
	Scope    ResourceScope              `json:"scope"`
	Metadata ResourceMetadata           `json:"metadata"`
	Status   ResourceStatusPresentation `json:"status"`
	Facts    ResourceFacts              `json:"facts"`
}
