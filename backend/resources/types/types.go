package types

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

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
	Theme                            string   `json:"theme"`                            // "light", "dark", or "system"
	SelectedKubeconfig               string   `json:"selectedKubeconfig"`               // Path to the selected kubeconfig
	SelectedKubeconfigs              []string `json:"selectedKubeconfigs"`              // Multi-cluster selections in "path:context" form
	UseShortResourceNames            bool     `json:"useShortResourceNames"`            // Use short names like "po" for pods in badges/headers
	AutoRefreshEnabled               bool     `json:"autoRefreshEnabled"`               // Enable automatic refresh cycles
	RefreshBackgroundClustersEnabled bool     `json:"refreshBackgroundClustersEnabled"` // Refresh inactive clusters in the background
	MetricsRefreshIntervalMs         int      `json:"metricsRefreshIntervalMs"`         // Metrics refresh interval (ms)
	GridTablePersistenceMode         string   `json:"gridTablePersistenceMode"`         // "shared" or "namespaced"
}

// ThemeInfo represents theme information to send to frontend
type ThemeInfo struct {
	CurrentTheme string `json:"currentTheme"` // "light" or "dark"
	UserTheme    string `json:"userTheme"`    // "light", "dark", or "system"
}

// PodLogEntry represents a single log line with metadata
type PodLogEntry struct {
	Timestamp string `json:"timestamp"` // RFC3339Nano format
	Pod       string `json:"pod"`
	Container string `json:"container"`
	Line      string `json:"line"`
	IsInit    bool   `json:"isInit"` // Whether this is from an init container
}

// LogFetchRequest represents parameters for fetching logs
type LogFetchRequest struct {
	Namespace    string `json:"namespace"`
	WorkloadName string `json:"workloadName,omitempty"`
	WorkloadKind string `json:"workloadKind,omitempty"` // deployment, daemonset, etc.
	PodName      string `json:"podName,omitempty"`
	Container    string `json:"container,omitempty"` // empty means all containers
	Previous     bool   `json:"previous"`
	TailLines    int    `json:"tailLines"`
	SinceSeconds int64  `json:"sinceSeconds,omitempty"`
}

