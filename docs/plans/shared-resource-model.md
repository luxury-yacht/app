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

The Kubernetes plural resource name is descriptor metadata, not the minimum
navigation identity. Include `resource` when the catalog or discovery has
resolved it, and require it for RBAC permission attributes. Do not make openable
object navigation depend on a guessed plural when `clusterId`, GVK, namespace,
and name are already sufficient to resolve safely through the catalog or strict
GVK resolver.

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

`State` should preserve the authoritative Kubernetes source status or phase
selected by that resource's status builder. For example, Node uses the
`NodeReady` condition status values `True`, `False`, and `Unknown`, and PVC/PV
models should use their Kubernetes phase values when those resource families
migrate. The shared model may still choose a user-facing `Label`, such as
`Ready (Cordoned)`, but it must not replace Kubernetes source values with an
invented app health vocabulary.

`Presentation` is a separate backend-owned rendering token for migrated
resources whose visual treatment cannot safely be inferred from `State`. For
example, a deleting Node can have `State: "True"` because the last `NodeReady`
condition is still true, while `Presentation: "terminating"` tells every
frontend surface to render the same terminating treatment. Frontend components
may pass `Presentation` through to CSS or renderer color lookup, but they must
not inspect Kubernetes fields or reinterpret semantics themselves.

### Existing Identity Contracts

The shared resource model introduces a backend semantic identity, not an
unreviewed fourth app-wide navigation contract.

Current app boundaries already use several identity shapes:

- backend detail DTOs use `types.ObjectRef`, `types.DisplayRef`, and
  `types.RefOrDisplay`
- object-map payloads use `ObjectMapReference`
- frontend navigation uses `KubernetesObjectReference` plus the
  `objectIdentity` helpers
- catalog summaries use `objectcatalog.Summary`
- permission queries use GVK-aware permission descriptors

The shared model package should own the internal canonical shape and provide
small projection/adaptation helpers for these existing boundaries. A migration
phase may replace one of those exported shapes only when every consumer of that
shape is migrated in the same phase and the old shape is deleted. Until then,
resource builders must project from `ResourceModel` into the existing DTO
contract rather than emitting a new parallel wire contract.

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
  dynamic custom-resource handling unless promoted to explicit support later.

### Modeling Rules

For every resource family, decide the shared model from Kubernetes API
semantics, not from the current table or detail DTO shape.

Use this decision process:

- Start from the typed Kubernetes object and the object catalog GVK/GVR/scope.
- Put identity, metadata, lifecycle, primary status, owners, and relationships
  in common `ResourceModel` fields.
- Put durable, resource-specific Kubernetes semantics in that kind's facts type.
- Put large, raw, sensitive, tab-specific, or workflow-specific payloads in
  detail-only DTOs.
- Represent object relationships with `ResourceLink`; use `DisplayRef` when the
  source does not provide enough identity for safe navigation.
- Preserve semantic values such as quantities, int-or-string fields, conditions,
  refs, and typed action options until the final table/detail DTO formatting
  boundary.
- Reject a shared field when its only purpose is to mimic today's frontend
  display string.

The current backend detail structs are useful as an inventory of what users can
see today, but they are not the source of truth for the new model. When they
contain flattened strings, kind-only references, or large payloads, the shared
model should correct the shape and the consumer DTO should adapt.

### Concrete Node Example

Today the same node is represented differently depending on the consumer:

```go
// Cluster table row.
types.ClsNodeInfo{
	Kind:       "node",
	Name:       "ip-10-121-42-110",
	Status:     "Ready (Cordoned)",
	Roles:      "worker",
	Version:    "v1.35.2",
	InternalIP: "10.121.42.110",
	CPU:        "8",
	Memory:     "32Gi",
	Pods:       "28/110",
	Age:        "12d",
}

// Object-panel details.
types.NodeDetails{
	Kind:          "node",
	Name:          "ip-10-121-42-110",
	Status:        "Ready",
	Unschedulable: true,
	Roles:         "worker",
	Conditions:    []types.NodeCondition{{Kind: "Ready", Status: "True"}},
	PodsList:      []types.PodSimpleInfo{...},
}
```

The proposed shared model derives node meaning once:

```go
ResourceModel{
	Ref: ResourceRef{
		ClusterID: "fusionauth-dev-us-east-1",
		Group:     "",
		Version:   "v1",
		Kind:      "Node",
		Resource:  "nodes",
		Name:      "ip-10-121-42-110",
		UID:       "8f0f...",
	},
	Source: ResourceSourceKubernetes,
	Scope:  ResourceScopeCluster,
	Metadata: ResourceMetadata{
		CreationTimestamp: node.CreationTimestamp.Time,
		ResourceVersion:   node.ResourceVersion,
		Labels:            node.Labels,
		Annotations:       node.Annotations,
		Finalizers:        node.Finalizers,
	},
	Status: ResourceStatusPresentation{
		Label:        "Ready (Cordoned)",
		State:        "True", // Raw NodeReady condition status from the Kubernetes API.
		Presentation: "cordoned",
		Reason:       "Unschedulable",
		Signals: []ResourceStatusSignal{
			{Type: StatusSignalCondition, Name: "Ready", Status: "True"},
			{Type: StatusSignalResourceState, Name: "spec.unschedulable", Status: "true"},
		},
		Badges: []ResourceStatusBadge{
			{Text: "Cordoned", Status: "true"},
		},
	},
	Facts: ResourceFacts{
		Node: &NodeFacts{
			Roles:          []string{"worker"},
			Unschedulable: true,
			PodCount:       28,
			PodCapacity:    110,
			Conditions:     []ConditionFacts{{Type: "Ready", Status: "True"}},
		},
	},
}
```

