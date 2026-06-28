/*
 * backend/resources/types/types.go
 *
 * Shared resource type definitions.
 * - Common data structures used across resources.
 */

package types

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// KubeconfigInfo represents information about a kubeconfig context
type KubeconfigInfo struct {
	Name             string `json:"name"`             // Display name (filename)
	Path             string `json:"path"`             // Path to the kubeconfig file
	Context          string `json:"context"`          // Context name within the file
	IsDefault        bool   `json:"isDefault"`        // Whether this is from the default config file
	IsCurrentContext bool   `json:"isCurrentContext"` // Whether this is the current context in the file
}

// WindowSettings represents the window position and size
type WindowSettings struct {
	X         int  `json:"x"`
	Y         int  `json:"y"`
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximized bool `json:"maximized"`
}

// AppSettings represents the application settings
type AppSettings struct {
	AppearanceMode                           string   `json:"appearanceMode"`                           // "light", "dark", or "system"
	SelectedKubeconfigs                      []string `json:"selectedKubeconfigs"`                      // Multi-cluster selections in "path:context" form
	UseShortResourceNames                    bool     `json:"useShortResourceNames"`                    // Use short names like "po" for pods in badges/headers
	DimInactiveNamespaces                    bool     `json:"dimInactiveNamespaces"`                    // Dim namespaces with no workloads in the sidebar
	ExclusiveNamespaces                      bool     `json:"exclusiveNamespaces"`                      // Allow only one expanded namespace in the sidebar
	AutoRefreshEnabled                       bool     `json:"autoRefreshEnabled"`                       // Enable automatic refresh cycles
	RefreshBackgroundClustersEnabled         bool     `json:"refreshBackgroundClustersEnabled"`         // Refresh inactive clusters in the background
	MetricsRefreshIntervalMs                 int      `json:"metricsRefreshIntervalMs"`                 // Metrics refresh interval (ms)
	KubernetesClientQPS                      int      `json:"kubernetesClientQPS"`                      // Per-cluster Kubernetes REST client QPS
	KubernetesClientBurst                    int      `json:"kubernetesClientBurst"`                    // Per-cluster Kubernetes REST client burst allowance
	PermissionSSRRFetchConcurrency           int      `json:"permissionSSRRFetchConcurrency"`           // Concurrent namespace SelfSubjectRulesReview fetches
	ObjPanelLogsBufferMaxSize                int      `json:"objPanelLogsBufferMaxSize"`                // Max container log entries kept in memory per Object Panel Logs Tab (100-10000)
	ObjPanelLogsTargetPerScopeLimit          int      `json:"objPanelLogsTargetPerScopeLimit"`          // Max pod/container Object Panel Logs Tab targets per Logs tab (1-1000)
	ObjPanelLogsTargetGlobalLimit            int      `json:"objPanelLogsTargetGlobalLimit"`            // Max pod/container Object Panel Logs Tab targets across all log tabs (1-1000)
	ObjPanelLogsAPITimestampFormat           string   `json:"objPanelLogsApiTimestampFormat"`           // Day.js format for the Kubernetes API timestamp shown in container logs
	ObjPanelLogsAPITimestampUseLocalTimeZone bool     `json:"objPanelLogsApiTimestampUseLocalTimeZone"` // Render the Kubernetes API timestamp in the user's local timezone instead of UTC
	GridTablePersistenceMode                 string   `json:"gridTablePersistenceMode"`                 // "shared" or "namespaced"
	DefaultTablePageSize                     int      `json:"defaultTablePageSize"`                     // Default rows per page for tables without a persisted page size
	DefaultObjectPanelPosition               string   `json:"defaultObjectPanelPosition"`               // "right", "bottom", or "floating"
	ObjectPanelDockedRightWidth              int      `json:"objectPanelDockedRightWidth"`              // Default width when docked right (px)
	ObjectPanelDockedBottomHeight            int      `json:"objectPanelDockedBottomHeight"`            // Default height when docked bottom (px)
	ObjectPanelFloatingWidth                 int      `json:"objectPanelFloatingWidth"`                 // Default floating width (px)
	ObjectPanelFloatingHeight                int      `json:"objectPanelFloatingHeight"`                // Default floating height (px)
	ObjectPanelFloatingX                     int      `json:"objectPanelFloatingX"`                     // Default floating X position (px)
	ObjectPanelFloatingY                     int      `json:"objectPanelFloatingY"`                     // Default floating Y position (px)
	PaletteHueLight                          int      `json:"paletteHueLight"`                          // Hue for gray palette tint in light mode (0-360)
	PaletteSaturationLight                   int      `json:"paletteSaturationLight"`                   // Saturation intensity for gray palette tint in light mode (0-100)
	PaletteBrightnessLight                   int      `json:"paletteBrightnessLight"`                   // Brightness offset for gray palette in light mode (-50 to +50)
	PaletteHueDark                           int      `json:"paletteHueDark"`                           // Hue for gray palette tint in dark mode (0-360)
	PaletteSaturationDark                    int      `json:"paletteSaturationDark"`                    // Saturation intensity for gray palette tint in dark mode (0-100)
	PaletteBrightnessDark                    int      `json:"paletteBrightnessDark"`                    // Brightness offset for gray palette in dark mode (-50 to +50)
	AccentColorLight                         string   `json:"accentColorLight"`                         // Custom accent hex for light mode (empty = default)
	AccentColorDark                          string   `json:"accentColorDark"`                          // Custom accent hex for dark mode (empty = default)
	LinkColorLight                           string   `json:"linkColorLight"`                           // Custom link hex for light mode (empty = default)
	LinkColorDark                            string   `json:"linkColorDark"`                            // Custom link hex for dark mode (empty = default)
	Themes                                   []Theme  `json:"themes"`                                   // Saved theme library
}

