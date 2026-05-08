# Shared Resource Model Plan

## Problem

Luxury Yacht currently interprets Kubernetes resources in too many independent
places.

For the same Kubernetes object, the app may derive user-facing meaning in:

- refresh snapshot builders for table views
- resource detail builders for the object panel
- object-map snapshot builders
- frontend table components
- frontend object-panel overview components

Those surfaces often need different payload sizes and layouts, but they should
not independently decide what a Kubernetes object means.

The node status mismatch is one visible symptom: one surface can know that a
node is `Ready (Cordoned)` while another surface shows only `Ready`. The deeper
issue is architectural drift. Status, identity, relationships, lifecycle,
metadata, and action facts are not consistently derived from one shared resource
model.

## Goal

Introduce a backend shared resource model layer that owns Kubernetes resource
semantics once, then lets table, detail, and object-map payloads select the data
they need from that model.

The target shape is:

```text
Kubernetes object
  -> shared backend resource model
      -> identity
      -> metadata
      -> status presentation
      -> lifecycle facts
      -> relationships
  -> table/detail/map payload builders select from the model
  -> contextual action/capability model selects resource + RBAC + operation state
  -> frontend renders app models without reinterpreting Kubernetes semantics
```

The frontend should still own layout and interaction. The backend should own
Kubernetes interpretation.

## Non-Goals

- Do not create a broad frontend status resolver as the primary fix.
- Do not collapse table, detail, and object-map payloads into one giant JSON
  response.
- Do not redesign frontend table or panel layouts.
- Do not migrate every Kubernetes kind in one unsafe rewrite.
- Do not preserve temporary compatibility paths after a resource family is
  migrated.

Different consumers may keep different view models. The simplification is that
those view models should be derived from one shared resource model instead of
duplicating Kubernetes semantics.

## Core Design

Add a backend package for shared resource models. The exact package name should
match backend conventions, but the responsibility should be explicit: convert
Kubernetes API objects into app-level resource facts.

The object catalog remains the source of truth for Kubernetes GVK/GVR, scope,
and navigable reference resolution. Shared model builders should not guess a
resource, group, version, or scope from kind strings when the catalog can resolve
it.

The shared resource model should include full object identity:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace`, when namespaced
- `name`, when object-specific

The shared resource model should expose shared facts such as:

- canonical object reference
- labels and annotations
- creation timestamp and age inputs
- owner references and relationship references
- primary status presentation
- relevant lifecycle state
- resource-specific semantic facts

Action and capability facts are related, but they are not intrinsic properties
of a Kubernetes object. They depend on RBAC, selected cluster, discovery state,
active operations, and action options. Keep them in a contextual capability
model layered onto the shared resource model.

The shared status model should be UI-neutral and is defined in the common shape
below.

`State` should use a small app-level vocabulary, such as:

- `healthy`
- `degraded`
- `unhealthy`
- `inactive`
- `refreshing`
- `unknown`

Frontend components can map those states to existing badge/chip classes.

## Target Object Shape Catalog

These shapes describe the backend shared resource model. They are not a mandate
that every table, detail panel, and object-map response serialize the full model.
Each consumer should select the fields it needs from the shared model.

The catalog was checked against:

- object-panel detail loading cases
- object-panel overview registry kinds
- refresh streaming helper row builders
- backend resource detail structs
- object-map typed collectors

### Supported Resource Inventory

The shared model should cover these app-supported Kubernetes or app-synthetic
resource kinds:

- `BackendTLSPolicy`
- `ClusterRole`
- `ClusterRoleBinding`
- `ConfigMap`
- `CronJob`
- `CustomResourceDefinition`
- `DaemonSet`
- `Deployment`
- `EndpointSlice`
- `Event`
- `GRPCRoute`
- `Gateway`
- `GatewayClass`
- `HTTPRoute`
- `HelmRelease`
- `HorizontalPodAutoscaler`
- `Ingress`
- `IngressClass`
- `Job`
- `LimitRange`
- `ListenerSet`
- `MutatingWebhookConfiguration`
- `Namespace`
- `NetworkPolicy`
- `Node`
- `PersistentVolume`
- `PersistentVolumeClaim`
- `Pod`
- `PodDisruptionBudget`
- `ReferenceGrant`
- `ReplicaSet`
- `ResourceQuota`
- `Role`
- `RoleBinding`
- `Secret`
- `Service`
- `ServiceAccount`
- `StatefulSet`
- `StorageClass`
- `TLSRoute`
- `ValidatingWebhookConfiguration`
- custom resources through `CustomResourceFacts`

The scan also finds names that should not become first-class facts:

- `Eviction`, `PodMetrics`, and `NodeMetrics` are action/subresource or metrics
  API objects used internally.
- RBAC `User` and `Group` subjects are identities, not Kubernetes objects; keep
  them as `DisplayRef`-style links.
- node log sources such as `path` and `service` are node-log discovery records,
  not Kubernetes resources.
- fixture/custom examples such as `Widget`, `Gadget`, `DBCluster`,
  `DBInstance`, `DbInstance`, and `Rollout` are covered by
  `CustomResourceFacts` unless promoted to explicit support later.

### Common Shape

Every Kubernetes object or app-synthetic resource represented by the app should
start from the same common shape.

```go
type ResourceModel struct {
	Ref       ResourceRef
	Metadata  ResourceMetadata
	Status    ResourceStatusPresentation
	Owners    []ResourceLink
	Relations []ResourceRelation
	Facts     ResourceFacts
}

type ResourceRef struct {
	ClusterID string
	Group     string
	Version   string
	Kind      string
	Resource  string
	Namespace string
	Name      string
	UID       string
}

type DisplayRef struct {
	ClusterID string
	Group     string
	Version   string
	Kind      string
	Resource  string
	Namespace string
	Name      string
}

type ResourceLink struct {
	Ref     *ResourceRef
	Display *DisplayRef
}

type ResourceMetadata struct {
	Labels            map[string]string
	Annotations       map[string]string
	CreationTimestamp time.Time
	ResourceVersion   string
	DeletionTimestamp *time.Time
	Finalizers        []string
}

type ResourceStatusPresentation struct {
	Label              string
	State              ResourceState
	Reason             string
	Message            string
	ObservedGeneration int64
	Source             ResourceStatusSource
	Badges             []ResourceStatusBadge
}