The node table and object-panel details can still expose different DTOs, but
both select status from `ResourceModel.Status`. The table may format pod counts
as `28/110`; the detail panel may request `MaterializeChildLists` to render
pods. Neither should rederive whether the node is cordoned.

### Common Shape

Every Kubernetes object or app-synthetic resource represented by the app should
start from the same common shape.

```go
type ResourceModel struct {
	Ref       ResourceRef
	Source    ResourceSource
	Scope     ResourceScope
	Metadata  ResourceMetadata
	Status    ResourceStatusPresentation
	Owners    []ResourceLink
	Relations []ResourceRelation
	Facts     ResourceFacts
}

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

type ResourceRef struct {
	ClusterID string
	Group     string
	Version   string
	Kind      string
	Resource  string // Optional for navigation; required when catalog/RBAC needs a GVR.
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
	UID       string
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
	State              string // Raw source status/phase value, e.g. NodeReady=True.
	Presentation       string // Backend-owned rendering token, e.g. terminating.
	Reason             string
	Message            string
	ObservedGeneration int64
	Lifecycle          ResourceLifecycle
	Signals            []ResourceStatusSignal
	Badges             []ResourceStatusBadge
}

type ResourceLifecycle struct {
	Terminating        bool
	DeletionTimestamp  *time.Time
	FinalizerBlocked   bool
	FinalizerCount     int
	ObservedGeneration int64
}

type ResourceStatusSignal struct {
	Type               StatusSignalType
	Name               string
	Status             string
	Reason             string
	Message            string
	LastTransitionTime *time.Time
}

type StatusSignalType string

const (
	StatusSignalCondition       StatusSignalType = "condition"
	StatusSignalPhase           StatusSignalType = "phase"
	StatusSignalDeletion        StatusSignalType = "deletion"
	StatusSignalReadiness       StatusSignalType = "readiness"
	StatusSignalGeneration      StatusSignalType = "generation"
	StatusSignalResourceState   StatusSignalType = "resourceState"
	StatusSignalControllerState StatusSignalType = "controllerState"
)

type ResourceStatusBadge struct {
	Text   string
	Status string
}

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

`ResourceSource` distinguishes real Kubernetes API objects from app-synthetic
objects such as Helm releases. `ResourceScope` records the resolved catalog
scope and drives validation: namespaced resources must carry namespace when the
reference points to a concrete object, and cluster-scoped resources must not
invent one.

`ResourceRef.Resource` should be populated from catalog or discovery metadata
when available. It must not be guessed from `kind` just to satisfy a validator.
Openable references validate on `clusterId`, `group`, `version`, `kind`, and
scope-correct `namespace`/`name`; RBAC and discovery-facing projections validate
that `resource` is present before constructing Kubernetes authorization
attributes.

`ResourceStatusPresentation.Signals` should preserve the signals used to derive
the primary label and state. Consumers still render only the chosen
presentation, but tests can verify whether a status came from deletion state,
phase, readiness, generation, conditions, controller state, or resource-specific
signals such as `spec.unschedulable`.

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
	ActionOptions    ActionOptionFacts
}

type ActionOptionFacts struct {
	Drain      *DrainActionOptions
	DeletePods *DeletePodsActionOptions
	Scale      *ScaleActionOptions
	Restart    *RestartActionOptions
}

type DrainActionOptions struct {
	GracePeriodSeconds         *int
	TimeoutSeconds             *int
	IgnoreDaemonSets           bool
	DeleteEmptyDirData         bool
	Force                      bool
	DisableEviction            bool
	SkipWaitForPodsToTerminate bool
}

type DeletePodsActionOptions struct {
	GracePeriodSeconds *int
	Force              bool
}

type ScaleActionOptions struct {
	Replicas int32
}

type RestartActionOptions struct {
	Strategy string
}

type ActionID string

const (
	ActionViewDetails        ActionID = "view-details"
	ActionViewMap            ActionID = "view-map"
	ActionGoToTable          ActionID = "go-to-table"
	ActionDiff               ActionID = "diff"
	ActionViewInvolvedObject ActionID = "view-involved-object"
	ActionTriggerNow         ActionID = "trigger-now"
	ActionSuspend            ActionID = "suspend"
	ActionResume             ActionID = "resume"
	ActionRestart            ActionID = "restart"
	ActionRollback           ActionID = "rollback"
	ActionScale              ActionID = "scale"
	ActionScaleHPAManaged    ActionID = "scale-hpa-managed"
	ActionPortForward        ActionID = "port-forward"
	ActionCordon             ActionID = "cordon"
	ActionUncordon           ActionID = "uncordon"
	ActionDrain              ActionID = "drain"
	ActionDelete             ActionID = "delete"
)

type CapabilityFact struct {
	Allowed  bool
	InFlight bool
	Reason   string
	Error    string
	Checks   []CapabilityCheckFact
}

type CapabilityCheckFact struct {
	ID         string
	Ref        ResourceLink
	Attributes PermissionAttributes
	Allowed    bool
	Reason     string
	Error      string
}

type PermissionAttributes struct {
	ClusterID    string
	Namespace    string
	Name         string
	Group        string
	Version      string
	Resource     string
	Subresource  string
	Kind         string
	Verb         string
	Scope        ResourceScope
	NonResource  bool
	ResourcePath string
}
```

Capability builders may consume `ResourceModel`, but the shared resource model
must not embed capability facts directly. This keeps object semantics stable
while allowing permissions, diagnostics, active operations, and option-dependent
actions to change independently.