// AppPreferenceSchema describes one persisted/runtime app preference the
// frontend can edit through the settings contract.
type AppPreferenceSchema struct {
	Key               string   `json:"key"`
	Type              string   `json:"type"`
	DefaultValue      any      `json:"defaultValue"`
	CurrentValue      any      `json:"currentValue"`
	Min               *int     `json:"min,omitempty"`
	Max               *int     `json:"max,omitempty"`
	EnumOptions       []string `json:"enumOptions,omitempty"`
	Validation        string   `json:"validation,omitempty"`
	RuntimeSideEffect bool     `json:"runtimeSideEffect"`
}

// AppSettingsSchema describes the persisted/runtime settings contract.
type AppSettingsSchema struct {
	Preferences []AppPreferenceSchema `json:"preferences"`
}

// AppPreferenceChange updates one persisted/runtime app preference.
type AppPreferenceChange struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

// UpdateAppPreferencesRequest applies one atomic batch of preference changes.
type UpdateAppPreferencesRequest struct {
	Changes []AppPreferenceChange `json:"changes"`
}

// UpdateAppPreferencesResponse returns the normalized settings after an update.
type UpdateAppPreferencesResponse struct {
	Settings    *AppSettings `json:"settings"`
	ChangedKeys []string     `json:"changedKeys"`
}

// AppearanceModeInfo represents the appearance mode payload sent to the frontend.
type AppearanceModeInfo struct {
	CurrentMode string `json:"currentMode"` // Stored appearance mode: "light", "dark", or "system"
	UserMode    string `json:"userMode"`    // Stored appearance mode: "light", "dark", or "system"
}

// Theme represents a saved color theme with optional cluster pattern matching.
// Themes are ordered; when matching clusters, the first match wins.
type Theme struct {
	ID             string `json:"id"`             // UUID
	Name           string `json:"name"`           // Display name, e.g. "Danger Red"
	ClusterPattern string `json:"clusterPattern"` // Glob pattern matched against context name, e.g. "prod*"; empty = "*" catch-all

	PaletteHueLight        int `json:"paletteHueLight"`        // 0-360
	PaletteSaturationLight int `json:"paletteSaturationLight"` // 0-100
	PaletteBrightnessLight int `json:"paletteBrightnessLight"` // -50 to +50
	PaletteHueDark         int `json:"paletteHueDark"`         // 0-360
	PaletteSaturationDark  int `json:"paletteSaturationDark"`  // 0-100
	PaletteBrightnessDark  int `json:"paletteBrightnessDark"`  // -50 to +50

	AccentColorLight string `json:"accentColorLight,omitempty"` // Hex "#rrggbb" or empty for default
	AccentColorDark  string `json:"accentColorDark,omitempty"`  // Hex "#rrggbb" or empty for default

	LinkColorLight string `json:"linkColorLight,omitempty"` // Hex "#rrggbb" or empty for default
	LinkColorDark  string `json:"linkColorDark,omitempty"`  // Hex "#rrggbb" or empty for default
}