type ResourceStatusSource struct {
	ConditionType      string
	ConditionStatus    string
	LastTransitionTime *time.Time
}

type ResourceStatusBadge struct {
	Label  string
	State  ResourceState
	Reason string
}

type ResourceState string

const (
	ResourceStateHealthy    ResourceState = "healthy"
	ResourceStateDegraded   ResourceState = "degraded"
	ResourceStateUnhealthy  ResourceState = "unhealthy"
	ResourceStateInactive   ResourceState = "inactive"
	ResourceStateRefreshing ResourceState = "refreshing"
	ResourceStateUnknown    ResourceState = "unknown"
)

type ResourceRelation struct {
	Type     string
	Target   ResourceLink
	TracedBy string
}
```

`ResourceRef` is for openable, fully-qualified references. `DisplayRef` is for
references the source object exposes only partially, such as Gateway API
references without a name, owner references that cannot be resolved through the
catalog, RBAC subjects that are users or groups, or external Helm manifest
resources. Shared model builders must not pretend those are fully openable.
Exactly one of `ResourceLink.Ref` or `ResourceLink.Display` must be set. Builders
should use constructors and validation helpers instead of hand-building links.
The shared model package should provide:

- `NewResourceLink(ref ResourceRef) ResourceLink`
- `NewDisplayLink(display DisplayRef) ResourceLink`
- `ResourceLink.IsOpenable() bool`
- `ResourceLink.Validate() error`

### Contextual Capabilities

Capabilities must be modeled separately from intrinsic resource facts.

```go
type ResourceCapabilityModel struct {
	Target   ResourceLink
	Context  CapabilityContext
	Actions  map[ActionID]CapabilityFact
}

type CapabilityContext struct {
	ClusterID        string
	PrincipalKey     string
	DiscoveryVersion string
	ActionOptions    map[string]any
}

type ActionID string

const (
	ActionDelete     ActionID = "delete"
	ActionEdit       ActionID = "edit"
	ActionRestart    ActionID = "restart"
	ActionScale      ActionID = "scale"
	ActionLogs       ActionID = "logs"
	ActionExec       ActionID = "exec"
	ActionTrigger    ActionID = "trigger"
	ActionSuspend    ActionID = "suspend"
	ActionCordon     ActionID = "cordon"
	ActionDrain      ActionID = "drain"
	ActionDeletePods ActionID = "deletePods"
	ActionViewSecretValues ActionID = "viewSecretValues"
)

type CapabilityFact struct {
	Allowed  bool
	InFlight bool
	Reason   string
	Error    string
	Checks   []CapabilityCheckFact
}

type CapabilityCheckFact struct {
	Ref     ResourceLink
	Group   string
	Version string
	Kind    string
	Verb    string
	Allowed bool
	Reason  string
	Error   string
}
```

Capability builders may consume `ResourceModel`, but the shared resource model
must not embed capability facts directly. This keeps object semantics stable
while allowing permissions, diagnostics, active operations, and option-dependent
actions to change independently.

`Reason` explains a known denial or disabled state, such as missing RBAC or an
in-flight operation. `Error` records a failed check, such as discovery or
permission-check transport failure. Consumers should show `Error` as diagnostic
failure context rather than treating it as a normal denial reason.

### Resource Facts Union

Resource-specific facts should stay typed. The shared model should not force all
objects into one fake universal structure.

Every supported GVK should have an explicit facts slot. Shared structs are
allowed only for genuinely common substructure, such as pod-template facts,
rules, subjects, ports, conditions, metrics, and route common fields. A shared
struct should not be the only shape for multiple GVKs when those GVKs have
different lifecycle, status, relationship, or action semantics.

```go
type ResourceFacts struct {
	Namespace          *NamespaceFacts
	Node               *NodeFacts
	Pod                *PodFacts
	Deployment         *DeploymentFacts
	StatefulSet        *StatefulSetFacts
	DaemonSet          *DaemonSetFacts
	ReplicaSet         *ReplicaSetFacts
	Job                *JobFacts
	CronJob            *CronJobFacts
	ConfigMap          *ConfigMapFacts
	Secret             *SecretFacts
	Service            *ServiceFacts
	EndpointSlice      *EndpointSliceFacts
	Ingress            *IngressFacts
	IngressClass       *IngressClassFacts
	NetworkPolicy      *NetworkPolicyFacts
	GatewayClass       *GatewayClassFacts
	Gateway            *GatewayFacts
	HTTPRoute          *HTTPRouteFacts
	GRPCRoute          *GRPCRouteFacts
	TLSRoute           *TLSRouteFacts
	ListenerSet        *ListenerSetFacts
	ReferenceGrant     *ReferenceGrantFacts
	BackendTLSPolicy   *BackendTLSPolicyFacts
	PersistentVolume   *PersistentVolumeFacts
	PersistentVolumeClaim *PersistentVolumeClaimFacts
	StorageClass       *StorageClassFacts
	HorizontalPodAutoscaler *HorizontalPodAutoscalerFacts
	PodDisruptionBudget *PodDisruptionBudgetFacts
	ResourceQuota      *ResourceQuotaFacts
	LimitRange         *LimitRangeFacts
	Role               *RoleFacts
	ClusterRole        *ClusterRoleFacts
	RoleBinding        *RoleBindingFacts
	ClusterRoleBinding *ClusterRoleBindingFacts
	ServiceAccount     *ServiceAccountFacts
	CustomResourceDefinition *CustomResourceDefinitionFacts
	MutatingWebhookConfiguration *MutatingWebhookConfigurationFacts
	ValidatingWebhookConfiguration *ValidatingWebhookConfigurationFacts
	HelmRelease        *HelmReleaseFacts
	Event              *EventFacts
	CustomResource     *CustomResourceFacts
}
```

The implementation must decide the exported TypeScript shape before Phase 2.
The internal Go model may use explicit facts structs, but Wails-facing DTOs
should avoid serializing dozens of null fields per object. Acceptable options:

- a discriminated facts payload such as `{kind: "Pod", pod: PodFacts}`
- a Go union with `json:",omitempty"` on every facts pointer and generated
  TypeScript types verified for ergonomic narrowing

Record the decision as an ADR-style note before migrating the first resource
family. Do not let each builder invent its own exported facts shape.

### Shared Supporting Shapes

These supporting shapes are shared by multiple resource facts.

```go
type ConditionFacts struct {
	Type               string
	Status             string
	Reason             string
	Message            string
	LastTransitionTime *time.Time
}