// LogFetchResponse represents the response from LogFetcher
type LogFetchResponse struct {
	Entries []PodLogEntry `json:"entries"`
	Error   string        `json:"error,omitempty"`
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

// ShellOutputEvent is emitted whenever stdout/stderr data is available.
type ShellOutputEvent struct {
	SessionID string `json:"sessionId"`
	Stream    string `json:"stream"`
	Data      string `json:"data"`
}

// ShellStatusEvent reports lifecycle changes for a shell session.
type ShellStatusEvent struct {
	SessionID string `json:"sessionId"`
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

// NsWorkloadInfo represents basic workload information
type NsWorkloadInfo struct {
	Kind      string `json:"kind"` // deployment, replicaset, statefulset, daemonset, job, cronjob
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Ready     string `json:"ready"`
	Age       string `json:"age"`

	// Resource utilization (aggregated for all pods)
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	CPUUsage   string `json:"cpuUsage,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`
}

// PodSimpleInfo represents basic pod information for list views
type PodSimpleInfo struct {
	Kind       string `json:"kind"` // pod
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Status     string `json:"status"`
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

// CustomResourceInfo represents a custom resource instance in a namespace
type NsCustomResourceInfo struct {
	Kind      string `json:"kind"` // The CRD kind (e.g., "VirtualService", "ServiceMonitor")
	Name      string `json:"name"`
	APIGroup  string `json:"apiGroup"` // The API group (e.g., "networking.istio.io")
	Namespace string `json:"namespace"`
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

// HelmReleaseDetails represents detailed information about a Helm release
type HelmReleaseDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	TypeAlias string `json:"typeAlias"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Age       string `json:"age"`

	// Chart information
	Chart      string `json:"chart"`
	Version    string `json:"version"`
	AppVersion string `json:"appVersion"`

	// Status information
	Status   string `json:"status"`
	Revision int    `json:"revision"`
	Updated  string `json:"updated"`

	// Additional details
	Description string                 `json:"description,omitempty"`
	Notes       string                 `json:"notes,omitempty"`
	Values      map[string]interface{} `json:"values,omitempty"`

	// History
	History []HelmRevision `json:"history,omitempty"`

	// Resources managed by this release
	Resources []HelmResource `json:"resources,omitempty"`

	// Metadata
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// HelmRevision represents a single revision in the Helm release history
type HelmRevision struct {
	Revision    int    `json:"revision"`
	Updated     string `json:"updated"`
	Status      string `json:"status"`
	Chart       string `json:"chart"`
	AppVersion  string `json:"appVersion,omitempty"`
	Description string `json:"description,omitempty"`
}

// HelmResource represents a Kubernetes resource managed by a Helm release
type HelmResource struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
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
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Status     string `json:"status"`
	Ready      string `json:"ready"`
	Restarts   int32  `json:"restarts"`
	Age        string `json:"age"`
	CPURequest string `json:"cpuRequest"`
	CPULimit   string `json:"cpuLimit"`
	CPUUsage   string `json:"cpuUsage"`
	MemRequest string `json:"memRequest"`
	MemLimit   string `json:"memLimit"`
	MemUsage   string `json:"memUsage"`

	// Ownership information
	OwnerKind string `json:"ownerKind"`
	OwnerName string `json:"ownerName"`

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

type ConfigMapDetails struct {
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Age         string            `json:"age"`
	Details     string            `json:"details"`
	Data        map[string]string `json:"data,omitempty"`
	BinaryData  map[string]string `json:"binaryData,omitempty"`
	DataCount   int               `json:"dataCount"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
	UsedBy      []string          `json:"usedBy,omitempty"`
}

type SecretDetails struct {
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Age         string            `json:"age"`
	Details     string            `json:"details"`
	SecretType  string            `json:"secretType"`
	Data        map[string]string `json:"data,omitempty"`
	DataKeys    []string          `json:"dataKeys"`
	DataCount   int               `json:"dataCount"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
	UsedBy      []string          `json:"usedBy,omitempty"`
}

type ServiceDetails struct {
	Kind                   string               `json:"kind"`
	Name                   string               `json:"name"`
	Namespace              string               `json:"namespace"`
	Age                    string               `json:"age"`
	Details                string               `json:"details"`
	ServiceType            string               `json:"serviceType"`
	ClusterIP              string               `json:"clusterIP"`
	ClusterIPs             []string             `json:"clusterIPs,omitempty"`
	ExternalIPs            []string             `json:"externalIPs,omitempty"`
	LoadBalancerIP         string               `json:"loadBalancerIP,omitempty"`
	LoadBalancerStatus     string               `json:"loadBalancerStatus,omitempty"`
	ExternalName           string               `json:"externalName,omitempty"`
	Ports                  []ServicePortDetails `json:"ports"`
	SessionAffinity        string               `json:"sessionAffinity"`
	SessionAffinityTimeout int32                `json:"sessionAffinityTimeout,omitempty"`
	Selector               map[string]string    `json:"selector,omitempty"`
	Endpoints              []string             `json:"endpoints,omitempty"`
	EndpointCount          int                  `json:"endpointCount"`
	Labels                 map[string]string    `json:"labels,omitempty"`
	Annotations            map[string]string    `json:"annotations,omitempty"`
	HealthStatus           string               `json:"healthStatus"`
}

type ServicePortDetails struct {
	Name       string `json:"name,omitempty"`
	Protocol   string `json:"protocol"`
	Port       int32  `json:"port"`
	TargetPort string `json:"targetPort"`
	NodePort   int32  `json:"nodePort,omitempty"`
}

type EndpointSliceDetails struct {
	Kind          string                 `json:"kind"`
	Name          string                 `json:"name"`
	Namespace     string                 `json:"namespace"`
	Age           string                 `json:"age"`
	Details       string                 `json:"details"`
	Slices        []EndpointSliceSummary `json:"slices,omitempty"`
	TotalReady    int                    `json:"totalReady"`
	TotalNotReady int                    `json:"totalNotReady"`
	TotalPorts    int                    `json:"totalPorts"`
	Labels        map[string]string      `json:"labels,omitempty"`
	Annotations   map[string]string      `json:"annotations,omitempty"`
}

type EndpointSliceSummary struct {
	Name              string                 `json:"name"`
	AddressType       string                 `json:"addressType"`
	Age               string                 `json:"age"`
	ReadyAddresses    []EndpointSliceAddress `json:"readyAddresses,omitempty"`
	NotReadyAddresses []EndpointSliceAddress `json:"notReadyAddresses,omitempty"`
	Ports             []EndpointSlicePort    `json:"ports,omitempty"`
}

type EndpointSliceAddress struct {
	IP        string `json:"ip"`
	Hostname  string `json:"hostname,omitempty"`
	NodeName  string `json:"nodeName,omitempty"`
	TargetRef string `json:"targetRef,omitempty"`
}

type EndpointSlicePort struct {
	Name        string `json:"name,omitempty"`
	Port        int32  `json:"port"`
	Protocol    string `json:"protocol"`
	AppProtocol string `json:"appProtocol,omitempty"`
}

type IngressDetails struct {
	Kind               string                 `json:"kind"`
	Name               string                 `json:"name"`
	Namespace          string                 `json:"namespace"`
	Age                string                 `json:"age"`
	Details            string                 `json:"details"`
	IngressClassName   *string                `json:"ingressClassName,omitempty"`
	Rules              []IngressRuleDetails   `json:"rules"`
	TLS                []IngressTLSDetails    `json:"tls,omitempty"`
	LoadBalancerStatus []string               `json:"loadBalancerStatus,omitempty"`
	DefaultBackend     *IngressBackendDetails `json:"defaultBackend,omitempty"`
	Labels             map[string]string      `json:"labels,omitempty"`
	Annotations        map[string]string      `json:"annotations,omitempty"`
}

type IngressRuleDetails struct {
	Host  string               `json:"host,omitempty"`
	Paths []IngressPathDetails `json:"paths"`
}

type IngressPathDetails struct {
	Path     string                `json:"path"`
	PathType string                `json:"pathType"`
	Backend  IngressBackendDetails `json:"backend"`
}

type IngressBackendDetails struct {
	ServiceName string `json:"serviceName,omitempty"`
	ServicePort string `json:"servicePort,omitempty"`
	Resource    string `json:"resource,omitempty"`
}

type IngressTLSDetails struct {
	Hosts      []string `json:"hosts"`
	SecretName string   `json:"secretName,omitempty"`
}

type IngressClassDetails struct {
	Kind        string                  `json:"kind"`
	Name        string                  `json:"name"`
	Controller  string                  `json:"controller"`
	Age         string                  `json:"age"`
	IsDefault   bool                    `json:"isDefault"`
	Details     string                  `json:"details"`
	Parameters  *IngressClassParameters `json:"parameters,omitempty"`
	Labels      map[string]string       `json:"labels,omitempty"`
	Annotations map[string]string       `json:"annotations,omitempty"`
	Ingresses   []string                `json:"ingresses,omitempty"`
}

type IngressClassParameters struct {
	APIGroup  string `json:"apiGroup,omitempty"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	Scope     string `json:"scope,omitempty"`
}

type NetworkPolicyDetails struct {
	Kind         string              `json:"kind"`
	Name         string              `json:"name"`
	Namespace    string              `json:"namespace"`
	Age          string              `json:"age"`
	Details      string              `json:"details"`
	PodSelector  map[string]string   `json:"podSelector"`
	PolicyTypes  []string            `json:"policyTypes"`
	IngressRules []NetworkPolicyRule `json:"ingressRules,omitempty"`
	EgressRules  []NetworkPolicyRule `json:"egressRules,omitempty"`
	Labels       map[string]string   `json:"labels,omitempty"`
	Annotations  map[string]string   `json:"annotations,omitempty"`
}

type NetworkPolicyRule struct {
	From  []NetworkPolicyPeer `json:"from,omitempty"`
	To    []NetworkPolicyPeer `json:"to,omitempty"`
	Ports []NetworkPolicyPort `json:"ports,omitempty"`
}

type NetworkPolicyPeer struct {
	PodSelector       map[string]string `json:"podSelector,omitempty"`
	NamespaceSelector map[string]string `json:"namespaceSelector,omitempty"`
	IPBlock           *IPBlock          `json:"ipBlock,omitempty"`
}

type IPBlock struct {
	CIDR   string   `json:"cidr"`
	Except []string `json:"except,omitempty"`
}

type NetworkPolicyPort struct {
	Protocol string  `json:"protocol,omitempty"`
	Port     *string `json:"port,omitempty"`
	EndPort  *int32  `json:"endPort,omitempty"`
}

type RoleDetails struct {
	Kind               string            `json:"kind"`
	Name               string            `json:"name"`
	Namespace          string            `json:"namespace"`
	Age                string            `json:"age"`
	Details            string            `json:"details"`
	Rules              []PolicyRule      `json:"rules"`
	Labels             map[string]string `json:"labels,omitempty"`
	Annotations        map[string]string `json:"annotations,omitempty"`
	UsedByRoleBindings []string          `json:"usedByRoleBindings,omitempty"`
}

type PolicyRule struct {
	APIGroups       []string `json:"apiGroups,omitempty"`
	Resources       []string `json:"resources,omitempty"`
	ResourceNames   []string `json:"resourceNames,omitempty"`
	Verbs           []string `json:"verbs"`
	NonResourceURLs []string `json:"nonResourceURLs,omitempty"`
}

type RoleBindingDetails struct {
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Age         string            `json:"age"`
	Details     string            `json:"details"`
	RoleRef     RoleRef           `json:"roleRef"`
	Subjects    []Subject         `json:"subjects"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
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

type ClusterRoleDetails struct {
	Kind                string            `json:"kind"`
	Name                string            `json:"name"`
	Age                 string            `json:"age"`
	Details             string            `json:"details"`
	Rules               []PolicyRule      `json:"rules"`
	AggregationRule     *AggregationRule  `json:"aggregationRule,omitempty"`
	Labels              map[string]string `json:"labels,omitempty"`
	Annotations         map[string]string `json:"annotations,omitempty"`
	ClusterRoleBindings []string          `json:"clusterRoleBindings,omitempty"`
	RoleBindings        []string          `json:"roleBindings,omitempty"`
}

type AggregationRule struct {
	ClusterRoleSelectors []map[string]string `json:"clusterRoleSelectors,omitempty"`
}

type ClusterRoleBindingDetails struct {
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Age         string            `json:"age"`
	Details     string            `json:"details"`
	RoleRef     RoleRef           `json:"roleRef"`
	Subjects    []Subject         `json:"subjects"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type ServiceAccountDetails struct {
	Kind                         string            `json:"kind"`
	Name                         string            `json:"name"`
	Namespace                    string            `json:"namespace"`
	Age                          string            `json:"age"`
	Details                      string            `json:"details"`
	Secrets                      []string          `json:"secrets,omitempty"`
	ImagePullSecrets             []string          `json:"imagePullSecrets,omitempty"`
	AutomountServiceAccountToken *bool             `json:"automountServiceAccountToken,omitempty"`
	Labels                       map[string]string `json:"labels,omitempty"`
	Annotations                  map[string]string `json:"annotations,omitempty"`
	UsedByPods                   []string          `json:"usedByPods,omitempty"`
	RoleBindings                 []string          `json:"roleBindings,omitempty"`
	ClusterRoleBindings          []string          `json:"clusterRoleBindings,omitempty"`
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

type ReplicaSetSummary struct {
	Name      string `json:"name"`
	Revision  string `json:"revision"`
	Replicas  string `json:"replicas"`
	Ready     string `json:"readyReplicas"`
	Available string `json:"availableReplicas"`
	Age       string `json:"age"`
}

// ReplicaSetDetails represents detailed ReplicaSet information for the object panel.
type ReplicaSetDetails struct {
	// Basic information
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	Details         string `json:"details"`
	Replicas        string `json:"replicas"`
	Ready           string `json:"ready"`
	Available       int32  `json:"available,omitempty"`
	DesiredReplicas int32  `json:"desiredReplicas,omitempty"`
	Age             string `json:"age"`

	// Average resource utilization (per pod)
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	CPUUsage   string `json:"cpuUsage,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`

	// ReplicaSet configuration
	MinReadySeconds int32             `json:"minReadySeconds,omitempty"`
	Selector        map[string]string `json:"selector,omitempty"`
	Labels          map[string]string `json:"labels,omitempty"`
	Annotations     map[string]string `json:"annotations,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Template information
	Containers []PodDetailInfoContainer `json:"containers,omitempty"`

	// Pod information
	Pods              []PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *PodMetricsSummary `json:"podMetricsSummary,omitempty"`

	// Status
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
	IsActive           bool  `json:"isActive"`
}

type DeploymentDetails struct {
	// Basic information
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	Details         string `json:"details"`
	Replicas        string `json:"replicas"`
	Ready           string `json:"ready"`
	Updated         string `json:"updated,omitempty"`
	UpToDate        int32  `json:"upToDate,omitempty"`
	Available       int32  `json:"available,omitempty"`
	DesiredReplicas int32  `json:"desiredReplicas,omitempty"`
	Age             string `json:"age"`

	// Average resource utilization (per pod)
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	CPUUsage   string `json:"cpuUsage,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`

	// Strategy information
	Strategy         string `json:"strategy,omitempty"`
	MaxSurge         string `json:"maxSurge,omitempty"`
	MaxUnavailable   string `json:"maxUnavailable,omitempty"`
	MinReadySeconds  int32  `json:"minReadySeconds,omitempty"`
	RevisionHistory  int32  `json:"revisionHistory,omitempty"`
	ProgressDeadline int32  `json:"progressDeadline,omitempty"`

	// Selector and labels
	Selector    map[string]string `json:"selector,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Template information
	Containers []PodDetailInfoContainer `json:"containers,omitempty"`

	// Pod information
	Pods              []PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *PodMetricsSummary `json:"podMetricsSummary,omitempty"`

	// ReplicaSet information
	CurrentRevision     string              `json:"currentRevision,omitempty"`
	ReplicaSets         []string            `json:"replicaSets,omitempty"`
	ReplicaSetSummaries []ReplicaSetSummary `json:"replicaSetSummaries,omitempty"`

	// Rollout status
	ObservedGeneration int64  `json:"observedGeneration,omitempty"`
	Paused             bool   `json:"paused,omitempty"`
	RolloutStatus      string `json:"rolloutStatus,omitempty"`
	RolloutMessage     string `json:"rolloutMessage,omitempty"`
}

type StatefulSetDetails struct {
	// Basic information
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	Details         string `json:"details"`
	Replicas        string `json:"replicas"`
	Ready           string `json:"ready"`
	UpToDate        int32  `json:"upToDate,omitempty"`
	Available       int32  `json:"available,omitempty"`
	DesiredReplicas int32  `json:"desiredReplicas,omitempty"`
	Age             string `json:"age"`

	// Average resource utilization (per pod)
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	CPUUsage   string `json:"cpuUsage,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`

	// Update strategy
	UpdateStrategy       string `json:"updateStrategy,omitempty"`
	Partition            *int32 `json:"partition,omitempty"`
	MaxUnavailable       string `json:"maxUnavailable,omitempty"`
	PodManagementPolicy  string `json:"podManagementPolicy,omitempty"`
	MinReadySeconds      int32  `json:"minReadySeconds,omitempty"`
	RevisionHistoryLimit int32  `json:"revisionHistoryLimit,omitempty"`

	// Service information
	ServiceName                          string            `json:"serviceName,omitempty"`
	PersistentVolumeClaimRetentionPolicy map[string]string `json:"pvcRetentionPolicy,omitempty"`

	// Selector and labels
	Selector    map[string]string `json:"selector,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Template information
	Containers []PodDetailInfoContainer `json:"containers,omitempty"`

	// Volume claim templates
	VolumeClaimTemplates []string `json:"volumeClaimTemplates,omitempty"`

	// Pod information
	Pods              []PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *PodMetricsSummary `json:"podMetricsSummary,omitempty"`

	// Revision information
	CurrentRevision string `json:"currentRevision,omitempty"`
	UpdateRevision  string `json:"updateRevision,omitempty"`
	CurrentReplicas int32  `json:"currentReplicas,omitempty"`
	UpdatedReplicas int32  `json:"updatedReplicas,omitempty"`

	// Status
	ObservedGeneration int64  `json:"observedGeneration,omitempty"`
	CollisionCount     *int32 `json:"collisionCount,omitempty"`
}

type DaemonSetDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"`
	Desired   int32  `json:"desired"`
	Current   int32  `json:"current"`
	Ready     int32  `json:"ready"`
	UpToDate  int32  `json:"upToDate,omitempty"`
	Available int32  `json:"available"`
	Updated   int32  `json:"updated,omitempty"`
	Age       string `json:"age"`

	// Average resource utilization (per pod)
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	CPUUsage   string `json:"cpuUsage,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`

	// Update strategy
	UpdateStrategy       string `json:"updateStrategy,omitempty"`
	MaxUnavailable       string `json:"maxUnavailable,omitempty"`
	MaxSurge             string `json:"maxSurge,omitempty"`
	MinReadySeconds      int32  `json:"minReadySeconds,omitempty"`
	RevisionHistoryLimit int32  `json:"revisionHistoryLimit,omitempty"`

	// Selector and labels
	Selector    map[string]string `json:"selector,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Node selector
	NodeSelector map[string]string `json:"nodeSelector,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Template information
	Containers []PodDetailInfoContainer `json:"containers,omitempty"`

	// Pod information
	Pods              []PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *PodMetricsSummary `json:"podMetricsSummary,omitempty"`

	// Status
	ObservedGeneration int64  `json:"observedGeneration,omitempty"`
	NumberMisscheduled int32  `json:"numberMisscheduled,omitempty"`
	CollisionCount     *int32 `json:"collisionCount,omitempty"`
}

type JobDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"`
	Age       string `json:"age,omitempty"`

	// Job status
	Status         string       `json:"status,omitempty"`
	Completions    int32        `json:"completions,omitempty"`
	Parallelism    int32        `json:"parallelism,omitempty"`
	Succeeded      int32        `json:"succeeded,omitempty"`
	Failed         int32        `json:"failed,omitempty"`
	Active         int32        `json:"active,omitempty"`
	StartTime      *metav1.Time `json:"startTime,omitempty"`
	CompletionTime *metav1.Time `json:"completionTime,omitempty"`
	Duration       string       `json:"duration,omitempty"`

	// Job configuration
	BackoffLimit            int32  `json:"backoffLimit,omitempty"`
	ActiveDeadlineSeconds   *int64 `json:"activeDeadlineSeconds,omitempty"`
	TTLSecondsAfterFinished *int32 `json:"ttlSecondsAfterFinished,omitempty"`
	CompletionMode          string `json:"completionMode,omitempty"`
	Suspend                 bool   `json:"suspend,omitempty"`

	// Selector and labels
	Selector    map[string]string `json:"selector,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Pod template information
	Containers []PodDetailInfoContainer `json:"containers,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Related pods
	Pods              []PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *PodMetricsSummary `json:"podMetricsSummary,omitempty"`
}

type CronJobDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"`
	Age       string `json:"age"`

	// Schedule information
	Schedule              string       `json:"schedule"`
	Suspend               bool         `json:"suspend"`
	LastScheduleTime      *metav1.Time `json:"lastScheduleTime,omitempty"`
	LastSuccessfulTime    *metav1.Time `json:"lastSuccessfulTime,omitempty"`
	NextScheduleTime      string       `json:"nextScheduleTime,omitempty"`
	TimeUntilNextSchedule string       `json:"timeUntilNextSchedule,omitempty"`

	// Job configuration
	ConcurrencyPolicy       string `json:"concurrencyPolicy"`
	StartingDeadlineSeconds *int64 `json:"startingDeadlineSeconds,omitempty"`
	SuccessfulJobsHistory   int32  `json:"successfulJobsHistory"`
	FailedJobsHistory       int32  `json:"failedJobsHistory"`

	// Active jobs
	ActiveJobs []JobReference `json:"activeJobs,omitempty"`

	// Job template information
	JobTemplate JobTemplateDetails `json:"jobTemplate"`

	// Labels and annotations
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Related pods
	Pods              []PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *PodMetricsSummary `json:"podMetricsSummary,omitempty"`
}
type JobReference struct {
	Name      string       `json:"name"`
	StartTime *metav1.Time `json:"startTime,omitempty"`
}
type JobTemplateDetails struct {
	Completions             *int32                   `json:"completions,omitempty"`
	Parallelism             *int32                   `json:"parallelism,omitempty"`
	BackoffLimit            *int32                   `json:"backoffLimit,omitempty"`
	ActiveDeadlineSeconds   *int64                   `json:"activeDeadlineSeconds,omitempty"`
	TTLSecondsAfterFinished *int32                   `json:"ttlSecondsAfterFinished,omitempty"`
	Containers              []PodDetailInfoContainer `json:"containers,omitempty"`
}