// ThemeClusterPatternValidationResult reports whether a saved theme cluster
// pattern can be parsed by the app glob matcher.
type ThemeClusterPatternValidationResult struct {
	Valid   bool   `json:"valid"`
	Message string `json:"message,omitempty"`
}

// ContainerLogsEntry represents a single log line with metadata
type ContainerLogsEntry struct {
	Timestamp   string `json:"timestamp"` // RFC3339Nano format
	Pod         string `json:"pod"`
	Container   string `json:"container"`
	Line        string `json:"line"`
	IsInit      bool   `json:"isInit"`                // Whether this is from an init container
	IsEphemeral bool   `json:"isEphemeral,omitempty"` // Whether this is from an ephemeral/debug container
}

// ContainerLogsFetchRequest represents parameters for fetching logs
type ContainerLogsFetchRequest struct {
	Scope            string   `json:"scope,omitempty"`
	PodFilter        string   `json:"podFilter,omitempty"`
	PodInclude       string   `json:"podInclude,omitempty"`
	PodExclude       string   `json:"podExclude,omitempty"`
	SelectedFilters  []string `json:"selectedFilters,omitempty"`
	Container        string   `json:"container,omitempty"` // empty means all containers
	IncludeInit      *bool    `json:"includeInit,omitempty"`
	IncludeEphemeral *bool    `json:"includeEphemeral,omitempty"`
	ContainerState   string   `json:"containerState,omitempty"`
	Include          string   `json:"include,omitempty"`
	Exclude          string   `json:"exclude,omitempty"`
	Previous         bool     `json:"previous"`
	TailLines        int      `json:"tailLines"`
	SinceSeconds     int64    `json:"sinceSeconds,omitempty"`
}

// ContainerLogsFetchResponse represents the response from FetchContainerLogs
type ContainerLogsFetchResponse struct {
	Entries  []ContainerLogsEntry `json:"entries"`
	Warnings []string             `json:"warnings,omitempty"`
	Error    string               `json:"error,omitempty"`
}

// NodeLogSource represents a discovered node log source that can be fetched directly.
type NodeLogSource struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
	Path  string `json:"path"`
}

// NodeLogDiscoveryResponse describes whether node logs are usable and which sources are available.
type NodeLogDiscoveryResponse struct {
	Supported bool            `json:"supported"`
	Sources   []NodeLogSource `json:"sources,omitempty"`
	Reason    string          `json:"reason,omitempty"`
}

// NodeLogFetchRequest selects a discovered node log source to fetch.
type NodeLogFetchRequest struct {
	SourcePath string `json:"sourcePath"`
	SinceTime  string `json:"sinceTime,omitempty"`
	TailBytes  int    `json:"tailBytes,omitempty"`
}

// NodeLogFetchResponse contains raw node log content for a selected source.
type NodeLogFetchResponse struct {
	Content    string        `json:"content,omitempty"`
	Source     NodeLogSource `json:"source"`
	Error      string        `json:"error,omitempty"`
	SourcePath string        `json:"sourcePath,omitempty"`
	Truncated  bool          `json:"truncated,omitempty"`
}

// ShellSessionRequest describes the namespace/pod/container to exec into.
type ShellSessionRequest struct {
	Namespace string   `json:"namespace"`
	PodName   string   `json:"podName"`
	Container string   `json:"container,omitempty"`
	Command   []string `json:"command,omitempty"`
}

// ShellSession contains details about an active exec session.
type ShellSession struct {
	SessionID  string   `json:"sessionId"`
	Namespace  string   `json:"namespace"`
	PodName    string   `json:"podName"`
	Container  string   `json:"container"`
	Command    []string `json:"command"`
	Containers []string `json:"containers"`
}