// Internal model shape. Table/detail DTOs may format these into strings, but
// shared resource builders should preserve semantic quantities.
// Requires k8s.io/apimachinery/pkg/api/resource.
type ResourceListFacts struct {
	CPU              *resource.Quantity
	Memory           *resource.Quantity
	Storage          *resource.Quantity
	EphemeralStorage *resource.Quantity
	Pods             *resource.Quantity
	// Extended resource map presence distinguishes absence from a zero quantity.
	ExtendedResources map[string]resource.Quantity
}

type NodeAddress struct {
	Type    string
	Address string
}

type NodeSystemInfo struct {
	Architecture     string
	OperatingSystem  string
	OSImage          string
	KernelVersion    string
	ContainerRuntime string
	KubeletVersion   string
}

type TaintFacts struct {
	Key    string
	Value  string
	Effect string
}

type ContainerFacts struct {
	Name            string
	Image           string
	ImagePullPolicy string
	Ready           bool
	RestartCount    int32
	State           ContainerState
	Reason          string
	Message         string
	StartedAt       *time.Time
	Ports           []ContainerPortFacts
	VolumeMounts    []string
	Environment     []EnvVarFacts
	Command          []string
	Args             []string
	Requests         ResourceListFacts
	Limits           ResourceListFacts
}

type ContainerState string

const (
	ContainerStateWaiting    ContainerState = "waiting"
	ContainerStateRunning    ContainerState = "running"
	ContainerStateTerminated ContainerState = "terminated"
	ContainerStateUnknown    ContainerState = "unknown"
)

type EnvVarFacts struct {
	Name                string
	Value               string
	ValueFromRef        *ResourceLink
	ValueFromKey        string
	ValueFromFieldPath  string
	ValueFromResource   string
	Optional            *bool
}

type ContainerPortFacts struct {
	Name          string
	ContainerPort int32
	Protocol      string
}

type VolumeFacts struct {
	Name   string
	Type   string
	Source ResourceLink
}

type VolumeClaimTemplateFacts struct {
	Name         string
	StorageClass *ResourceLink
	AccessModes  []string
	Requests     ResourceListFacts
}

type PodMetricsSummary struct {
	ReadyPods int
	TotalPods int
	CPU       *resource.Quantity
	Memory    *resource.Quantity
}

type JobTemplateFacts struct {
	Labels                 map[string]string
	Annotations            map[string]string
	Containers             []ContainerFacts
	Completions            *int32
	Parallelism            *int32
	BackoffLimit           *int32
	ActiveDeadlineSeconds  *int64
	TTLSecondsAfterFinished *int32
}

type ServicePortFacts struct {
	Name       string
	Protocol   string
	Port       int32
	TargetPort string
	NodePort   int32
}

type EndpointAddressFacts struct {
	Address   string
	Node      *ResourceLink
	Pod       *ResourceLink
	TargetRef *ResourceLink
}

type EndpointPortFacts struct {
	Name     string
	Protocol string
	Port     int32
}

type IngressTLSFacts struct {
	Hosts      []string
	SecretRef  *ResourceLink
}

type IngressRuleFacts struct {
	Host  string
	Paths []IngressPathFacts
}

type IngressPathFacts struct {
	Path     string
	PathType string
	Backend  ResourceLink
}

type NetworkPolicyRuleFacts struct {
	Ports []NetworkPolicyPortFacts
	Peers []NetworkPolicyPeerFacts
}

type NetworkPolicyPortFacts struct {
	Protocol string
	// String because Kubernetes network policy ports may be numeric or named.
	Port     string
	EndPort   *int32
}

type NetworkPolicyPeerFacts struct {
	PodSelector       map[string]string
	NamespaceSelector map[string]string
	IPBlock           *IPBlockFacts
}

type IPBlockFacts struct {
	CIDR   string
	Except []string
}

type GatewayListenerFacts struct {
	Name       string
	Protocol   string
	Port       int32
	Hostname   string
	AttachedRoutes int32
	Conditions []ConditionFacts
}

type RouteRuleFacts struct {
	Matches  []string
	Filters  []string
	Backends []ResourceLink
}

type ReferenceGrantFromFacts struct {
	Group     string
	Kind      string
	Namespace string
}

type VolumeSourceFacts struct {
	Type       string
	Attributes map[string]string
}

type MetricFacts struct {
	Type            string
	ResourceName    string
	ContainerName   string
	MetricName      string
	DescribedObject *ResourceLink
	Selector        map[string]string
	Target          MetricTargetFacts
}

type MetricStatusFacts struct {
	Type            string
	ResourceName    string
	ContainerName   string
	MetricName      string
	DescribedObject *ResourceLink
	Selector        map[string]string
	Current         MetricCurrentFacts
}

type MetricTargetFacts struct {
	Type               string
	Value              *resource.Quantity
	AverageValue       *resource.Quantity
	AverageUtilization *int32
}

type MetricCurrentFacts struct {
	Value              *resource.Quantity
	AverageValue       *resource.Quantity
	AverageUtilization *int32
}

type ScalingBehaviorFacts struct {
	ScaleUp   *ScalingRulesFacts
	ScaleDown *ScalingRulesFacts
}

type ScalingRulesFacts struct {
	StabilizationWindowSeconds *int32
	SelectPolicy               string
	Policies                   []string
}

type ScopeSelectorFacts struct {
	MatchExpressions []ScopeSelectorRequirementFacts
}

type ScopeSelectorRequirementFacts struct {
	ScopeName string
	Operator  string
	Values    []string
}

type LimitRangeItemFacts struct {
	Type                 string
	Max                  map[string]string
	Min                  map[string]string
	Default              map[string]string
	DefaultRequest       map[string]string
	MaxLimitRequestRatio map[string]string
}

type PolicyRuleFacts struct {
	APIGroups     []string
	Resources     []string
	ResourceNames []string
	Verbs         []string
	NonResourceURLs []string
}

type AggregationRuleFacts struct {
	ClusterRoleSelectors []map[string]string
}

