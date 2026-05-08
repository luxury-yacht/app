package resourcemodel

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

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
	Group     string `json:"group"`
	Version   string `json:"version"`
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
	Node                  *NodeFacts                  `json:"node,omitempty"`
	Pod                   *PodFacts                   `json:"pod,omitempty"`
	Deployment            *WorkloadFacts              `json:"deployment,omitempty"`
	StatefulSet           *WorkloadFacts              `json:"statefulSet,omitempty"`
	DaemonSet             *WorkloadFacts              `json:"daemonSet,omitempty"`
	ReplicaSet            *WorkloadFacts              `json:"replicaSet,omitempty"`
	Job                   *WorkloadFacts              `json:"job,omitempty"`
	CronJob               *WorkloadFacts              `json:"cronJob,omitempty"`
	PersistentVolume      *PersistentVolumeFacts      `json:"persistentVolume,omitempty"`
	PersistentVolumeClaim *PersistentVolumeClaimFacts `json:"persistentVolumeClaim,omitempty"`
	StorageClass          *StorageClassFacts          `json:"storageClass,omitempty"`
	ConfigMap             *ConfigMapFacts             `json:"configMap,omitempty"`
	Secret                *SecretFacts                `json:"secret,omitempty"`
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

type WorkloadFacts struct {
	DesiredReplicas   int32            `json:"desiredReplicas"`
	CurrentReplicas   int32            `json:"currentReplicas"`
	ReadyReplicas     int32            `json:"readyReplicas"`
	UpdatedReplicas   int32            `json:"updatedReplicas,omitempty"`
	AvailableReplicas int32            `json:"availableReplicas,omitempty"`
	Active            int32            `json:"active,omitempty"`
	Succeeded         int32            `json:"succeeded,omitempty"`
	Failed            int32            `json:"failed,omitempty"`
	Paused            bool             `json:"paused,omitempty"`
	Suspended         bool             `json:"suspended,omitempty"`
	ActiveJobs        int32            `json:"activeJobs,omitempty"`
	Conditions        []ConditionFacts `json:"conditions,omitempty"`
}

type PersistentVolumeFacts struct {
	Phase          string `json:"phase,omitempty"`
	StorageClass   string `json:"storageClass,omitempty"`
	Capacity       string `json:"capacity,omitempty"`
	ReclaimPolicy  string `json:"reclaimPolicy,omitempty"`
	ClaimNamespace string `json:"claimNamespace,omitempty"`
	ClaimName      string `json:"claimName,omitempty"`
	Reason         string `json:"reason,omitempty"`
	Message        string `json:"message,omitempty"`
}

type PersistentVolumeClaimFacts struct {
	Phase        string           `json:"phase,omitempty"`
	StorageClass string           `json:"storageClass,omitempty"`
	VolumeName   string           `json:"volumeName,omitempty"`
	Capacity     string           `json:"capacity,omitempty"`
	Conditions   []ConditionFacts `json:"conditions,omitempty"`
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

type ResourceModel struct {
	Ref      ResourceRef                `json:"ref"`
	Source   ResourceSource             `json:"source"`
	Scope    ResourceScope              `json:"scope"`
	Metadata ResourceMetadata           `json:"metadata"`
	Status   ResourceStatusPresentation `json:"status"`
	Facts    ResourceFacts              `json:"facts"`
}