// ShellSessionInfo describes a tracked shell exec session.
type ShellSessionInfo struct {
	SessionID   string      `json:"sessionId"`
	ClusterID   string      `json:"clusterId"`
	ClusterName string      `json:"clusterName"`
	Namespace   string      `json:"namespace"`
	PodName     string      `json:"podName"`
	Container   string      `json:"container"`
	Command     []string    `json:"command"`
	StartedAt   metav1.Time `json:"startedAt"`
}

// DebugContainerRequest describes the parameters for creating an ephemeral debug container.
type DebugContainerRequest struct {
	Namespace       string `json:"namespace"`
	PodName         string `json:"podName"`
	Image           string `json:"image"`
	TargetContainer string `json:"targetContainer,omitempty"`
}

// DebugContainerResponse contains the result of creating an ephemeral debug container.
type DebugContainerResponse struct {
	ContainerName string `json:"containerName"`
	PodName       string `json:"podName"`
	Namespace     string `json:"namespace"`
}

// ShellOutputEvent is emitted whenever stdout/stderr data is available.
type ShellOutputEvent struct {
	SessionID string `json:"sessionId"`
	ClusterID string `json:"clusterId"`
	Stream    string `json:"stream"`
	Data      string `json:"data"`
}

// ShellStatusEvent reports lifecycle changes for a shell session.
type ShellStatusEvent struct {
	SessionID string `json:"sessionId"`
	ClusterID string `json:"clusterId"`
	Status    string `json:"status"`
	Reason    string `json:"reason,omitempty"`
}

//
// Cluster-scoped Resource Types
// Order matches tab layout: Nodes, RBAC, Storage, Config, CRDs, Events
//

// ClsNodeInfo represents Kubernetes node information
type ClsNodeInfo struct {
	Kind       string `json:"kind"` // always "node"
	Name       string `json:"name"`
	Status     string `json:"status"`  // Ready, NotReady, Unknown
	Roles      string `json:"roles"`   // worker, control-plane, etc.
	Version    string `json:"version"` // Kubernetes version
	OS         string `json:"os"`      // Operating system
	InternalIP string `json:"internalIP"`
	CPU        string `json:"cpu"`    // CPU capacity
	Memory     string `json:"memory"` // Memory capacity
	Pods       string `json:"pods"`   // Pod count/capacity
	Age        string `json:"age"`
}

// ClsRBACInfo represents cluster-wide RBAC resource information (ClusterRoles, ClusterRoleBindings)
type ClsRBACInfo struct {
	Kind      string `json:"kind"`      // clusterrole, clusterrolebinding
	TypeAlias string `json:"typeAlias"` // Short display name
	Name      string `json:"name"`
	Details   string `json:"details"`
	Age       string `json:"age"`
}

// ClsStorageInfo represents cluster-wide storage resource information (PersistentVolumes)
type ClsStorageInfo struct {
	Kind         string `json:"kind"` // resource type (e.g. "PersistentVolume")
	Name         string `json:"name"`
	StorageClass string `json:"storageClass"` // storage class name (e.g. "gp3")
	Capacity     string `json:"capacity"`
	AccessModes  string `json:"accessModes"`
	Status       string `json:"status"`
	Claim        string `json:"claim"` // bound claim
	Age          string `json:"age"`
}

// ClsConfigInfo represents cluster configuration resources (StorageClasses, IngressClasses, Webhooks)
type ClsConfigInfo struct {
	Kind      string `json:"kind"`      // "StorageClass", "IngressClass", "Validating", "Mutating"
	TypeAlias string `json:"typeAlias"` // Short display name
	Name      string `json:"name"`
	Details   string `json:"details"`   // Provisioner/Controller/Webhooks count
	IsDefault bool   `json:"isDefault"` // Whether this is the default resource
	Age       string `json:"age"`
}

// ClsCRDInfo represents Custom Resource Definition information
type ClsCRDInfo struct {
	Kind      string `json:"kind"`      // always "customresourcedefinition"
	TypeAlias string `json:"typeAlias"` // Short display name (e.g., "CRD")
	Name      string `json:"name"`
	Group     string `json:"group"`
	Scope     string `json:"scope"`   // Namespaced or Cluster
	Details   string `json:"details"` // versions, etc.
	Age       string `json:"age"`
}