`ActionID` values for context menus must mirror the stable IDs in
`frontend/src/shared/actions/objectActionDescriptors.ts`. Capability-only IDs
used by the object panel, such as `view-yaml`, `edit-yaml`, `view-logs`,
`shell-exec-get`, `shell-exec-create`, `view-manifest`, and `view-values`,
should be preserved as `CapabilityCheckFact.ID` values unless they are promoted
to real object actions. Do not invent backend-only action names that require the
frontend to maintain a translation table.

`PermissionAttributes` intentionally mirrors Kubernetes authorization
attributes, including resource plural, subresource, namespace, name, verb, and
scope. This is required for operations such as `pods/eviction`, `pods/log`,
`pods/exec`, node patch/update, and namespaced deletes. Capability builders
must not reduce these checks to kind/verb pairs.

`ActionOptionFacts` is typed because options can change which checks are
required. For example, drain with eviction enabled needs `pods/eviction create`,
while drain with eviction disabled needs direct pod delete permissions. Adding a
new action option should extend the typed option model, not add another untyped
option branch.

`Reason` explains a known denial or disabled state, such as missing RBAC or an
in-flight operation. `Error` records a failed check, such as discovery or
permission-check transport failure. Consumers should show `Error` as diagnostic
failure context rather than treating it as a normal denial reason.

### Resource Facts Union

Resource-specific facts should stay typed. The shared model should not force all
objects into one fake universal structure.

Every supported GVK should eventually have an explicit facts slot as its
resource family migrates. Do not add unused facts slots merely to complete a
catalog up front. Shared structs are allowed only for genuinely common
substructure, such as pod-template facts, rules, subjects, ports, conditions,
metrics, and route common fields. A shared struct should not be the only shape
for multiple GVKs when those GVKs have different lifecycle, status,
relationship, or action semantics.

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

The internal Go model may use explicit facts structs. Wails-facing DTOs should
continue projecting into existing response shapes until a frontend consumer
needs shared facts directly. If a phase exposes facts through Wails, it must
avoid serializing dozens of null fields per object. Acceptable options:

- a discriminated facts payload such as `{kind: "Pod", pod: PodFacts}`
- a Go union with `json:",omitempty"` on every facts pointer and generated
  TypeScript types verified for ergonomic narrowing

Record that decision as an ADR-style note before the first Wails-exposed facts
payload lands. Do not let each builder invent its own exported facts shape.

### Fact Materialization Levels

The shared resource model must not make every consumer pay to build every fact.
Centralizing semantics is correct only if the model can be materialized at the
size each consumer needs.

Builders should accept explicit materialization options:

```go
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
```

The default table path should build identity, metadata, status, and summary
facts only. Detail paths may request container templates, child lists, and
detail facts. Object-map paths may request relationships without detail-heavy
payloads. Reverse links must be explicitly requested and served from the shared
relationship index.

The zero materialization value means identity, metadata, status, owners, and
direct relations only. Builders should expose a small helper such as
`Materialization.Has(MaterializeDetailFacts)` so call sites are readable and do
not hand-roll bit checks.

No implementation phase is complete until its migrated table, detail,
object-map, and streaming consumers are wired through explicit materialization
options where those consumers exist. This is what prevents the shared layer from
becoming a single centralized expensive detail builder.

### Sensitive And Large Field Boundaries

Shared facts are not automatically safe for every consumer. Builders must treat
the following as detail-only unless a phase explicitly documents and tests a
redacted summary projection:

- literal environment variable values
- command and args arrays
- Secret data and decoded Secret values
- storage provisioner parameters and CSI volume attributes
- cloud-provider volume handles, keyrings, and credential-like options
- raw YAML, raw spec, raw status, Helm manifests, Helm values, and notes
- webhook CA bundles or other certificate/key material

Summary and relationship materialization should expose references, names,
counts, sizes, types, conditions, and status signals. Detail materialization may
carry sensitive or large payloads only when the existing detail workflow already
surfaces them and the DTO keeps the same access controls and user intent.
Adding a field to a shared facts struct is not permission to include that field
in table refreshes, object-map payloads, or diagnostics snapshots.

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
	Environment     []EnvVarFacts // Detail-only unless values are redacted.
	Command          []string      // Detail-only.
	Args             []string      // Detail-only.
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
	LiteralValue        *string // Detail-only; omit from summary and relationship materialization.
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
	TargetPort IntOrStringFacts
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
	Backend  IngressBackendFacts
}

type IngressBackendFacts struct {
	Service  *IngressServiceBackendFacts
	Resource *ResourceLink
}

type IngressServiceBackendFacts struct {
	Service ResourceLink
	Port    ServiceBackendPortFacts
}

type ServiceBackendPortFacts struct {
	Name   string
	Number int32
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
	Matches  []RouteMatchFacts
	Filters  []RouteFilterFacts
	Backends []RouteBackendFacts
}

type RouteMatchFacts struct {
	Path        *RoutePathMatchFacts
	Headers     []RouteHeaderMatchFacts
	QueryParams []RouteHeaderMatchFacts
	Method      string
	GRPCService string
	GRPCMethod  string
}

type RoutePathMatchFacts struct {
	Type  string
	Value string
}

type RouteHeaderMatchFacts struct {
	Name  string
	Type  string
	Value string
}

type RouteFilterFacts struct {
	Type               string
	RequestHeaderMods  *HeaderModifierFacts
	ResponseHeaderMods *HeaderModifierFacts
	RequestRedirect    *RequestRedirectFacts
	URLRewrite         *URLRewriteFacts
	RequestMirror      *RouteBackendFacts
	ExtensionRef       *ResourceLink
}