type SubjectFacts struct {
	Kind      string
	APIGroup  string
	Namespace string
	Name      string
	Ref       *ResourceLink
}

type CRDNamesFacts struct {
	Plural     string
	Singular   string
	Kind       string
	ListKind   string
	ShortNames []string
	Categories []string
}

type CRDVersionFacts struct {
	Name       string
	Served     bool
	Storage    bool
	Deprecated bool
}

type WebhookFacts struct {
	Name                    string
	AdmissionReviewVersions []string
	SideEffects             string
	FailurePolicy           string
	MatchPolicy             string
	TimeoutSeconds          int32
	ClientService           *ResourceLink
	CABundleConfigured      bool
	Rules                   []WebhookRuleFacts
	NamespaceSelector       map[string]string
	ObjectSelector          map[string]string
	Conditions              []ConditionFacts
}

type MutatingWebhookFacts struct {
	WebhookFacts
	ReinvocationPolicy string
}

type ValidatingWebhookFacts struct {
	WebhookFacts
}

type WebhookRuleFacts struct {
	Operations  []string
	APIGroups   []string
	APIVersions []string
	Resources   []string
	Scope       string
}

type HelmRevisionFacts struct {
	Revision    int
	Updated     *time.Time
	Status      string
	Chart       string
	AppVersion  string
	Description string
}

type ConditionsSummaryFacts struct {
	Accepted   *ConditionFacts
	Programmed *ConditionFacts
	Ready      *ConditionFacts
	Resolved   *ConditionFacts
}

type TopologySelectorFacts struct {
	MatchLabelExpressions []TopologyLabelRequirementFacts
}

type TopologyLabelRequirementFacts struct {
	Key    string
	Values []string
}
```

### Namespace

Applies to `Namespace`.

```go
type NamespaceFacts struct {
	RawPhase       string
	WorkloadState  NamespaceWorkloadState
	ResourceQuotas []ResourceLink
	LimitRanges    []ResourceLink
}

type NamespaceWorkloadState string

const (
	NamespaceWorkloadStateUnknown NamespaceWorkloadState = "unknown"
	NamespaceWorkloadStateNone    NamespaceWorkloadState = "none"
	NamespaceWorkloadStatePresent NamespaceWorkloadState = "present"
)
```

### Node

Applies to `Node`.

```go
type NodeFacts struct {
	Roles          []string
	Unschedulable bool
	Addresses      []NodeAddress
	SystemInfo     NodeSystemInfo
	Capacity       ResourceListFacts
	Allocatable    ResourceListFacts
	Requests       ResourceListFacts
	Limits         ResourceListFacts
	Usage          ResourceListFacts
	PodCount       int
	PodCapacity    int64
	RestartCount   int32
	Conditions     []ConditionFacts
	Taints         []TaintFacts
	Pods           []ResourceLink
}
```

### Pod

Applies to `Pod`.

```go
type PodFacts struct {
	RawPhase         string
	ReadyContainers  int
	TotalContainers  int
	RestartCount     int32
	Node              *ResourceLink
	Owner             *ResourceLink
	ServiceAccount    *ResourceLink
	PodIP             string
	HostIP            string
	QOSClass          string
	Priority          *int32
	PriorityClassName string
	RestartPolicy     string
	DNSPolicy          string
	SchedulerName      string
	RuntimeClass       string
	HostNetwork        bool
	HostPID            bool
	HostIPC            bool
	Containers        []ContainerFacts
	InitContainers    []ContainerFacts
	Volumes           []VolumeFacts
	Tolerations       []TolerationFacts
	Conditions        []ConditionFacts
}
```

`RawPhase` fields preserve Kubernetes API phase values for detail display and
debugging. Consumers must use `ResourceModel.Status` for primary status labels,
sorting, filtering, and severity instead of reinterpreting raw phase values.

### Workload Controllers

Applies to `Deployment`, `StatefulSet`, `DaemonSet`, and `ReplicaSet`.
These controllers share pod-template and pod-ownership semantics, but they do
not have the same operational model. Use a shared common struct plus explicit
per-kind facts.

```go
type WorkloadCommonFacts struct {
	Selector           map[string]string
	DesiredPods        int32
	ReadyPods          int32
	AvailablePods      int32
	RestartCount       int32
	Pods               []ResourceLink
	PodMetrics         PodMetricsSummary
	Containers         []ContainerFacts
	InitContainers     []ContainerFacts
	NodeSelector       map[string]string
	Tolerations        []TolerationFacts
	ServiceAccount     *ResourceLink
	Conditions         []ConditionFacts
	ObservedGeneration int64
	MinReadySeconds    int32
}

type DeploymentFacts struct {
	WorkloadCommonFacts
	Strategy             string
	MaxSurge             string
	MaxUnavailable       string
	Paused               bool
	ProgressDeadline     int32
	RevisionHistoryLimit int32
	UpdatedReplicas      int32
	UnavailableReplicas  int32
	CurrentReplicaSet    *ResourceLink
	ReplicaSets          []ResourceLink
	ReplicaSetSummaries  []ReplicaSetSummaryFacts
	RolloutStatus        string
	RolloutMessage       string
}

type StatefulSetFacts struct {
	WorkloadCommonFacts
	Service                    *ResourceLink
	UpdateStrategy             string
	Partition                  *int32
	MaxUnavailable             string
	PodManagementPolicy        string
	RevisionHistoryLimit       int32
	CurrentRevision            string
	UpdateRevision             string
	CurrentReplicas            int32
	UpdatedReplicas            int32
	CollisionCount             *int32
	PVCRetentionPolicy         map[string]string
	VolumeClaimTemplates       []VolumeClaimTemplateFacts
}

type DaemonSetFacts struct {
	WorkloadCommonFacts
	UpdateStrategy       string
	MaxUnavailable       string
	MaxSurge             string
	DesiredScheduled     int32
	CurrentScheduled     int32
	ReadyScheduled       int32
	AvailableScheduled   int32
	UpdatedScheduled     int32
	NumberMisscheduled   int32
	CollisionCount       *int32
}

type ReplicaSetFacts struct {
	WorkloadCommonFacts
	DesiredReplicas      int32
	ReadyReplicas        int32
	AvailableReplicas    int32
	FullyLabeledReplicas int32
	ControlledBy         *ResourceLink
	Revision             string
	IsActive             bool
}