// ClsEventsInfo represents Kubernetes Event information for the cluster view
type ClsEventsInfo struct {
	Kind      string `json:"kind"`      // Resource type (always "Event")
	Namespace string `json:"namespace"` // Namespace where the event occurred
	Type      string `json:"type"`      // Event severity (Normal, Warning)
	Source    string `json:"source"`    // Source that generated the event
	Reason    string `json:"reason"`    // Short reason for the event
	Object    string `json:"object"`    // Object kind and name (e.g., "Pod/my-pod")
	Message   string `json:"message"`   // Human-readable message
	Age       string `json:"age"`       // How long ago the event occurred
}

// Supporting types for Config tab resources

// ClsAdmissionControlInfo represents webhook configurations
type ClsAdmissionControlInfo struct {
	Kind      string `json:"kind"`      // "Validating" or "Mutating"
	TypeAlias string `json:"typeAlias"` // Short display name
	Name      string `json:"name"`
	Webhooks  int    `json:"webhooks"`  // Number of webhooks in the configuration
	Namespace string `json:"namespace"` // Namespace selector or empty for all
	Age       string `json:"age"`
}

// ClsStorageClassInfo represents Kubernetes StorageClass information
type ClsStorageClassInfo struct {
	Kind              string `json:"kind"` // always "StorageClass"
	Name              string `json:"name"`
	Provisioner       string `json:"provisioner"`
	ReclaimPolicy     string `json:"reclaimPolicy"`
	VolumeBindingMode string `json:"volumeBindingMode"`
	AllowExpansion    bool   `json:"allowExpansion"`
	IsDefault         bool   `json:"isDefault"`
	Age               string `json:"age"`
}

// ClsIngressClassInfo represents Kubernetes IngressClass information
type ClsIngressClassInfo struct {
	Kind       string `json:"kind"` // always "IngressClass"
	Name       string `json:"name"`
	Controller string `json:"controller"`
	IsDefault  bool   `json:"isDefault"`
	Age        string `json:"age"`
}

//
// Namespaced Resource Types
// Order matches tab layout: Workloads, RBAC, Storage, Config, Network, Autoscaling, Quotas, Custom, Helm, Events
//

// PodSimpleInfo represents basic pod information for list views
type PodSimpleInfo struct {
	Kind      string `json:"kind"` // pod
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	StatusProjection
	Ready      string `json:"ready"`
	Restarts   int32  `json:"restarts"` // Total restart count across all containers
	Age        string `json:"age"`
	CPURequest string `json:"cpuRequest"` // Aggregated CPU requests
	CPULimit   string `json:"cpuLimit"`   // Aggregated CPU limits
	CPUUsage   string `json:"cpuUsage"`   // Current CPU usage from metrics
	MemRequest string `json:"memRequest"` // Aggregated memory requests
	MemLimit   string `json:"memLimit"`   // Aggregated memory limits
	MemUsage   string `json:"memUsage"`   // Current memory usage from metrics
	OwnerKind  string `json:"ownerKind"`  // Kind of the owner (Deployment, StatefulSet, etc)
	OwnerName  string `json:"ownerName"`  // Name of the owner resource
	// OwnerAPIVersion is the wire-form apiVersion of the owner (e.g.
	// "apps/v1", "argoproj.io/v1alpha1", "kubevirt.io/v1"). Threaded from
	// pod.OwnerReferences[*].APIVersion (or hardcoded apps/v1 for the
	// ReplicaSet→Deployment collapse) so the frontend can open
	// CRD-as-Pod-owner targets in the object panel with a fully-qualified
	// GVK. Required for Argo Rollouts, KubeVirt VMI, Tekton TaskRun,
	// Spark SparkApplication, etc.
	OwnerAPIVersion string `json:"ownerApiVersion,omitempty"`
}

