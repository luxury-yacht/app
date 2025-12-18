package types

// DrainNodeOptions contains options for draining a node.
type DrainNodeOptions struct {
	GracePeriodSeconds         int  `json:"gracePeriodSeconds"`
	IgnoreDaemonSets           bool `json:"ignoreDaemonSets"`
	DeleteEmptyDirData         bool `json:"deleteEmptyDirData"`
	Force                      bool `json:"force"`
	DisableEviction            bool `json:"disableEviction"`
	SkipWaitForPodsToTerminate bool `json:"skipWaitForPodsToTerminate"`
}

// NodeDetails represents comprehensive node information for the object panel.
type NodeDetails struct {
	Name              string            `json:"name"`
	Status            string            `json:"status"`
	Unschedulable     bool              `json:"unschedulable"`
	Roles             string            `json:"roles"`
	Age               string            `json:"age"`
	Version           string            `json:"version"`
	InternalIP        string            `json:"internalIP"`
	ExternalIP        string            `json:"externalIP,omitempty"`
	Hostname          string            `json:"hostname"`
	Architecture      string            `json:"architecture"`
	OS                string            `json:"os"`
	OSImage           string            `json:"osImage"`
	KernelVersion     string            `json:"kernelVersion"`
	ContainerRuntime  string            `json:"containerRuntime"`
	KubeletVersion    string            `json:"kubeletVersion"`
	CPUCapacity       string            `json:"cpuCapacity"`
	CPUAllocatable    string            `json:"cpuAllocatable"`
	MemoryCapacity    string            `json:"memoryCapacity"`
	MemoryAllocatable string            `json:"memoryAllocatable"`
	PodsCapacity      string            `json:"podsCapacity"`
	PodsAllocatable   string            `json:"podsAllocatable"`
	StorageCapacity   string            `json:"storageCapacity,omitempty"`
	PodsCount         int               `json:"podsCount"`
	Restarts          int32             `json:"restarts"`
	CPURequests       string            `json:"cpuRequests"`
	CPULimits         string            `json:"cpuLimits"`
	MemRequests       string            `json:"memRequests"`
	MemLimits         string            `json:"memLimits"`
	CPUUsage          string            `json:"cpuUsage,omitempty"`
	MemoryUsage       string            `json:"memoryUsage,omitempty"`
	Kind              string            `json:"kind"`
	CPU               string            `json:"cpu"`
	Memory            string            `json:"memory"`
	Pods              string            `json:"pods"`
	Conditions        []NodeCondition   `json:"conditions"`
	Taints            []NodeTaint       `json:"taints,omitempty"`
	Labels            map[string]string `json:"labels,omitempty"`
	Annotations       map[string]string `json:"annotations,omitempty"`
	PodsList          []PodSimpleInfo   `json:"podsList,omitempty"`
}

// NodeCondition represents a node condition.
type NodeCondition struct {
	Kind    string `json:"kind"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
}

// NodeTaint represents a node taint.
type NodeTaint struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Effect string `json:"effect"`
}