type ReplicaSetSummaryFacts struct {
	Ref       ResourceLink
	Revision  string
	Replicas  string
	Ready     string
	Available string
}

type TolerationFacts struct {
	Key               string
	Operator          string
	Value             string
	Effect            string
	TolerationSeconds *int64
}
```

### Jobs

Applies to `Job`.

```go
type JobFacts struct {
	Selector          map[string]string
	Parallelism       *int32
	Completions       *int32
	Succeeded         int32
	Failed            int32
	Active            int32
	Suspended         bool
	StartTime         *time.Time
	CompletionTime    *time.Time
	Duration          string
	Conditions        []ConditionFacts
	Pods              []ResourceLink
	ControlledBy      *ResourceLink
}
```

### CronJobs

Applies to `CronJob`.

```go
type CronJobFacts struct {
	Schedule            string
	TimeZone            string
	Suspended           bool
	ActiveJobs          []ResourceLink
	LastScheduleTime    *time.Time
	LastSuccessfulTime  *time.Time
	ConcurrencyPolicy   string
	SuccessfulJobsHistoryLimit *int32
	FailedJobsHistoryLimit     *int32
	JobTemplate         JobTemplateFacts
}
```

### Config

Applies to `ConfigMap` and `Secret`.

```go
type ConfigMapFacts struct {
	DataKeys       []string
	BinaryDataKeys []string
	DataCount      int
	DataSizeBytes int64
	UsedBy        []ResourceLink
}

type SecretFacts struct {
	Type          string
	DataKeys      []string
	DataCount     int
	DataSizeBytes int64
	Immutable     *bool
	UsedBy        []ResourceLink
}
```

### Network

Applies to `Service`, `EndpointSlice`, `Ingress`, `IngressClass`, and
`NetworkPolicy`.

```go
type ServiceFacts struct {
	Type                   string
	ClusterIP              string
	ClusterIPs             []string
	ExternalIPs            []string
	LoadBalancerIP         string
	LoadBalancerIPs        []string
	LoadBalancerStatus     []string
	ExternalName           string
	Ports                  []ServicePortFacts
	SessionAffinity        string
	SessionAffinityTimeout int32
	Selector               map[string]string
	Endpoints              []ResourceLink
	EndpointCount          int
	HealthStatus           string
}

type EndpointSliceFacts struct {
	AddressType    string
	ReadyAddresses []EndpointAddressFacts
	NotReadyAddresses []EndpointAddressFacts
	Ports          []EndpointPortFacts
	Service        *ResourceLink
}

type IngressFacts struct {
	ClassName      string
	Class          *ResourceLink
	Hosts          []string
	Addresses      []string
	TLS            []IngressTLSFacts
	Rules          []IngressRuleFacts
	DefaultBackend *ResourceLink
}

type IngressClassFacts struct {
	Controller string
	Parameters *ResourceLink
	Default    bool
}

type NetworkPolicyFacts struct {
	PodSelector map[string]string
	PolicyTypes []string
	IngressRules []NetworkPolicyRuleFacts
	EgressRules  []NetworkPolicyRuleFacts
}
```

### Gateway API

Applies to `GatewayClass`, `Gateway`, `ListenerSet`, `HTTPRoute`, `GRPCRoute`,
`TLSRoute`, `ReferenceGrant`, and `BackendTLSPolicy`.
The route kinds share parent/backend/status behavior, but each kind should still
have an explicit facts type so future route-specific fields do not get hidden in
one generic route bucket.

```go
type GatewayClassFacts struct {
	ControllerName string
	Parameters     *ResourceLink
	UsedBy         []ResourceLink
	Accepted       bool
	Conditions     []ConditionFacts
	Summary        ConditionsSummaryFacts
}

type GatewayFacts struct {
	Class       *ResourceLink
	Addresses   []string
	Listeners   []GatewayListenerFacts
	Conditions  []ConditionFacts
	Summary     ConditionsSummaryFacts
}

type ListenerSetFacts struct {
	ParentRef  ResourceLink
	Listeners  []GatewayListenerFacts
	Conditions []ConditionFacts
	Summary    ConditionsSummaryFacts
}

type RouteCommonFacts struct {
	ParentRefs []ResourceLink
	Hostnames  []string
	Rules      []RouteRuleFacts
	Backends   []ResourceLink
	Conditions []ConditionFacts
	Summary    ConditionsSummaryFacts
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
	From []ReferenceGrantFromFacts
	To   []ResourceLink
}

type BackendTLSPolicyFacts struct {
	TargetRefs []ResourceLink
	Conditions []ConditionFacts
	Summary    ConditionsSummaryFacts
}
```

### Storage

Applies to `PersistentVolume`, `PersistentVolumeClaim`, and `StorageClass`.

```go
type PersistentVolumeFacts struct {
	RawPhase       string
	Capacity       ResourceListFacts
	AccessModes    []string
	ReclaimPolicy  string
	StorageClass   *ResourceLink
	Claim          *ResourceLink
	VolumeMode     string
	Source         VolumeSourceFacts
	MountOptions   []string
	NodeAffinity   []string
	Conditions     []ConditionFacts
}

type PersistentVolumeClaimFacts struct {
	RawPhase     string
	Requested    ResourceListFacts
	Capacity     ResourceListFacts
	AccessModes  []string
	Volume       *ResourceLink
	StorageClass *ResourceLink
	VolumeMode   string
	Selector     map[string]string
	Conditions   []ConditionFacts
	DataSource    *ResourceLink
	MountedBy     []ResourceLink
}

type StorageClassFacts struct {
	Provisioner          string
	Parameters           map[string]string
	ReclaimPolicy        string
	VolumeBindingMode    string
	AllowVolumeExpansion *bool
	MountOptions         []string
	AllowedTopologies    []TopologySelectorFacts
	PersistentVolumes    []ResourceLink
	Default              bool
}
```

### Autoscaling And Policy

Applies to `HorizontalPodAutoscaler`, `PodDisruptionBudget`, `ResourceQuota`,
and `LimitRange`.

```go
type HorizontalPodAutoscalerFacts struct {
	ScaleTarget     ResourceLink
	MinReplicas     *int32
	MaxReplicas     int32
	CurrentReplicas int32
	DesiredReplicas int32
	Metrics         []MetricFacts
	CurrentMetrics  []MetricStatusFacts
	Behavior        *ScalingBehaviorFacts
	Conditions      []ConditionFacts
	LastScaleTime   *time.Time
}