// NsRBACInfo represents basic RBAC resource information (Roles, RoleBindings, ServiceAccounts)
type NsRBACInfo struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"` // role, rolebinding, serviceaccount
	Namespace string `json:"namespace"`
	Details   string `json:"details"` // type-specific details
	Age       string `json:"age"`
}

// NsStorageInfo represents basic storage resource information
type NsStorageInfo struct {
	Kind         string `json:"kind"` // persistentvolumeclaim
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Capacity     string `json:"capacity"`
	Status       string `json:"status"`
	StorageClass string `json:"storageClass"`
	Age          string `json:"age"`
}

// NsConfigInfo represents basic config information (ConfigMaps and Secrets)
type NsConfigInfo struct {
	Kind      string `json:"kind"`      // configmap, secret
	TypeAlias string `json:"typeAlias"` // Short display name
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Data      int    `json:"data"` // number of data items
	Age       string `json:"age"`
}

// NsNetworkInfo represents basic network resource information
type NsNetworkInfo struct {
	Kind      string `json:"kind"` // service, ingress, networkpolicy, endpoint
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"` // type-specific details (e.g., cluster IP, load balancer IP)
	Age       string `json:"age"`
}

// NsAutoscalingInfo represents basic autoscaling resource information
type NsAutoscalingInfo struct {
	Kind      string `json:"kind"` // horizontalpodautoscaler, verticalpodautoscaler
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Target    string `json:"target"`  // target resource (e.g., Deployment/nginx)
	Min       int32  `json:"min"`     // minimum replicas
	Max       int32  `json:"max"`     // maximum replicas
	Current   int32  `json:"current"` // current replicas
	Age       string `json:"age"`
}

// NsQuotaInfo represents basic quota resource information
type NsQuotaInfo struct {
	Kind      string `json:"kind"` // resourcequota, limitrange
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"` // quota details
	Age       string `json:"age"`
}

// NsHelmInfo represents basic Helm chart information in a namespace
type NsHelmInfo struct {
	Kind       string `json:"kind"`      // always "helmrelease"
	TypeAlias  string `json:"typeAlias"` // Short display name
	Name       string `json:"name"`      // Release name
	Namespace  string `json:"namespace"`
	Chart      string `json:"chart"`      // Chart name and version
	AppVersion string `json:"appVersion"` // Application version
	Status     string `json:"status"`     // Deployed, Failed, etc.
	Revision   int    `json:"revision"`   // Revision number
	Updated    string `json:"updated"`    // Last update time
	Age        string `json:"age"`        // First deployment time
}

// PodDetailInfoContainer represents detailed container information within a pod
type PodDetailInfoContainer struct {
	Name            string            `json:"name"`
	Image           string            `json:"image"`
	ImagePullPolicy string            `json:"imagePullPolicy"`
	Ready           bool              `json:"ready"`
	RestartCount    int32             `json:"restartCount"`
	State           string            `json:"state"` // waiting, running, terminated
	StateReason     string            `json:"stateReason,omitempty"`
	StateMessage    string            `json:"stateMessage,omitempty"`
	StartedAt       string            `json:"startedAt,omitempty"`
	CPURequest      string            `json:"cpuRequest"`
	CPULimit        string            `json:"cpuLimit"`
	MemRequest      string            `json:"memRequest"`
	MemLimit        string            `json:"memLimit"`
	Ports           []string          `json:"ports,omitempty"`
	VolumeMounts    []string          `json:"volumeMounts,omitempty"`
	Environment     map[string]string `json:"environment,omitempty"`
	Command         []string          `json:"command,omitempty"`
	Args            []string          `json:"args,omitempty"`
}

