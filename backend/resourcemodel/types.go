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
	Namespace                      *NamespaceFacts                      `json:"namespace,omitempty"`
	Node                           *NodeFacts                           `json:"node,omitempty"`
	Pod                            *PodFacts                            `json:"pod,omitempty"`
	Deployment                     *DeploymentFacts                     `json:"deployment,omitempty"`
	StatefulSet                    *StatefulSetFacts                    `json:"statefulSet,omitempty"`
	DaemonSet                      *DaemonSetFacts                      `json:"daemonSet,omitempty"`
	ReplicaSet                     *ReplicaSetFacts                     `json:"replicaSet,omitempty"`
	Job                            *JobFacts                            `json:"job,omitempty"`
	CronJob                        *CronJobFacts                        `json:"cronJob,omitempty"`
	PersistentVolume               *PersistentVolumeFacts               `json:"persistentVolume,omitempty"`
	PersistentVolumeClaim          *PersistentVolumeClaimFacts          `json:"persistentVolumeClaim,omitempty"`
	StorageClass                   *StorageClassFacts                   `json:"storageClass,omitempty"`
	ConfigMap                      *ConfigMapFacts                      `json:"configMap,omitempty"`
	Secret                         *SecretFacts                         `json:"secret,omitempty"`
	Service                        *ServiceFacts                        `json:"service,omitempty"`
	EndpointSlice                  *EndpointSliceFacts                  `json:"endpointSlice,omitempty"`
	Ingress                        *IngressFacts                        `json:"ingress,omitempty"`
	IngressClass                   *IngressClassFacts                   `json:"ingressClass,omitempty"`
	NetworkPolicy                  *NetworkPolicyFacts                  `json:"networkPolicy,omitempty"`
	GatewayClass                   *GatewayClassFacts                   `json:"gatewayClass,omitempty"`
	Gateway                        *GatewayFacts                        `json:"gateway,omitempty"`
	HTTPRoute                      *HTTPRouteFacts                      `json:"httpRoute,omitempty"`
	GRPCRoute                      *GRPCRouteFacts                      `json:"grpcRoute,omitempty"`
	TLSRoute                       *TLSRouteFacts                       `json:"tlsRoute,omitempty"`
	ListenerSet                    *ListenerSetFacts                    `json:"listenerSet,omitempty"`
	ReferenceGrant                 *ReferenceGrantFacts                 `json:"referenceGrant,omitempty"`
	BackendTLSPolicy               *BackendTLSPolicyFacts               `json:"backendTLSPolicy,omitempty"`
	Role                           *RoleFacts                           `json:"role,omitempty"`
	ClusterRole                    *ClusterRoleFacts                    `json:"clusterRole,omitempty"`
	RoleBinding                    *RoleBindingFacts                    `json:"roleBinding,omitempty"`
	ClusterRoleBinding             *ClusterRoleBindingFacts             `json:"clusterRoleBinding,omitempty"`
	ServiceAccount                 *ServiceAccountFacts                 `json:"serviceAccount,omitempty"`
	HorizontalPodAutoscaler        *HorizontalPodAutoscalerFacts        `json:"horizontalPodAutoscaler,omitempty"`
	PodDisruptionBudget            *PodDisruptionBudgetFacts            `json:"podDisruptionBudget,omitempty"`
	ResourceQuota                  *ResourceQuotaFacts                  `json:"resourceQuota,omitempty"`
	LimitRange                     *LimitRangeFacts                     `json:"limitRange,omitempty"`
	CustomResourceDefinition       *CustomResourceDefinitionFacts       `json:"customResourceDefinition,omitempty"`
	MutatingWebhookConfiguration   *MutatingWebhookConfigurationFacts   `json:"mutatingWebhookConfiguration,omitempty"`
	ValidatingWebhookConfiguration *ValidatingWebhookConfigurationFacts `json:"validatingWebhookConfiguration,omitempty"`
	HelmRelease                    *HelmReleaseFacts                    `json:"helmRelease,omitempty"`
	Event                          *EventFacts                          `json:"event,omitempty"`
	CustomResource                 *CustomResourceFacts                 `json:"customResource,omitempty"`
}