type PodDisruptionBudgetFacts struct {
	Selector             map[string]string
	MinAvailable         string
	MaxUnavailable       string
	AllowedDisruptions   int32
	CurrentHealthy       int32
	DesiredHealthy       int32
	ExpectedPods         int32
	DisruptedPods        []ResourceLink
	Conditions           []ConditionFacts
	ObservedGeneration   int64
}

type ResourceQuotaFacts struct {
	Hard           map[string]string
	Used           map[string]string
	UsedPercentage map[string]int
	Scopes         []string
	ScopeSelector  ScopeSelectorFacts
}

type LimitRangeFacts struct {
	Limits []LimitRangeItemFacts
}
```

### RBAC

Applies to `Role`, `ClusterRole`, `RoleBinding`, `ClusterRoleBinding`, and
`ServiceAccount`.
Namespaced and cluster-scoped RBAC resources share rules and subjects, but they
should remain distinct facts types because their references, reverse links, and
scope semantics differ.

```go
type RoleFacts struct {
	Rules              []PolicyRuleFacts
	UsedByRoleBindings []ResourceLink
}

type ClusterRoleFacts struct {
	Rules               []PolicyRuleFacts
	AggregationRule     *AggregationRuleFacts
	ClusterRoleBindings []ResourceLink
	RoleBindings        []ResourceLink
}

type RoleBindingFacts struct {
	RoleRef  ResourceLink
	Subjects []SubjectFacts
}

type ClusterRoleBindingFacts struct {
	RoleRef  ResourceLink
	Subjects []SubjectFacts
}

type ServiceAccountFacts struct {
	Secrets             []ResourceLink
	ImagePullSecrets    []ResourceLink
	AutomountToken      *bool
	UsedByPods          []ResourceLink
	RoleBindings        []ResourceLink
	ClusterRoleBindings []ResourceLink
}
```

### API Extensions And Admission

Applies to `CustomResourceDefinition`, `MutatingWebhookConfiguration`, and
`ValidatingWebhookConfiguration`.
Mutating and validating webhook configurations share most transport fields, but
mutating webhooks have mutating-specific behavior such as reinvocation policy.
Keep the configuration facts explicit per kind.

```go
type CustomResourceDefinitionFacts struct {
	Group              string
	Scope              string
	Names              CRDNamesFacts
	Versions           []CRDVersionFacts
	ConversionStrategy string
	Conditions         []ConditionFacts
}

type MutatingWebhookConfigurationFacts struct {
	Webhooks []MutatingWebhookFacts
}