// PodDetailInfo represents comprehensive pod information for the object panel
type PodDetailInfo struct {
	// Basic information (same as PodSimpleInfo)
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	StatusProjection
	Ready      string `json:"ready"`
	Restarts   int32  `json:"restarts"`
	CPURequest string `json:"cpuRequest"`
	CPULimit   string `json:"cpuLimit"`
	CPUUsage   string `json:"cpuUsage"`
	MemRequest string `json:"memRequest"`
	MemLimit   string `json:"memLimit"`
	MemUsage   string `json:"memUsage"`

	// Ownership information
	OwnerKind string `json:"ownerKind"`
	OwnerName string `json:"ownerName"`
	// OwnerAPIVersion carries the wire-form apiVersion of the controlling
	// owner so the panel can open CRD-as-Pod-owner targets correctly. See
	//  and PodSimpleInfo.OwnerAPIVersion.
	OwnerAPIVersion string `json:"ownerApiVersion,omitempty"`

	// Additional details for object panel
	Node            string                   `json:"node"`
	NodeIP          string                   `json:"nodeIP,omitempty"`
	PodIP           string                   `json:"podIP,omitempty"`
	QOSClass        string                   `json:"qosClass"`
	Priority        *int32                   `json:"priority,omitempty"`
	PriorityClass   string                   `json:"priorityClass,omitempty"`
	ServiceAccount  string                   `json:"serviceAccount"`
	Labels          map[string]string        `json:"labels,omitempty"`
	Annotations     map[string]string        `json:"annotations,omitempty"`
	Conditions      []string                 `json:"conditions,omitempty"`
	Containers      []PodDetailInfoContainer `json:"containers"`
	InitContainers  []PodDetailInfoContainer `json:"initContainers,omitempty"`
	Volumes         []string                 `json:"volumes,omitempty"`
	Tolerations     []string                 `json:"tolerations,omitempty"`
	Affinity        map[string]any           `json:"affinity,omitempty"`
	HostNetwork     bool                     `json:"hostNetwork"`
	HostPID         bool                     `json:"hostPID"`
	HostIPC         bool                     `json:"hostIPC"`
	DNSPolicy       string                   `json:"dnsPolicy,omitempty"`
	RestartPolicy   string                   `json:"restartPolicy"`
	SchedulerName   string                   `json:"schedulerName,omitempty"`
	RuntimeClass    string                   `json:"runtimeClass,omitempty"`
	SecurityContext map[string]any           `json:"securityContext,omitempty"`
}

// ConfigMapDetails moved to resources/configmap and SecretDetails moved to
// resources/secret (co-located with each kind's model + detail builder).

// EndpointSliceDetails describes a single EndpointSlice resource. Address,
// port, and address-type fields are flattened directly because each Object
// Panel renders one EndpointSlice; aggregation across slices for a Service
// uses a different model.
// EndpointSliceDetails + EndpointSliceAddress/Port moved to resources/endpointslice
// (co-located with the EndpointSlice model + detail builder).

// ObjectRef is the shared openable Kubernetes object identity.
type ObjectRef = resourcemodel.ResourceRef

// DisplayRef preserves unresolved cross-references that cannot be opened safely
// because the source object did not provide a full GVK.
type DisplayRef = resourcemodel.DisplayRef

type RefOrDisplay struct {
	Ref     *ObjectRef  `json:"ref,omitempty"`
	Display *DisplayRef `json:"display,omitempty"`
}

type ConditionState struct {
	Type               string `json:"type,omitempty"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

type ConditionsSummary struct {
	Accepted   *ConditionState `json:"accepted,omitempty"`
	Programmed *ConditionState `json:"programmed,omitempty"`
	Ready      *ConditionState `json:"ready,omitempty"`
	Resolved   *ConditionState `json:"resolvedRefs,omitempty"`
}

type GatewayListenerDetails struct {
	Name           string           `json:"name"`
	Hostname       string           `json:"hostname,omitempty"`
	Port           int32            `json:"port"`
	Protocol       string           `json:"protocol"`
	AttachedRoutes int32            `json:"attachedRoutes"`
	Conditions     []ConditionState `json:"conditions,omitempty"`
}

type RouteDetails struct {
	Kind        string             `json:"kind"`
	Name        string             `json:"name"`
	Namespace   string             `json:"namespace"`
	Age         string             `json:"age"`
	Details     string             `json:"details"`
	Hostnames   []string           `json:"hostnames,omitempty"`
	ParentRefs  []RefOrDisplay     `json:"parentRefs,omitempty"`
	BackendRefs []RefOrDisplay     `json:"backendRefs,omitempty"`
	Rules       []RouteRuleDetails `json:"rules,omitempty"`
	Conditions  []ConditionState   `json:"conditions,omitempty"`
	Summary     ConditionsSummary  `json:"summary"`
	Labels      map[string]string  `json:"labels,omitempty"`
	Annotations map[string]string  `json:"annotations,omitempty"`
}

type RouteRuleDetails struct {
	Matches     []string       `json:"matches,omitempty"`
	BackendRefs []RefOrDisplay `json:"backendRefs,omitempty"`
}

type HTTPRouteDetails = RouteDetails
type GRPCRouteDetails = RouteDetails
type TLSRouteDetails = RouteDetails

type ReferenceGrantFromInfo struct {
	Group     string `json:"group"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
}