type HeaderModifierFacts struct {
	Set    map[string]string
	Add    map[string]string
	Remove []string
}

type RequestRedirectFacts struct {
	Scheme     string
	Hostname   string
	Path       *RoutePathMatchFacts
	Port       *int32
	StatusCode *int
}

type URLRewriteFacts struct {
	Hostname string
	Path     *RoutePathMatchFacts
}

type RouteBackendFacts struct {
	Ref    ResourceLink
	Port   *int32
	Weight *int32
}

type ReferenceGrantFromFacts struct {
	Group     string
	Kind      string
	Namespace string
}

type VolumeSourceFacts struct {
	Type                    string
	AWSElasticBlockStore    *AWSElasticBlockStoreFacts
	AzureDisk               *AzureDiskFacts
	AzureFile               *AzureFileFacts
	CSI                     *CSIVolumeSourceFacts
	FC                      *FCVolumeSourceFacts
	FlexVolume              *FlexVolumeSourceFacts
	GCEPersistentDisk       *GCEPersistentDiskFacts
	HostPath                *HostPathFacts
	ISCSI                   *ISCSIVolumeSourceFacts
	Local                   *LocalVolumeSourceFacts
	NFS                     *NFSVolumeSourceFacts
	PhotonPersistentDisk    *PhotonPersistentDiskFacts
	PortworxVolume          *PortworxVolumeFacts
	Quobyte                 *QuobyteVolumeFacts
	RBD                     *RBDVolumeSourceFacts
	ScaleIO                 *ScaleIOVolumeSourceFacts
	StorageOS               *StorageOSVolumeSourceFacts
	VsphereVolume           *VsphereVirtualDiskFacts
}

type AWSElasticBlockStoreFacts struct {
	VolumeID  string
	FSType    string
	Partition int32
	ReadOnly  bool
}

type AzureDiskFacts struct {
	DiskName    string
	DiskURI     string
	Kind        string
	CachingMode string
	FSType      string
	ReadOnly    bool
}

type AzureFileFacts struct {
	SecretRef ResourceLink
	ShareName string
	ReadOnly  bool
}

type CSIVolumeSourceFacts struct {
	Driver           string
	VolumeHandle     string
	FSType           string
	ReadOnly         bool
	VolumeAttributes map[string]string
	NodePublishSecret *ResourceLink
}

type FCVolumeSourceFacts struct {
	TargetWWNs []string
	Lun        *int32
	FSType     string
	ReadOnly   bool
}

type FlexVolumeSourceFacts struct {
	Driver    string
	FSType    string
	ReadOnly  bool
	SecretRef *ResourceLink
	Options   map[string]string
}

type GCEPersistentDiskFacts struct {
	PDName    string
	FSType    string
	Partition int32
	ReadOnly  bool
}

type HostPathFacts struct {
	Path string
	Type string
}

type ISCSIVolumeSourceFacts struct {
	TargetPortal string
	IQN          string
	Lun          int32
	ISCSIInterface string
	FSType       string
	ReadOnly     bool
	Portals      []string
	SecretRef    *ResourceLink
	InitiatorName string
}

type LocalVolumeSourceFacts struct {
	Path string
	FSType string
}

type NFSVolumeSourceFacts struct {
	Server   string
	Path     string
	ReadOnly bool
}

type PhotonPersistentDiskFacts struct {
	PDID   string
	FSType string
}

type PortworxVolumeFacts struct {
	VolumeID string
	FSType   string
	ReadOnly bool
}

type QuobyteVolumeFacts struct {
	Registry string
	Volume   string
	ReadOnly bool
	User     string
	Group    string
}

type RBDVolumeSourceFacts struct {
	Monitors []string
	Image    string
	FSType   string
	Pool     string
	User     string
	Keyring  string
	SecretRef *ResourceLink
	ReadOnly bool
}

type ScaleIOVolumeSourceFacts struct {
	Gateway          string
	System           string
	ProtectionDomain string
	StoragePool      string
	StorageMode      string
	VolumeName       string
	FSType           string
	ReadOnly         bool
	SecretRef        *ResourceLink
}

type StorageOSVolumeSourceFacts struct {
	VolumeName      string
	VolumeNamespace string
	FSType          string
	ReadOnly        bool
	SecretRef       *ResourceLink
}

type VsphereVirtualDiskFacts struct {
	VolumePath        string
	FSType            string
	StoragePolicyName string
	StoragePolicyID   string
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
	Policies                   []ScalingPolicyFacts
}

type ScalingPolicyFacts struct {
	Type          string
	Value         int32
	PeriodSeconds int32
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
	Max                  ResourceQuantityMapFacts
	Min                  ResourceQuantityMapFacts
	Default              ResourceQuantityMapFacts
	DefaultRequest       ResourceQuantityMapFacts
	MaxLimitRequestRatio ResourceQuantityMapFacts
}

type ResourceQuantityMapFacts map[string]resource.Quantity

type IntOrStringFacts struct {
	Type   string
	IntVal *int32
	StrVal string
}

type StatefulSetPVCRetentionPolicyFacts struct {
	WhenDeleted string
	WhenScaled  string
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
	PVCRetentionPolicy         *StatefulSetPVCRetentionPolicyFacts
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
	ReadyEndpointCount     int
	TotalEndpointCount     int
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
	DefaultBackend *IngressBackendFacts
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
	MinAvailable         *IntOrStringFacts
	MaxUnavailable       *IntOrStringFacts
	AllowedDisruptions   int32
	CurrentHealthy       int32
	DesiredHealthy       int32
	ExpectedPods         int32
	DisruptedPods        []DisruptedPodFacts
	Conditions           []ConditionFacts
	ObservedGeneration   int64
}