type NamespaceFacts struct {
	RawPhase       string         `json:"rawPhase,omitempty"`
	WorkloadState  string         `json:"workloadState,omitempty"`
	ResourceQuotas []ResourceLink `json:"resourceQuotas,omitempty"`
	LimitRanges    []ResourceLink `json:"limitRanges,omitempty"`
	WorkloadsKnown bool           `json:"workloadsKnown"`
	HasWorkloads   bool           `json:"hasWorkloads"`
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

type DeploymentFacts struct {
	WorkloadCommonFacts
	Paused bool `json:"paused,omitempty"`
}

type StatefulSetFacts struct {
	WorkloadCommonFacts
}

type DaemonSetFacts struct {
	WorkloadCommonFacts
}

type ReplicaSetFacts struct {
	WorkloadCommonFacts
}

type JobFacts struct {
	DesiredReplicas int32            `json:"desiredReplicas"`
	Active          int32            `json:"active,omitempty"`
	Succeeded       int32            `json:"succeeded,omitempty"`
	Failed          int32            `json:"failed,omitempty"`
	Suspended       bool             `json:"suspended,omitempty"`
	Conditions      []ConditionFacts `json:"conditions,omitempty"`
}

type CronJobFacts struct {
	Suspended  bool  `json:"suspended,omitempty"`
	ActiveJobs int32 `json:"activeJobs,omitempty"`
}

type ResourceListFacts struct {
	CPU              *resource.Quantity           `json:"cpu,omitempty"`
	Memory           *resource.Quantity           `json:"memory,omitempty"`
	Storage          *resource.Quantity           `json:"storage,omitempty"`
	EphemeralStorage *resource.Quantity           `json:"ephemeralStorage,omitempty"`
	Pods             *resource.Quantity           `json:"pods,omitempty"`
	Extended         map[string]resource.Quantity `json:"extended,omitempty"`
}

type ResourceQuantityMapFacts map[string]resource.Quantity

type PersistentVolumeFacts struct {
	Phase          string            `json:"phase,omitempty"`
	StorageClass   string            `json:"storageClass,omitempty"`
	Capacity       ResourceListFacts `json:"capacity,omitempty"`
	ReclaimPolicy  string            `json:"reclaimPolicy,omitempty"`
	ClaimNamespace string            `json:"claimNamespace,omitempty"`
	ClaimName      string            `json:"claimName,omitempty"`
	Reason         string            `json:"reason,omitempty"`
	Message        string            `json:"message,omitempty"`
}

type PersistentVolumeClaimFacts struct {
	Phase        string            `json:"phase,omitempty"`
	StorageClass string            `json:"storageClass,omitempty"`
	VolumeName   string            `json:"volumeName,omitempty"`
	Capacity     ResourceListFacts `json:"capacity,omitempty"`
	Conditions   []ConditionFacts  `json:"conditions,omitempty"`
	MountedBy    []ResourceLink    `json:"mountedBy,omitempty"`
}

type StorageClassFacts struct {
	Provisioner                 string `json:"provisioner,omitempty"`
	ReclaimPolicy               string `json:"reclaimPolicy,omitempty"`
	VolumeBindingMode           string `json:"volumeBindingMode,omitempty"`
	AllowVolumeExpansion        bool   `json:"allowVolumeExpansion,omitempty"`
	DefaultClass                bool   `json:"defaultClass"`
	DefaultClassAnnotation      string `json:"defaultClassAnnotation,omitempty"`
	DefaultClassAnnotationValue string `json:"defaultClassAnnotationValue,omitempty"`
}

type ConfigMapFacts struct {
	DataKeys       []string       `json:"dataKeys,omitempty"`
	BinaryDataKeys []string       `json:"binaryDataKeys,omitempty"`
	DataCount      int            `json:"dataCount"`
	DataSizeBytes  int64          `json:"dataSizeBytes"`
	UsedBy         []ResourceLink `json:"usedBy,omitempty"`
}

type SecretFacts struct {
	Type          string         `json:"type,omitempty"`
	DataKeys      []string       `json:"dataKeys,omitempty"`
	DataCount     int            `json:"dataCount"`
	DataSizeBytes int64          `json:"dataSizeBytes"`
	Immutable     *bool          `json:"immutable,omitempty"`
	UsedBy        []ResourceLink `json:"usedBy,omitempty"`
}

type ServiceFacts struct {
	Type                   string             `json:"type,omitempty"`
	ClusterIP              string             `json:"clusterIP,omitempty"`
	ClusterIPs             []string           `json:"clusterIPs,omitempty"`
	ExternalIPs            []string           `json:"externalIPs,omitempty"`
	LoadBalancerAddresses  []string           `json:"loadBalancerAddresses,omitempty"`
	ExternalName           string             `json:"externalName,omitempty"`
	Ports                  []ServicePortFacts `json:"ports,omitempty"`
	SessionAffinity        string             `json:"sessionAffinity,omitempty"`
	SessionAffinityTimeout int32              `json:"sessionAffinityTimeout,omitempty"`
	Selector               map[string]string  `json:"selector,omitempty"`
	Endpoints              []string           `json:"endpoints,omitempty"`
	ReadyEndpointCount     int                `json:"readyEndpointCount"`
	NotReadyEndpointCount  int                `json:"notReadyEndpointCount"`
	TotalEndpointCount     int                `json:"totalEndpointCount"`
}

type ServicePortFacts struct {
	Name       string `json:"name,omitempty"`
	Protocol   string `json:"protocol,omitempty"`
	Port       int32  `json:"port"`
	TargetPort string `json:"targetPort,omitempty"`
	NodePort   int32  `json:"nodePort,omitempty"`
}

type EndpointSliceFacts struct {
	AddressType       string                 `json:"addressType,omitempty"`
	ReadyAddresses    []EndpointAddressFacts `json:"readyAddresses,omitempty"`
	NotReadyAddresses []EndpointAddressFacts `json:"notReadyAddresses,omitempty"`
	Ports             []EndpointPortFacts    `json:"ports,omitempty"`
	Service           *ResourceLink          `json:"service,omitempty"`
}

type EndpointAddressFacts struct {
	IP        string        `json:"ip,omitempty"`
	Hostname  string        `json:"hostname,omitempty"`
	NodeName  string        `json:"nodeName,omitempty"`
	TargetRef *ResourceLink `json:"targetRef,omitempty"`
}

type EndpointPortFacts struct {
	Name        string `json:"name,omitempty"`
	Port        int32  `json:"port"`
	Protocol    string `json:"protocol,omitempty"`
	AppProtocol string `json:"appProtocol,omitempty"`
}

type IngressFacts struct {
	ClassName      string               `json:"className,omitempty"`
	Class          *ResourceLink        `json:"class,omitempty"`
	Hosts          []string             `json:"hosts,omitempty"`
	Addresses      []string             `json:"addresses,omitempty"`
	TLS            []IngressTLSFacts    `json:"tls,omitempty"`
	Rules          []IngressRuleFacts   `json:"rules,omitempty"`
	DefaultBackend *IngressBackendFacts `json:"defaultBackend,omitempty"`
	BackendRefs    []ResourceLink       `json:"backendRefs,omitempty"`
}

type IngressTLSFacts struct {
	Hosts     []string      `json:"hosts,omitempty"`
	SecretRef *ResourceLink `json:"secretRef,omitempty"`
}

type IngressRuleFacts struct {
	Host  string             `json:"host,omitempty"`
	Paths []IngressPathFacts `json:"paths,omitempty"`
}

type IngressPathFacts struct {
	Path     string              `json:"path,omitempty"`
	PathType string              `json:"pathType,omitempty"`
	Backend  IngressBackendFacts `json:"backend"`
}

type IngressBackendFacts struct {
	ServiceName string        `json:"serviceName,omitempty"`
	ServicePort string        `json:"servicePort,omitempty"`
	Service     *ResourceLink `json:"service,omitempty"`
	Resource    string        `json:"resource,omitempty"`
}

type IngressClassFacts struct {
	Controller                  string `json:"controller,omitempty"`
	DefaultClass                bool   `json:"defaultClass"`
	DefaultClassAnnotation      string `json:"defaultClassAnnotation,omitempty"`
	DefaultClassAnnotationValue string `json:"defaultClassAnnotationValue,omitempty"`
}

type NetworkPolicyFacts struct {
	PodSelector  map[string]string        `json:"podSelector,omitempty"`
	PolicyTypes  []string                 `json:"policyTypes,omitempty"`
	IngressRules []NetworkPolicyRuleFacts `json:"ingressRules,omitempty"`
	EgressRules  []NetworkPolicyRuleFacts `json:"egressRules,omitempty"`
}

type NetworkPolicyRuleFacts struct {
	Peers []NetworkPolicyPeerFacts `json:"peers,omitempty"`
	Ports []NetworkPolicyPortFacts `json:"ports,omitempty"`
}

type NetworkPolicyPeerFacts struct {
	PodSelector       map[string]string `json:"podSelector,omitempty"`
	NamespaceSelector map[string]string `json:"namespaceSelector,omitempty"`
	IPBlock           *IPBlockFacts     `json:"ipBlock,omitempty"`
}

type NetworkPolicyPortFacts struct {
	Protocol string `json:"protocol,omitempty"`
	Port     string `json:"port,omitempty"`
	EndPort  *int32 `json:"endPort,omitempty"`
}

type IPBlockFacts struct {
	CIDR   string   `json:"cidr,omitempty"`
	Except []string `json:"except,omitempty"`
}

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

type RoleFacts struct {
	Rules              []PolicyRuleFacts `json:"rules,omitempty"`
	UsedByRoleBindings []ResourceLink    `json:"usedByRoleBindings,omitempty"`
}

type ClusterRoleFacts struct {
	Rules               []PolicyRuleFacts     `json:"rules,omitempty"`
	AggregationRule     *AggregationRuleFacts `json:"aggregationRule,omitempty"`
	ClusterRoleBindings []ResourceLink        `json:"clusterRoleBindings,omitempty"`
	RoleBindings        []ResourceLink        `json:"roleBindings,omitempty"`
}

type AggregationRuleFacts struct {
	ClusterRoleSelectors []map[string]string `json:"clusterRoleSelectors,omitempty"`
}

type RoleBindingFacts struct {
	RoleRef  ResourceLink   `json:"roleRef"`
	Subjects []SubjectFacts `json:"subjects,omitempty"`
}

type ClusterRoleBindingFacts struct {
	RoleRef  ResourceLink   `json:"roleRef"`
	Subjects []SubjectFacts `json:"subjects,omitempty"`
}

type SubjectFacts struct {
	Kind      string        `json:"kind"`
	APIGroup  string        `json:"apiGroup,omitempty"`
	Name      string        `json:"name"`
	Namespace string        `json:"namespace,omitempty"`
	Link      *ResourceLink `json:"link,omitempty"`
}

type ServiceAccountFacts struct {
	Secrets             []ResourceLink `json:"secrets,omitempty"`
	ImagePullSecrets    []ResourceLink `json:"imagePullSecrets,omitempty"`
	AutomountToken      *bool          `json:"automountToken,omitempty"`
	UsedByPods          []ResourceLink `json:"usedByPods,omitempty"`
	RoleBindings        []ResourceLink `json:"roleBindings,omitempty"`
	ClusterRoleBindings []ResourceLink `json:"clusterRoleBindings,omitempty"`
}

type HorizontalPodAutoscalerFacts struct {
	ScaleTarget     ResourceLink          `json:"scaleTarget"`
	MinReplicas     *int32                `json:"minReplicas,omitempty"`
	MaxReplicas     int32                 `json:"maxReplicas"`
	CurrentReplicas int32                 `json:"currentReplicas"`
	DesiredReplicas int32                 `json:"desiredReplicas"`
	Metrics         []MetricFacts         `json:"metrics,omitempty"`
	CurrentMetrics  []MetricStatusFacts   `json:"currentMetrics,omitempty"`
	Behavior        *ScalingBehaviorFacts `json:"behavior,omitempty"`
	Conditions      []ConditionFacts      `json:"conditions,omitempty"`
	LastScaleTime   *metav1.Time          `json:"lastScaleTime,omitempty"`
}

type MetricFacts struct {
	Kind   string            `json:"kind"`
	Target map[string]string `json:"target,omitempty"`
}

type MetricStatusFacts struct {
	Kind    string            `json:"kind"`
	Current map[string]string `json:"current,omitempty"`
}

type ScalingBehaviorFacts struct {
	ScaleUp   *ScalingRulesFacts `json:"scaleUp,omitempty"`
	ScaleDown *ScalingRulesFacts `json:"scaleDown,omitempty"`
}

type ScalingRulesFacts struct {
	StabilizationWindowSeconds *int32   `json:"stabilizationWindowSeconds,omitempty"`
	SelectPolicy               string   `json:"selectPolicy,omitempty"`
	Policies                   []string `json:"policies,omitempty"`
}

type PodDisruptionBudgetFacts struct {
	Selector           map[string]string   `json:"selector,omitempty"`
	MinAvailable       *IntOrStringFacts   `json:"minAvailable,omitempty"`
	MaxUnavailable     *IntOrStringFacts   `json:"maxUnavailable,omitempty"`
	AllowedDisruptions int32               `json:"allowedDisruptions"`
	CurrentHealthy     int32               `json:"currentHealthy"`
	DesiredHealthy     int32               `json:"desiredHealthy"`
	ExpectedPods       int32               `json:"expectedPods"`
	DisruptedPods      []DisruptedPodFacts `json:"disruptedPods,omitempty"`
	Conditions         []ConditionFacts    `json:"conditions,omitempty"`
	ObservedGeneration int64               `json:"observedGeneration"`
}

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

type ResourceQuotaFacts struct {
	Hard           ResourceQuantityMapFacts `json:"hard,omitempty"`
	Used           ResourceQuantityMapFacts `json:"used,omitempty"`
	UsedPercentage map[string]int           `json:"usedPercentage,omitempty"`
	Scopes         []string                 `json:"scopes,omitempty"`
	ScopeSelector  *ScopeSelectorFacts      `json:"scopeSelector,omitempty"`
}

type ScopeSelectorFacts struct {
	MatchExpressions []ScopeSelectorRequirementFacts `json:"matchExpressions,omitempty"`
}

type ScopeSelectorRequirementFacts struct {
	ScopeName string   `json:"scopeName"`
	Operator  string   `json:"operator"`
	Values    []string `json:"values,omitempty"`
}

type LimitRangeFacts struct {
	Limits []LimitRangeItemFacts `json:"limits,omitempty"`
}

type LimitRangeItemFacts struct {
	Kind                 string                   `json:"kind"`
	Max                  ResourceQuantityMapFacts `json:"max,omitempty"`
	Min                  ResourceQuantityMapFacts `json:"min,omitempty"`
	Default              ResourceQuantityMapFacts `json:"default,omitempty"`
	DefaultRequest       ResourceQuantityMapFacts `json:"defaultRequest,omitempty"`
	MaxLimitRequestRatio ResourceQuantityMapFacts `json:"maxLimitRequestRatio,omitempty"`
}

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