// IngressClassDetails + IngressClassParameters moved to resources/ingressclass
// (co-located with the IngressClass model + detail builder).

// NetworkPolicyDetails + NetworkPolicyRule/Peer/Port + IPBlock moved to
// resources/networkpolicy (co-located with the NetworkPolicy model + builder).

type PolicyRule struct {
	APIGroups       []string `json:"apiGroups,omitempty"`
	Resources       []string `json:"resources,omitempty"`
	ResourceNames   []string `json:"resourceNames,omitempty"`
	Verbs           []string `json:"verbs"`
	NonResourceURLs []string `json:"nonResourceURLs,omitempty"`
}

type RoleRef struct {
	APIGroup string `json:"apiGroup"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
}

type Subject struct {
	Kind      string `json:"kind"`
	APIGroup  string `json:"apiGroup,omitempty"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}

type PodMetricsSummary struct {
	Pods       int    `json:"pods"`
	ReadyPods  int    `json:"readyPods"`
	CPUUsage   string `json:"cpuUsage,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
}

// VolumeClaimTemplateSummary moved to resources/statefulset (co-located with the
// StatefulSet DTO).

type ReplicaSetSummary struct {
	Name      string `json:"name"`
	Revision  string `json:"revision"`
	Replicas  string `json:"replicas"`
	Ready     string `json:"readyReplicas"`
	Available string `json:"availableReplicas"`
	Age       string `json:"age"`
}

// ReplicaSetDetails represents detailed ReplicaSet information for the object panel.
// ReplicaSetDetails moved to resources/replicaset (co-located with its model +
// detail builder).

// DeploymentDetails moved to resources/deployment, and StatefulSetDetails +
// VolumeClaimTemplateSummary moved to resources/statefulset — each co-located
// with its kind's model + detail builder. ReplicaSetSummary stays here because
// it is shared across kinds.

// DaemonSetDetails moved to resources/daemonset (co-located with its model +
// detail builder).

// JobDetails moved to resources/job and CronJobDetails moved to resources/cronjob
// (each co-located with its model + detail builder). JobReference, JobSimpleInfo,
// and JobTemplateDetails stay here — they are shared sub-types CronJobDetails
// references.

type JobReference struct {
	Name      string       `json:"name"`
	StartTime *metav1.Time `json:"startTime,omitempty"`
}

// JobSimpleInfo provides a summary of a Job for list/tab views.
type JobSimpleInfo struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	StatusProjection
	Completions     string       `json:"completions"` // e.g. "1/1"
	Succeeded       int32        `json:"succeeded"`
	Failed          int32        `json:"failed"`
	Active          int32        `json:"active"`
	StartTime       *metav1.Time `json:"startTime,omitempty"`
	CompletionTime  *metav1.Time `json:"completionTime,omitempty"`
	Duration        string       `json:"duration,omitempty"`
	DurationSeconds int64        `json:"durationSeconds,omitempty"`
	Age             string       `json:"age"`
	AgeTimestamp    int64        `json:"ageTimestamp,omitempty"`
}
type JobTemplateDetails struct {
	Completions             *int32                   `json:"completions,omitempty"`
	Parallelism             *int32                   `json:"parallelism,omitempty"`
	BackoffLimit            *int32                   `json:"backoffLimit,omitempty"`
	ActiveDeadlineSeconds   *int64                   `json:"activeDeadlineSeconds,omitempty"`
	TTLSecondsAfterFinished *int32                   `json:"ttlSecondsAfterFinished,omitempty"`
	Containers              []PodDetailInfoContainer `json:"containers,omitempty"`
}