type ValidatingWebhookConfigurationFacts struct {
	Webhooks []ValidatingWebhookFacts
}
```

### Helm

Applies to `helmrelease`.

```go
type HelmReleaseFacts struct {
	TypeAlias   string
	Chart       string
	Version     string
	AppVersion  string
	Revision    int
	Status      string
	Updated     *time.Time
	Description string
	Resources   []ResourceLink
	History     []HelmRevisionFacts
}
```

### Events

Applies to `Event`.

```go
type EventFacts struct {
	Name                string
	UID                 string
	ResourceVersion     string
	Type                string
	Reason              string
	Message             string
	Count               int32
	FirstTimestamp      *time.Time
	LastTimestamp       *time.Time
	EventTime           *time.Time
	InvolvedObject      ResourceLink
	ReportingController string
	ReportingInstance   string
}
```

### Custom Resources And Generic Fallback

Applies to custom resources and any known kind without a typed facts model yet.

```go
type CustomResourceFacts struct {
	APIVersion string
	Plural     string
	Scope      string
	Conditions []ConditionFacts
}
```

`CustomResourceFacts` is the generic fallback for custom resources and known
kinds that have not been promoted to an explicit facts type. Raw custom-resource
spec/status payloads are detail-only data. The shared model should extract only
semantic status conventions it owns, such as conditions, phase/state labels,
ready markers, and observed generation.

Generic fallback resources still need the common `ResourceModel` fields. They
should not be allowed to drop `clusterId`, `group`, `version`, or `kind` just
because no typed facts model exists yet.

## Open Modeling Risks To Resolve

The catalog above is a target model, not an implementation-ready schema freeze.
Before implementing each resource family, the migration must explicitly resolve
these risks.

### Real Objects vs Synthetic App Resources

Most entries represent Kubernetes API objects. `helmrelease` is app-synthetic:
it is derived from Helm storage records and may point at manifest resources that
are not all resolvable in the current cluster. Synthetic resources still need a
stable `ResourceRef`, but the model must mark their source and avoid pretending
they are ordinary Kubernetes GVKs.

Use this canonical identity for Helm releases in the shared model:

```go
ResourceRef{
	Group:    "luxury-yacht.io",
	Version:  "v1alpha1",
	Kind:     "HelmRelease",
	Resource: "helmreleases",
	Namespace: releaseNamespace,
	Name:      releaseName,
}
```

Legacy frontend values such as lowercase `helmrelease` should be treated as
view compatibility concerns during migration, not as the canonical identity of
the shared model.

### Openable References vs Display-Only References

Many relationships are not guaranteed to be openable:

- Gateway API refs can omit names or use custom groups.
- RBAC subjects can be users or groups, not Kubernetes objects.
- owner references may point to CRDs or deleted objects.
- Helm manifest resources may be absent from the current cluster.
- event involved objects may be partial or stale.

Those must use `ResourceLink` with either a full `ResourceRef` or a `DisplayRef`.
No builder should synthesize a fake fully-qualified object reference just to make
navigation easier.

### Custom Resource Status

`CustomResourceFacts` cannot treat raw status as shared semantics. It needs
explicit, tested extraction rules for common conventions:

- `status.conditions[]`
- `status.phase`
- `status.state`
- `status.ready`
- `status.observedGeneration`

When a CRD has no known convention, the shared model should produce an `unknown`
or neutral status presentation rather than guessing. Raw status remains
detail-only data for inspection workflows.

### Reverse-Link Derivation

Reverse links such as `ConfigMapFacts.UsedBy`, `SecretFacts.UsedBy`,
`ServiceAccountFacts.UsedByPods`, `PersistentVolumeClaimFacts.MountedBy`,
workload pod lists, node pod lists, and RBAC reverse bindings must not be
computed by ad hoc N-by-M scans in every builder.

Before Phase 2 starts, add a shared relationship index for each refresh build or
streaming update batch. The index should be built once from informers/catalog
summaries available in that cluster context and then passed to resource model
builders. Builders may add direct forward links from their own object, but
reverse-link fields must come from the shared index.

The index should preserve `ResourceLink` semantics:

- use openable `ResourceRef` only when the catalog or typed object provides full
  `clusterId`, `group`, `version`, `kind`, namespace, and name
- use `DisplayRef` for unresolved, external, deleted, or partial references
- expose cache/version metadata so refresh diagnostics can identify stale
  relationship data

### Capability Facts

Capabilities are not just static booleans. They can depend on RBAC, resource
state, selected action options, active operations, and discovery availability.
The model must preserve the checks and failure reasons needed by Diagnostics so
the UI does not show buttons that are disconnected from permission state.

### Consumer Coverage Matrix

For each supported GVK, implementation should record which consumers use the
model:

- namespace table
- cluster table
- object-panel Details
- object map
- events
- action menus
- logs/exec/port-forward flows

This prevents a resource from being marked migrated while one surface still
derives the same semantics independently.

### Versioning And Rollout

The shared model will affect Wails-generated TypeScript types and multiple
refresh payloads. Each migration phase needs an explicit compatibility decision:
either migrate all consumers for that resource family in one change or keep any
temporary fields private to the phase and remove them before calling the phase
complete.

Phase 1 must lock the TypeScript facts shape and document it in
`frontend/AGENTS.md` or a linked development note before any resource family
migrates. The decision should cover whether facts are exposed as a discriminated
payload or an `omitempty` union and how frontend consumers narrow the type.

## Consumer Responsibilities

### Shared Resource Model Layer

The shared resource model layer owns Kubernetes semantics:

- node ready, not-ready, unknown, and cordoned interpretation
- pod phase, waiting/terminated reason, readiness, and restart interpretation
- workload ready/degraded/paused/progress-deadline interpretation
- job and cronjob complete, failed, suspended, running, pending interpretation
- PV/PVC bound, pending, released, failed, and lost interpretation
- service and ingress address readiness
- owner and relationship references
- shared capability facts that come from resource state

### Table Builders

Table builders should select table-specific fields from shared resource models.

They may still add fields that are genuinely table-specific, such as:

- compact metric strings
- aggregate resource usage
- table-oriented counts
- sort-friendly values

They should not rederive primary status, ownership identity, or relationships
when those are already available from the shared resource model.

### Detail Builders

Detail builders should select detail-specific fields from shared resource
models.

They may still add fields that are genuinely detail-only because they are large,
raw, sensitive, or tied to a specific tab workflow, such as:

- raw YAML
- decoded Secret values where explicitly allowed by the detail view
- event summaries
- Helm values, manifests, notes, and revision history bodies
- log/exec/port-forward discovery payloads
- unstructured raw status for custom resources

They should use the shared resource model for identity, metadata, primary
status, relationships, and common semantic facts. If a detail view needs a
condition, container, storage, network, or relationship fact already represented
by the shared model, it should select that fact instead of re-deriving it.

### Object Map Builders

Object-map builders should use shared resource models for:

- object references
- status presentation
- creation timestamp
- labels
- relationship references

They may still own graph traversal, graph filtering, deduplication, and edge
construction mechanics.

### Frontend

The frontend should render app models.

It should own:

- table layout
- panel layout
- sorting and filtering interaction
- badge/chip rendering
- menus and click behavior

It should not independently reinterpret Kubernetes semantics such as:

- whether a node is cordoned
- whether a pod is degraded
- whether a workload rollout is unhealthy
- whether a PVC state should be warning or error

## Migration Strategy

Migrate by resource family, deleting duplicated semantic logic as each family is
completed.

### Phase 1: Shared Model Foundation

- [ ] Add shared resource model types.
- [ ] Add canonical object reference type usage with `clusterId`, `group`,
      `version`, `kind`, `namespace`, and `name`.
- [ ] Add shared status presentation type.
- [ ] Add `ResourceLink` constructors and validation.
- [ ] Add object-catalog-backed reference resolution helpers.
- [ ] Add contextual capability model types outside `ResourceModel`.
- [ ] Add an explicit facts slot for every supported GVK and allow shared
      structs only for common substructure.
- [ ] Decide and document the Wails/TypeScript facts shape.
- [ ] Add the shared reverse-link index strategy and tests.
- [ ] Add tests for shared model identity and status invariants.

### Phase 2: Nodes

- [ ] Add node shared resource model.
- [ ] Move node status interpretation into the shared resource model layer.
- [ ] Use node shared resource model from node table snapshot builder.
- [ ] Use node shared resource model from node detail builder.
- [ ] Use node shared resource model from object-map node builder.
- [ ] Remove duplicated node status derivation from the migrated paths.
- [ ] Add tests for ready, not-ready, unknown, unschedulable, and
      unschedulable-taint nodes.
- [ ] Add table/detail/object-map parity tests for node status.

### Phase 3: Pods

- [ ] Add pod shared resource model.
- [ ] Centralize pod display status logic, including waiting and terminated
      container reasons.
- [ ] Use pod shared resource model from pod table snapshot builders.
- [ ] Use pod shared resource model from pod detail builders.
- [ ] Use pod shared resource model from object-map pod builder.
- [ ] Remove duplicated pod status helpers from migrated paths.
- [ ] Add tests for running, pending, succeeded, failed, crashloop, image pull,
      terminating, and readiness mismatch cases.

### Phase 4: Workloads

- [ ] Add shared resource models for Deployment, StatefulSet, DaemonSet,
      ReplicaSet, Job, and CronJob.
- [ ] Centralize ready/degraded/paused/progress interpretation.
- [ ] Use workload shared resource models from namespace workload tables.
- [ ] Use workload shared resource models from object-panel detail builders.
- [ ] Use workload shared resource models from object-map builders.
- [ ] Add parity tests for primary workload status.

### Phase 5: Storage

- [ ] Add shared resource models for PersistentVolumeClaim, PersistentVolume, and
      StorageClass.
- [ ] Centralize bound, pending, released, failed, lost, and default-class
      interpretation.
- [ ] Use storage shared resource models from table, detail, and object-map
      paths.
- [ ] Add parity tests for primary storage status.

### Phase 6: Config

- [ ] Add shared resource models for ConfigMap and Secret.
- [ ] Keep Secret values out of shared facts; expose only keys/count/type and
      explicit detail-only access.
- [ ] Centralize ConfigMap/Secret usage relationships through `ResourceLink`.
- [ ] Use config shared resource models from table, detail, and object-map
      paths.
- [ ] Add parity tests for config identity, usage links, and status.

### Phase 7: Network

- [ ] Add shared resource models for Service, EndpointSlice, Ingress,
      IngressClass, and NetworkPolicy.
- [ ] Centralize service endpoint readiness, ingress address readiness, backend
      links, class links, and network policy selectors.
- [ ] Use network shared resource models from table, detail, and object-map
      paths where applicable.
- [ ] Add parity tests for network identity, primary status, and relationship
      links.

### Phase 8: Gateway API

- [ ] Add shared resource models for GatewayClass, Gateway, HTTPRoute,
      GRPCRoute, TLSRoute, ListenerSet, ReferenceGrant, and BackendTLSPolicy.
- [ ] Centralize Gateway API conditions, summaries, parent refs, backend refs,
      target refs, and display-only reference handling.
- [ ] Use Gateway API shared resource models from table and detail paths.
- [ ] Add parity tests for status summaries and `ResourceLink` behavior.

### Phase 9: RBAC

- [ ] Add shared resource models for Role, ClusterRole, RoleBinding,
      ClusterRoleBinding, and ServiceAccount.
- [ ] Centralize role refs, subjects, aggregation rules, service account
      reverse links, and display-only user/group subjects.
- [ ] Use RBAC shared resource models from namespace/cluster tables, detail
      paths, and object-map paths where applicable.
- [ ] Add tests for namespaced vs cluster-scoped references.

### Phase 10: Policy And Autoscaling

- [ ] Add shared resource models for HorizontalPodAutoscaler,
      PodDisruptionBudget, ResourceQuota, and LimitRange.
- [ ] Centralize scale target references, metric facts, PDB disruption facts,
      quota usage facts, and limit range facts.
- [ ] Use policy/autoscaling shared resource models from table, detail, and
      object-map paths where applicable.
- [ ] Add tests for scale target GVK resolution and display-only fallbacks.

### Phase 11: API Extensions And Admission

- [ ] Add shared resource models for CustomResourceDefinition,
      MutatingWebhookConfiguration, and ValidatingWebhookConfiguration.
- [ ] Centralize CRD version/schema/condition facts and webhook rule/client
      reference facts.
- [ ] Use API extension/admission shared resource models from cluster tables and
      detail paths.
- [ ] Add tests for webhook service links and CRD version facts.

### Phase 12: Helm, Events, And Custom Resources

- [ ] Add shared resource model support for HelmRelease synthetic refs.
- [ ] Add shared resource model support for Event involved-object links.
- [ ] Add custom resource fallback extraction for conditions, phase, state,
      ready, and observedGeneration.
- [ ] Use these models from Helm, event, custom-resource, generic detail, and
      object-content paths where applicable.
- [ ] Add tests for synthetic Helm identity, stale/partial event references, and
      custom-resource status extraction.

### Phase 13: Frontend Semantic Cleanup

- [ ] Remove migrated frontend status interpretation helpers.
- [ ] Replace per-surface status class derivation with state-to-UI rendering.
- [ ] Verify action menus, diagnostics, logs, exec, and port-forward flows use
      shared identity and contextual capabilities.
- [ ] Add regression tests for table/detail/object-map parity where each
      consumer exists.

## Testing Requirements

Each migrated resource family should include:

- unit tests for the shared resource model builder
- tests proving full object identity is preserved
- tests for important Kubernetes edge cases
- a consumer coverage matrix showing which of table, detail, object map, events,
  actions, logs, exec, and port-forward apply to each migrated GVK
- parity tests proving applicable consumers select the same primary status
  presentation from the shared resource model
- tests proving `ResourceLink` values are either openable refs or display-only
  refs, never ambiguous hybrids
- tests proving contextual capabilities preserve RBAC checks, discovery errors,
  option-dependent failures, and in-flight operation state

Regression tests should specifically prevent per-surface status drift from
returning.

## Acceptance Criteria

- Kubernetes resource semantics live in backend shared resource model builders, not in
  frontend table or panel components.
- Table, detail, and object-map payloads for migrated resources derive shared
  identity and primary status from the same shared resource model.
- Every supported GVK has an explicit facts type or generic custom-resource
  fallback; no distinct resource kinds are hidden behind one overly broad facts
  struct.
- Every openable `ResourceRef` produced by the shared resource model includes
  `clusterId`, `group`, `version`, and `kind`, plus `namespace` and `name` when
  object-specific.
- Display-only references preserve all identity fields supplied by the source
  object and are never presented as openable navigation targets.
- Resource quantities remain semantic in the shared model and are formatted only
  by consumer DTO builders.
- Secret values are not exposed through shared facts.
- Capabilities are produced by contextual capability builders, not embedded in
  intrinsic resource facts.
- Reverse links are computed through a shared relationship index, not repeated
  per-builder scans.
- Table/detail/map projection of the shared model has no measurable refresh
  latency regression against the largest cluster fixture used by prerelease
  quality checks.
- Duplicated semantic helpers are removed as each resource family migrates.
- Existing table, detail, and object-map UI behavior is preserved except where
  behavior is intentionally corrected for consistency.
- Frontend components render status states supplied by backend app models rather
  than reinterpreting Kubernetes object fields.
- `mage qc:prerelease` passes after implementation work.
- `mage qc:knip` passes after implementation work.

## Rollout Notes

This should be implemented as a deliberate backend simplification, not as a
visual redesign. Each phase should leave the migrated resource family complete:
shared resource model in place, consumers wired to it, old duplicated logic
removed, and parity tests added.

The implementation should avoid temporary dual paths. During a phase, short-lived
local work-in-progress is acceptable, but no migrated resource family should be
presented as complete while table, detail, and object-map consumers still derive
the same semantics independently.