type DisruptedPodFacts struct {
	Pod             ResourceLink
	DisruptionTime  time.Time
}

type ResourceQuotaFacts struct {
	Hard           ResourceQuantityMapFacts
	Used           ResourceQuantityMapFacts
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
	Chart       string
	Version     string
	AppVersion  string
	Revision    int
	RawStatus   string
	Updated     *time.Time
	Description string
	Resources   []ResourceLink
	History     []HelmRevisionFacts
}
```

`RawStatus` preserves Helm's release status for detail display and debugging.
Consumers must use `ResourceModel.Status` for the primary label, severity,
sorting, and filtering.

### Events

Applies to `Event`.

```go
type EventFacts struct {
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

### Custom Resources

Applies to dynamic custom resources discovered from the object catalog.

```go
type CustomResourceFacts struct {
	Conditions         []ConditionFacts
	RawPhase           string
	RawState           string
	Ready              *bool
	ObservedGeneration int64
}
```

`CustomResourceFacts` is only for dynamic custom resources. It must not be used
as a migration escape hatch for app-supported built-in kinds listed in the
Supported Resource Inventory. If a built-in resource family is in scope for a
phase, that phase must add its explicit facts type and consumers before it is
marked complete.

Raw custom-resource spec/status payloads are detail-only data. The shared model
should extract only semantic status conventions it owns, such as conditions,
phase/state labels, ready markers, and observed generation.

Custom resources still need the common `ResourceModel` fields. They should not
be allowed to drop `clusterId`, `group`, `version`, or `kind` just because no
typed facts model exists yet.

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

The corresponding `ResourceModel` must set `Source:
ResourceSourceSynthetic` and `Scope: ResourceScopeNamespaced`. Real Kubernetes
objects must set `Source: ResourceSourceKubernetes` and the scope resolved by
the object catalog.

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

Add the shared relationship index when the first migrated resource family needs
reverse links; do not block the minimal Node vertical slice on a generic index
that no migrated consumer has exercised yet. Once introduced, the index must be
per-cluster and scoped to a refresh snapshot build or streaming update batch. It
should be built once from informers/catalog summaries available in that cluster
context and then passed to resource model builders. Builders may add direct
forward links from their own object, but reverse-link fields must come from the
shared index.

The index should preserve `ResourceLink` semantics:

- use openable `ResourceRef` only when the catalog or typed object provides full
  `clusterId`, `group`, `version`, `kind`, namespace, and name
- use `DisplayRef` for unresolved, external, deleted, or partial references
- expose cache/version metadata so refresh diagnostics can identify stale
  relationship data

The index design must explicitly cover:

- partial RBAC, where an informer or list path is unavailable and reverse links
  must be absent-with-diagnostics rather than guessed
- stale catalog state, including the catalog version or snapshot version used to
  resolve references
- streaming update invalidation, including which related rows must be re-emitted
  when child objects change derived parent facts
- cluster add/remove lifecycle, so no relationship data crosses cluster
  boundaries or survives a cluster teardown
- object-map traversal, which may use the same relationships but still owns
  graph filtering, depth, deduplication, and edge layout mechanics

### Capability Facts

Capabilities are not just static booleans. They can depend on RBAC, resource
state, selected action options, active operations, and discovery availability.
The model must preserve the checks and failure reasons needed by Diagnostics so
the UI does not show buttons that are disconnected from permission state.

Capability builders must integrate with the existing `QueryPermissions`
SSRR/SSAR store instead of replacing it implicitly. They must also preserve the
frontend's current stable object-action IDs and object-panel capability check
IDs, or migrate those sources of truth in the same phase.

Capability integration decision after the Node slice:

- Keep intrinsic resource modeling and contextual capabilities separate.
  `ResourceModel` must not contain RBAC results, action availability,
  diagnostics state, or in-flight operation state.
- Existing permission infrastructure remains the integration point. A future
  capability builder should call through the current permission query layer
  (`QueryPermissions`, SSRR/SSAR-backed stores, and discovery-aware permission
  descriptors) rather than introducing a second permission evaluator.
- Existing frontend action descriptors remain the stable source of action IDs.
  Backend capability facts must use those IDs when they describe object actions,
  or the phase must migrate backend and frontend action IDs together.
- Object-panel capability-only checks such as YAML, logs, exec, Helm manifest,
  and Helm values should remain check IDs unless they are promoted to real
  object actions.
- Active operations such as drain, delete, restart, rollback, and scale affect
  capability facts through `InFlight` and `Reason`; they are not resource facts.
- Permission checks must preserve Kubernetes authorization attributes exactly:
  `clusterId`, group, version, resource plural, subresource, namespace, name,
  verb, and scope. Do not collapse checks to kind/verb pairs.
- Discovery or permission transport failures belong in `Error`; normal denials
  or disabled states belong in `Reason`. Diagnostics should be able to
  distinguish those cases.
- Do not add capability model Go types or Wails payloads until a migrated
  consumer needs capability facts. Until then, keep the decision documented and
  continue using existing action/capability paths.

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

Do not expose the full shared facts union through Wails just because the
internal Go model exists. The first vertical slice should project the shared
model into existing DTOs unless a frontend consumer genuinely needs a typed
facts payload. When a phase first exposes shared facts over Wails, that phase
must document the TypeScript shape in `frontend/AGENTS.md` or a linked
development note. The decision should cover whether facts are exposed as a
discriminated payload or an `omitempty` union and how frontend consumers narrow
the type.

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
- resource-state signals consumed by contextual capability builders

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

## Implementation Learnings From The Node Slice

The Node migration exposed several rules that must guide the remaining phases.

Backend status state must preserve the authoritative Kubernetes value selected
by the resource-specific builder. For Node, the selected source is the
`NodeReady` condition, so `ResourceStatusPresentation.State` is exactly one of
the Kubernetes condition status values: `True`, `False`, or `Unknown`. The
shared model may compose a clearer display `Label`, such as `Ready (Cordoned)`
or `Terminating`, but that label must not replace the source state.

Backend status presentation must be a separate field. The Node slice uses
`Presentation` values such as `ready`, `cordoned`, `not-ready`, `unknown`, and
`terminating`. This prevents the frontend from styling a `Terminating` label as
green just because the preserved raw `NodeReady` state is `True`.

Do not introduce a generic `ResourceState` enum such as `healthy`, `degraded`,
or `unhealthy` for shared resource status. Those words may still exist in older
cluster health, stream health, diagnostics, or unmigrated object-map code, but
they are not the shared resource model contract for migrated Kubernetes
resources. When another resource family migrates, it must define which
Kubernetes condition, phase, or status field is authoritative for its primary
`State`.

Signals and badges must also carry source-derived values. For example, Node
cordon presentation should preserve the field or taint that caused it:
`spec.unschedulable=true` or the unschedulable taint effect. Deletion signals
should preserve `metadata.deletionTimestamp`, not a made-up marker such as
`Set`. `Reason` may name the interpretation, but `Status` should remain the
source value.

The frontend may adapt backend-emitted presentation tokens to visual treatment
only at the rendering boundary. Acceptable examples are CSS selectors such as
`.status-badge.terminating` and `.status-badge.cordoned`, or an object-map color
lookup that chooses a color for the backend `Presentation`. Fallback styling
from raw `State` is allowed only for legacy or unmigrated payloads that do not
yet emit `Presentation`. Unacceptable examples are frontend hooks or table
components that inspect Kubernetes object fields and rewrite status semantics
after the backend has emitted the app model.

DTO parity sometimes requires adding small explicit fields rather than
overloading existing strings. The Node slice added `statusState` and
`statusPresentation`/`statusReason` beside the display `status` string so table
rows, detail panels, resource-stream rows, and object-map nodes can render the
same backend-derived presentation without parsing display text or misusing raw
source state as a style class.

Generated Wails TypeScript models must stay in sync with DTO changes in the
same phase. If `wails generate` cannot update the bindings in the local
environment, the generated model file still has to be updated and validated by
typecheck before the phase is considered complete.

Parity tests need to cover both backend projections and frontend rendering
boundaries. For a migrated resource family, tests should prove that table,
detail, resource-stream, and object-map builders select primary status from the
shared model, and frontend tests should prove that components consume the
backend-emitted state instead of recomputing it.

## Implementation Learnings From The Pod Slice

The Pod migration reinforced that shared facts must be authoritative, not just
shared labels.

For Pod, `ResourceStatusPresentation.State` is the raw Kubernetes
`status.phase` value selected by the builder: `Pending`, `Running`, `Succeeded`,
`Failed`, `Unknown`, or `Unknown` when the API object has no phase. The display
`Label` may still follow kubectl-style presentation, such as
`ContainerCreating`, `ErrImagePull`, `Init:CrashLoopBackOff`, `Completed`,
`Evicted`, or `Terminating`, but those labels must not replace the source phase.

Pod `Presentation` is the backend-owned rendering token used by table, detail,
and object-map surfaces. A Pod can have `State: "Running"` and
`Presentation: "warning"` when its declared regular containers are not all
ready. The frontend must consume that backend token at the rendering boundary
instead of deciding that every `Running` pod is visually ready.

Pod readiness facts must use `spec.containers` as the denominator when it is
available. A missing regular container status means the container is not ready;
counting only `status.containerStatuses` incorrectly turns a partially reported
Pod into `1/1` ready. Restart facts must also be shared; the migrated Pod paths
now use one backend fact for regular, init, and ephemeral container restarts so
table/detail/list projections cannot drift.

Legacy exported helpers may remain temporarily when unmigrated workload code
calls them, but they must delegate to the shared Pod facts/status builder. No
migrated path should keep its own Pod readiness, restart, waiting-reason, or
terminated-reason derivation.

## Implementation Learnings From The Workload Slice

The Workload migration showed that controller resources do not all expose one
Kubernetes `phase` equivalent. For Deployment, StatefulSet, DaemonSet, and
ReplicaSet, the primary source-derived `State` is the controller's observed
ready/desired count, such as `2/3`, with controller conditions preserved as
signals. For Job, `State` comes from the selected Job condition status when a
condition determines the primary label, or from source counts such as active or
succeeded work when no condition applies. For CronJob, `State` preserves source
fields such as `spec.suspend` or the active job count.

Because workload `State` is intentionally source-derived and not a color token,
all migrated workload surfaces must render from backend `Presentation`. A
Deployment can show `State: "2/3"` with `Presentation: "warning"`, while a
failed progress condition can use the same source count with
`Presentation: "error"` and the Kubernetes condition reason preserved in
`Reason`. The frontend must not infer workload severity from labels such as
`Running`, `Updating`, or `Terminating`, nor from raw count strings.

Workload DTOs should carry explicit `statusState`, `statusPresentation`, and
`statusReason` fields beside the display `status` string. Namespace workload
tables, object-panel details, object-panel job lists, resource streams, and
object-map payloads now select those fields from the shared workload model
instead of duplicating rollout, readiness, pause, suspend, and completion
interpretation.

## Migration Strategy

Migrate by resource family, deleting duplicated semantic logic as each family is
completed. The first implementation work should prove a full vertical slice
before broadening the foundation. Do not add facts slots, Wails facts payloads,
reverse-link indexes, or capability builders ahead of the first resource family
that actually consumes them.

### Phase 1: Minimal Shared Foundation

- [x] ✅ Add the backend shared resource model package with the common types
      needed by the Node slice: `ResourceModel`, `ResourceRef`,
      `ResourceSource`, `ResourceScope`, `ResourceStatusPresentation`,
      lifecycle, and status signals.
- [x] ✅ Keep Phase 1 internal-only. Do not expose the full shared facts union
      through Wails in this phase; migrated consumers project from the shared
      model into existing DTO contracts.
- [x] ✅ Add tests for the common invariants that apply to the Node slice:
      cluster-aware identity, Kubernetes source, cluster scope, metadata
      copying, and raw source status values.

### Phase 2: Nodes Vertical Slice

- [x] ✅ Add `NodeFacts` and node shared resource model builder.
- [x] ✅ Move node ready, not-ready, unknown, cordoned, and unschedulable-taint
      interpretation into the shared resource model layer.
- [x] ✅ Use node shared resource model from node table snapshot builder and
      resource-stream node row builder.
- [x] ✅ Use node shared resource model from node detail builder.
- [x] ✅ Use node shared resource model from object-map node builder.
- [x] ✅ Project into existing DTOs unless a DTO change is required for parity.
- [x] ✅ Remove duplicated node status derivation from the migrated paths,
      including frontend node status reinterpretation.
- [x] ✅ Add tests for ready, not-ready, unknown, unschedulable, terminating, and
      unschedulable-taint nodes.
- [x] ✅ Add table/detail/object-map/resource-stream parity tests for node status.
- [x] ✅ Record the Node-slice performance-risk decision: no benchmark is
      required for this slice because it is summary-only, remains entirely
      in-memory, adds no Kubernetes API calls, adds no child-list or reverse-link
      materialization, and only centralizes existing Node status/fact derivation.

### Phase 3: Cross-Cutting Contracts After Nodes

- [x] ✅ Decide whether any shared facts need to cross Wails. Decision: keep the
      shared resource model backend-internal for now. Migrated builders continue
      projecting into existing DTOs unless a specific consumer needs shared
      facts over Wails. If that happens, document the TypeScript shape and
      narrowing strategy before exposing the facts payload.
- [ ] Add `DisplayRef`, `ResourceLink`, constructors, validation, and projection
      helpers when the first relationship-bearing migrated consumer needs them.
      Projection helpers must cover existing exported contracts rather than
      introducing parallel wire identities: backend `ObjectRef`/`RefOrDisplay`,
      object-map `ObjectMapReference`, frontend object refs through existing DTO
      fields, catalog summaries, and permission descriptors.
- [ ] Add object-catalog-backed reference resolution helpers when the first
      migrated resource family needs openable/display-only relationship links.
      Shared validation must never guess `resource` from `kind`.
- [x] ✅ Decide the contextual capability integration point with the existing
      `QueryPermissions`/SSRR/SSAR store, action descriptors, diagnostics, and
      active-operation state. Decision: keep capabilities separate from
      intrinsic resource facts, route future capability builders through the
      existing permission/action infrastructure, preserve stable action IDs and
      Kubernetes authorization attributes, and defer new capability model types
      until a migrated consumer needs them.
- [ ] Add capability model types only if a migrated consumer uses them; preserve
      existing action and capability IDs.
- [ ] Add the relationship index strategy only when a migrated resource family
      needs reverse links. Include stale-data, partial-RBAC, streaming
      invalidation, and cluster lifecycle tests.
- [ ] Add facts slots for subsequent GVKs only as their resource families are
      migrated.

### Phase 4: Pods

- [x] ✅ Add pod shared resource model.
- [x] ✅ Centralize pod display status logic, including waiting and terminated
      container reasons.
- [x] ✅ Use pod shared resource model from pod table snapshot builders.
- [x] ✅ Use pod shared resource model from pod detail builders.
- [x] ✅ Use pod shared resource model from object-map pod builder.
- [x] ✅ Remove duplicated pod status, readiness, and restart derivation from
      migrated paths; legacy exported helpers delegate to the shared Pod model
      for unmigrated workload callers.
- [x] ✅ Add tests for running, pending, succeeded, failed, crashloop, image pull,
      terminating, and readiness mismatch cases.

### Phase 5: Workloads

- [x] ✅ Add shared resource models for Deployment, StatefulSet, DaemonSet,
      ReplicaSet, Job, and CronJob.
- [x] ✅ Centralize ready/degraded/paused/progress interpretation.
- [x] ✅ Use workload shared resource models from namespace workload tables.
- [x] ✅ Use workload shared resource models from object-panel detail builders.
- [x] ✅ Use workload shared resource models from object-map builders.
- [x] ✅ Add parity tests for primary workload status.

### Phase 6: Storage

- [ ] Add shared resource models for PersistentVolumeClaim, PersistentVolume, and
      StorageClass.
- [ ] Centralize bound, pending, released, failed, lost, and default-class
      interpretation.
- [ ] Use storage shared resource models from table, detail, and object-map
      paths.
- [ ] Add parity tests for primary storage status.

### Phase 7: Config

- [ ] Add shared resource models for ConfigMap and Secret.
- [ ] Keep Secret values out of shared facts; expose only keys/count/type and
      explicit detail-only access.
- [ ] Centralize ConfigMap/Secret usage relationships through `ResourceLink`.
- [ ] Use config shared resource models from table, detail, and object-map
      paths.
- [ ] Add parity tests for config identity, usage links, and status.

### Phase 8: Network

- [ ] Add shared resource models for Service, EndpointSlice, Ingress,
      IngressClass, and NetworkPolicy.
- [ ] Centralize service endpoint readiness, ingress address readiness, backend
      links, class links, and network policy selectors.
- [ ] Use network shared resource models from table, detail, and object-map
      paths where applicable.
- [ ] Add parity tests for network identity, primary status, and relationship
      links.

### Phase 9: Gateway API

- [ ] Add shared resource models for GatewayClass, Gateway, HTTPRoute,
      GRPCRoute, TLSRoute, ListenerSet, ReferenceGrant, and BackendTLSPolicy.
- [ ] Centralize Gateway API conditions, summaries, parent refs, backend refs,
      target refs, and display-only reference handling.
- [ ] Use Gateway API shared resource models from table and detail paths.
- [ ] Add parity tests for status summaries and `ResourceLink` behavior.

### Phase 10: RBAC

- [ ] Add shared resource models for Role, ClusterRole, RoleBinding,
      ClusterRoleBinding, and ServiceAccount.
- [ ] Centralize role refs, subjects, aggregation rules, service account
      reverse links, and display-only user/group subjects.
- [ ] Use RBAC shared resource models from namespace/cluster tables, detail
      paths, and object-map paths where applicable.
- [ ] Add tests for namespaced vs cluster-scoped references.

### Phase 11: Policy And Autoscaling

- [ ] Add shared resource models for HorizontalPodAutoscaler,
      PodDisruptionBudget, ResourceQuota, and LimitRange.
- [ ] Centralize scale target references, metric facts, PDB disruption facts,
      quota usage facts, and limit range facts.
- [ ] Use policy/autoscaling shared resource models from table, detail, and
      object-map paths where applicable.
- [ ] Add tests for scale target GVK resolution and display-only fallbacks.

### Phase 12: API Extensions And Admission

- [ ] Add shared resource models for CustomResourceDefinition,
      MutatingWebhookConfiguration, and ValidatingWebhookConfiguration.
- [ ] Centralize CRD version/name/condition facts and webhook rule/client
      reference facts. Keep CRD schemas detail-only.
- [ ] Use API extension/admission shared resource models from cluster tables and
      detail paths.
- [ ] Add tests for webhook service links and CRD version facts.

### Phase 13: Helm, Events, And Custom Resources

- [ ] Add shared resource model support for HelmRelease synthetic refs.
- [ ] Add shared resource model support for Event involved-object links.
- [ ] Add dynamic custom-resource extraction for conditions, phase, state,
      ready, and observedGeneration.
- [ ] Use these models from Helm, event, custom-resource, generic detail, and
      object-content paths where applicable.
- [ ] Add tests for synthetic Helm identity, stale/partial event references, and
      custom-resource status extraction.

### Phase 14: Frontend Semantic Cleanup

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
  option-dependent failures, and in-flight operation state once a phase
  introduces capability builders
- a before/after performance check for any table, object-map, or streaming path
  whose builder changes; each phase should name the fixture or benchmark used
  and the acceptable threshold before implementation

Regression tests should specifically prevent per-surface status drift from
returning.

## Acceptance Criteria

- Kubernetes resource semantics live in backend shared resource model builders, not in
  frontend table or panel components.
- Table, detail, and object-map payloads for migrated resources derive shared
  identity and primary status from the same shared resource model.
- Every supported built-in GVK has an explicit facts type; dynamic custom
  resources use `CustomResourceFacts` only when they are not promoted to
  first-class support. Facts slots are added by migration phase, not all
  front-loaded before the first resource family.
- Every `ResourceModel` records whether it is Kubernetes-backed or synthetic and
  whether it is cluster-scoped or namespaced.
- Every openable `ResourceRef` produced by the shared resource model includes
  `clusterId`, `group`, `version`, and `kind`, plus `namespace` and `name` when
  object-specific.
- Display-only references preserve all identity fields supplied by the source
  object, including UID when present, and are never presented as openable
  navigation targets.
- Primary status includes lifecycle and source-signal provenance so terminating,
  finalizer-blocked, phase-derived, condition-derived, readiness-derived, and
  resource-state-derived statuses are testable.
- Resource quantities remain semantic in the shared model and are formatted only
  by consumer DTO builders.
- Capability checks preserve Kubernetes authorization attributes, including
  resource plural, subresource, namespace, name, verb, and scope.
- Action and capability identifiers preserve existing frontend stable IDs unless
  a phase intentionally migrates the frontend source of truth at the same time.
- Action options are typed; no shared resource or capability model uses untyped
  option maps for option semantics.
- Secret values, literal env values, credential-like parameters, and other
  sensitive detail-only fields are not exposed through summary facts or
  non-detail materialization.
- Capabilities are produced by contextual capability builders, not embedded in
  intrinsic resource facts.
- Reverse links are computed through a shared relationship index once a migrated
  resource family needs reverse links, not repeated per-builder scans.
- Table, detail, and object-map consumers request explicit materialization
  levels and do not build detail-only facts for table refreshes.
- Table/detail/map projection of the shared model stays within the
  phase-specific refresh and streaming performance threshold recorded before the
  phase starts.
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

The foundation should grow from completed vertical slices. Prefer one proven
resource-family migration over a broad platform change whose exported contracts
have not been exercised by table, detail, object-map, and streaming consumers.

The implementation should avoid temporary dual paths. During a phase, short-lived
local work-in-progress is acceptable, but no migrated resource family should be
presented as complete while table, detail, and object-map consumers still derive
the same semantics independently.
