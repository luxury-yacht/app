/*
 * backend/refresh/streamrows/streamrows.go
 *
 * Neutral leaf package for streaming-snapshot row types and their shared
 * formatters. It depends only on small leaf utilities (timeutil), never on the
 * snapshot package, so each resources/<kind> package can OWN its stream-summary
 * builder and produce these row shapes without importing snapshot — which would
 * otherwise cycle (snapshot imports the kind packages). This mirrors the
 * refresh/objectmap leaf used for object-map status.
 *
 * The row TYPES are domain-shaped (a domain's kinds share a row type, e.g.
 * ConfigMap and Secret both produce ConfigSummary); the per-kind BUILDER that
 * fills a row lives in the kind package. snapshot aliases these types so the wire
 * JSON is unchanged.
 */

package streamrows

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

var errClusterIDRequired = errors.New("snapshot clusterId is required")

// ClusterMeta carries stable cluster identifiers for snapshot payloads. Every
// streaming row embeds it.
type ClusterMeta struct {
	ClusterID   string `json:"clusterId"`
	ClusterName string `json:"clusterName"`
}

// Validate reports whether the cluster identity is usable.
func (m ClusterMeta) Validate() error {
	if strings.TrimSpace(m.ClusterID) == "" {
		return errClusterIDRequired
	}
	return nil
}

// ConfigSummary describes a ConfigMap or Secret row (the namespace-config domain).
type ConfigSummary struct {
	ClusterMeta
	Kind         string `json:"kind"`
	TypeAlias    string `json:"typeAlias,omitempty"`
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Data         int    `json:"data"`
	Age          string `json:"age"`
	AgeTimestamp int64  `json:"ageTimestamp,omitempty"`
}

// RBACSummary describes a Role/RoleBinding/ServiceAccount row (namespace-rbac).
type RBACSummary struct {
	ClusterMeta
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Details      string `json:"details"`
	Age          string `json:"age"`
	AgeTimestamp int64  `json:"ageTimestamp,omitempty"`
}

// NewRBACSummary fills the row skeleton (name/namespace/age from the object plus
// kind/details) shared by the namespace-rbac kinds; each kind package supplies
// its own details string.
func NewRBACSummary(meta ClusterMeta, obj metav1.Object, kind, details string) RBACSummary {
	return RBACSummary{
		ClusterMeta:  meta,
		Kind:         kind,
		Name:         obj.GetName(),
		Namespace:    obj.GetNamespace(),
		Details:      details,
		Age:          FormatAge(obj.GetCreationTimestamp().Time),
		AgeTimestamp: CreationMillis(obj),
	}
}

// AutoscalingSummary captures HPA details for display (namespace-autoscaling).
// TargetAPIVersion carries the scale target's apiVersion so the frontend can open
// the target with a fully-qualified GVK (required for CRD HPA targets).
type AutoscalingSummary struct {
	ClusterMeta
	Kind             string `json:"kind"`
	Name             string `json:"name"`
	Namespace        string `json:"namespace"`
	Target           string `json:"target"`
	TargetAPIVersion string `json:"targetApiVersion,omitempty"`
	Min              int32  `json:"min"`
	Max              int32  `json:"max"`
	Current          int32  `json:"current"`
	Age              string `json:"age"`
	AgeTimestamp     int64  `json:"ageTimestamp,omitempty"`
}

// StorageSummary captures PVC info for display (namespace-storage).
type StorageSummary struct {
	ClusterMeta
	Kind               string `json:"kind"`
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Capacity           string `json:"capacity"`
	Status             string `json:"status"`
	StatusState        string `json:"statusState,omitempty"`
	StatusPresentation string `json:"statusPresentation,omitempty"`
	StatusReason       string `json:"statusReason,omitempty"`
	StorageClass       string `json:"storageClass"`
	Age                string `json:"age"`
	AgeTimestamp       int64  `json:"ageTimestamp,omitempty"`
}

// QuotaSummary captures ResourceQuota/LimitRange/PDB info (namespace-quotas).
// The PDB-specific fields are unset for the other two kinds.
type QuotaSummary struct {
	ClusterMeta
	Kind           string       `json:"kind"`
	Name           string       `json:"name"`
	Namespace      string       `json:"namespace"`
	Details        string       `json:"details"`
	Age            string       `json:"age"`
	AgeTimestamp   int64        `json:"ageTimestamp,omitempty"`
	MinAvailable   *string      `json:"minAvailable,omitempty"`
	MaxUnavailable *string      `json:"maxUnavailable,omitempty"`
	Status         *QuotaStatus `json:"status,omitempty"`
}

// QuotaStatus carries PDB status fields needed by the quotas table.
type QuotaStatus struct {
	DisruptionsAllowed int32 `json:"disruptionsAllowed"`
	CurrentHealthy     int32 `json:"currentHealthy"`
	DesiredHealthy     int32 `json:"desiredHealthy"`
}

// NewQuotaSummary fills the row skeleton shared by the namespace-quotas kinds.
func NewQuotaSummary(meta ClusterMeta, obj metav1.Object, kind, details string) QuotaSummary {
	return QuotaSummary{
		ClusterMeta:  meta,
		Kind:         kind,
		Name:         obj.GetName(),
		Namespace:    obj.GetNamespace(),
		Details:      details,
		Age:          FormatAge(obj.GetCreationTimestamp().Time),
		AgeTimestamp: CreationMillis(obj),
	}
}

// ClusterRBACEntry represents a ClusterRole or ClusterRoleBinding (cluster-rbac).
type ClusterRBACEntry struct {
	ClusterMeta
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Details      string `json:"details"`
	Age          string `json:"age"`
	AgeTimestamp int64  `json:"ageTimestamp,omitempty"`
	TypeAlias    string `json:"typeAlias,omitempty"`
}

// NewClusterRBACEntry fills the row skeleton shared by the cluster-rbac kinds.
func NewClusterRBACEntry(meta ClusterMeta, obj metav1.Object, kind, details, typeAlias string) ClusterRBACEntry {
	return ClusterRBACEntry{
		ClusterMeta:  meta,
		Kind:         kind,
		Name:         obj.GetName(),
		Details:      details,
		Age:          FormatAge(obj.GetCreationTimestamp().Time),
		AgeTimestamp: CreationMillis(obj),
		TypeAlias:    typeAlias,
	}
}

// ClusterConfigEntry represents a StorageClass/IngressClass/GatewayClass/webhook
// configuration row (cluster-config).
type ClusterConfigEntry struct {
	ClusterMeta
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Details      string `json:"details"`
	IsDefault    bool   `json:"isDefault,omitempty"`
	Age          string `json:"age"`
	AgeTimestamp int64  `json:"ageTimestamp,omitempty"`
}

// NewClusterConfigEntry fills the row skeleton shared by the cluster-config kinds.
func NewClusterConfigEntry(meta ClusterMeta, obj metav1.Object, kind, details string, isDefault bool) ClusterConfigEntry {
	return ClusterConfigEntry{
		ClusterMeta:  meta,
		Kind:         kind,
		Name:         obj.GetName(),
		Details:      details,
		IsDefault:    isDefault,
		Age:          FormatAge(obj.GetCreationTimestamp().Time),
		AgeTimestamp: CreationMillis(obj),
	}
}

// ClusterStorageEntry represents a PersistentVolume row (cluster-storage).
type ClusterStorageEntry struct {
	ClusterMeta
	Kind               string `json:"kind"`
	Name               string `json:"name"`
	StorageClass       string `json:"storageClass,omitempty"`
	Capacity           string `json:"capacity"`
	AccessModes        string `json:"accessModes"`
	Status             string `json:"status"`
	StatusState        string `json:"statusState,omitempty"`
	StatusPresentation string `json:"statusPresentation,omitempty"`
	StatusReason       string `json:"statusReason,omitempty"`
	Claim              string `json:"claim"`
	Age                string `json:"age"`
	AgeTimestamp       int64  `json:"ageTimestamp,omitempty"`
}

// ClusterCRDEntry represents a CustomResourceDefinition row (cluster-crds).
type ClusterCRDEntry struct {
	ClusterMeta
	Kind                    string `json:"kind"`
	Name                    string `json:"name"`
	Group                   string `json:"group"`
	Scope                   string `json:"scope"`
	Details                 string `json:"details"`
	StorageVersion          string `json:"storageVersion,omitempty"`
	ExtraServedVersionCount int    `json:"extraServedVersionCount,omitempty"`
	Age                     string `json:"age"`
	AgeTimestamp            int64  `json:"ageTimestamp,omitempty"`
	TypeAlias               string `json:"typeAlias,omitempty"`
}

// NamespaceCustomSummary is a CRD-backed namespaced custom resource row.
type NamespaceCustomSummary struct {
	ClusterMeta
	Kind               string                         `json:"kind"`
	Name               string                         `json:"name"`
	APIGroup           string                         `json:"apiGroup"`
	APIVersion         string                         `json:"apiVersion"`
	CRDName            string                         `json:"crdName,omitempty"`
	Namespace          string                         `json:"namespace"`
	Status             string                         `json:"status,omitempty"`
	StatusState        string                         `json:"statusState,omitempty"`
	StatusPresentation string                         `json:"statusPresentation,omitempty"`
	Ready              *bool                          `json:"ready,omitempty"`
	ObservedGeneration *int64                         `json:"observedGeneration,omitempty"`
	Conditions         []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
	Age                string                         `json:"age"`
	Labels             map[string]string              `json:"labels,omitempty"`
	Annotations        map[string]string              `json:"annotations,omitempty"`
}

// ClusterCustomSummary is a CRD-backed cluster-scoped custom resource row.
type ClusterCustomSummary struct {
	ClusterMeta
	Kind               string                         `json:"kind"`
	Name               string                         `json:"name"`
	APIGroup           string                         `json:"apiGroup"`
	APIVersion         string                         `json:"apiVersion"`
	CRDName            string                         `json:"crdName,omitempty"`
	Status             string                         `json:"status,omitempty"`
	StatusState        string                         `json:"statusState,omitempty"`
	StatusPresentation string                         `json:"statusPresentation,omitempty"`
	Ready              *bool                          `json:"ready,omitempty"`
	ObservedGeneration *int64                         `json:"observedGeneration,omitempty"`
	Conditions         []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
	Age                string                         `json:"age"`
	Labels             map[string]string              `json:"labels,omitempty"`
	Annotations        map[string]string              `json:"annotations,omitempty"`
}

// NetworkSummary is a Service/Ingress/EndpointSlice/NetworkPolicy/Gateway-API row
// (the namespace-network domain).
type NetworkSummary struct {
	ClusterMeta
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Details      string `json:"details"`
	Age          string `json:"age"`
	AgeTimestamp int64  `json:"ageTimestamp,omitempty"`
}

// NewNetworkSummary fills the row skeleton shared by the namespace-network kinds.
func NewNetworkSummary(meta ClusterMeta, obj metav1.Object, kind, details string) NetworkSummary {
	return NetworkSummary{
		ClusterMeta:  meta,
		Kind:         kind,
		Name:         obj.GetName(),
		Namespace:    obj.GetNamespace(),
		Details:      details,
		Age:          FormatAge(obj.GetCreationTimestamp().Time),
		AgeTimestamp: CreationMillis(obj),
	}
}

// PodSummary is a pod row (the pods domain).
type PodSummary struct {
	ClusterMeta
	Name                 string `json:"name"`
	Namespace            string `json:"namespace"`
	Node                 string `json:"node"`
	Status               string `json:"status"`
	StatusState          string `json:"statusState,omitempty"`
	StatusPresentation   string `json:"statusPresentation,omitempty"`
	StatusReason         string `json:"statusReason,omitempty"`
	Ready                string `json:"ready"`
	Restarts             int32  `json:"restarts"`
	Age                  string `json:"age"`
	AgeTimestamp         int64  `json:"ageTimestamp,omitempty"`
	OwnerKind            string `json:"ownerKind"`
	OwnerName            string `json:"ownerName"`
	PortForwardAvailable bool   `json:"portForwardAvailable"`
	OwnerAPIVersion      string `json:"ownerApiVersion,omitempty"`
	CPURequest           string `json:"cpuRequest"`
	CPULimit             string `json:"cpuLimit"`
	CPUUsage             string `json:"cpuUsage"`
	MemRequest           string `json:"memRequest"`
	MemLimit             string `json:"memLimit"`
	MemUsage             string `json:"memUsage"`
}

// WorkloadSummary is a Deployment/StatefulSet/DaemonSet/Job/CronJob/Pod row
// (the namespace-workloads domain).
type WorkloadSummary struct {
	ClusterMeta
	Kind                 string `json:"kind"`
	Name                 string `json:"name"`
	Namespace            string `json:"namespace"`
	Ready                string `json:"ready"`
	Status               string `json:"status"`
	StatusState          string `json:"statusState,omitempty"`
	StatusPresentation   string `json:"statusPresentation,omitempty"`
	StatusReason         string `json:"statusReason,omitempty"`
	Restarts             int32  `json:"restarts"`
	Age                  string `json:"age"`
	AgeTimestamp         int64  `json:"ageTimestamp,omitempty"`
	CPUUsage             string `json:"cpuUsage,omitempty"`
	CPURequest           string `json:"cpuRequest,omitempty"`
	CPULimit             string `json:"cpuLimit,omitempty"`
	MemUsage             string `json:"memUsage,omitempty"`
	MemRequest           string `json:"memRequest,omitempty"`
	MemLimit             string `json:"memLimit,omitempty"`
	PortForwardAvailable bool   `json:"portForwardAvailable"`
	DesiredReplicas      *int32 `json:"desiredReplicas,omitempty"`
	HPAManaged           *bool  `json:"hpaManaged,omitempty"`
}

// NodeSummary is a node row (the nodes domain).
type NodeSummary struct {
	ClusterMeta
	Name               string            `json:"name"`
	Status             string            `json:"status"`
	StatusState        string            `json:"statusState,omitempty"`
	StatusPresentation string            `json:"statusPresentation,omitempty"`
	StatusReason       string            `json:"statusReason,omitempty"`
	Roles              string            `json:"roles"`
	Age                string            `json:"age"`
	AgeTimestamp       int64             `json:"ageTimestamp,omitempty"`
	Version            string            `json:"version"`
	InternalIP         string            `json:"internalIP,omitempty"`
	ExternalIP         string            `json:"externalIP,omitempty"`
	CPUCapacity        string            `json:"cpuCapacity"`
	CPUAllocatable     string            `json:"cpuAllocatable"`
	CPURequests        string            `json:"cpuRequests"`
	CPULimits          string            `json:"cpuLimits"`
	CPUUsage           string            `json:"cpuUsage"`
	MemoryCapacity     string            `json:"memoryCapacity"`
	MemoryAllocatable  string            `json:"memoryAllocatable"`
	MemRequests        string            `json:"memRequests"`
	MemLimits          string            `json:"memLimits"`
	MemoryUsage        string            `json:"memoryUsage"`
	Pods               string            `json:"pods"`
	PodsCapacity       string            `json:"podsCapacity"`
	PodsAllocatable    string            `json:"podsAllocatable"`
	Restarts           int32             `json:"restarts"`
	Kind               string            `json:"kind"`
	CPU                string            `json:"cpu"`
	Memory             string            `json:"memory"`
	Unschedulable      bool              `json:"unschedulable"`
	Labels             map[string]string `json:"labels,omitempty"`
	Annotations        map[string]string `json:"annotations,omitempty"`
	Taints             []NodeTaint       `json:"taints,omitempty"`
	PodMetrics         []NodePodMetric   `json:"podMetrics,omitempty"`
}

// NodeTaint is a node taint shown in the node row.
type NodeTaint struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Effect string `json:"effect"`
}

// NodePodMetric is a per-pod usage entry shown in the node row.
type NodePodMetric struct {
	Namespace   string `json:"namespace"`
	Name        string `json:"name"`
	CPUUsage    string `json:"cpuUsage"`
	MemoryUsage string `json:"memoryUsage"`
}

// FormatCPUMilli renders CPU millicores as the streaming rows display them.
func FormatCPUMilli(value int64) string {
	return fmt.Sprintf("%dm", value)
}

// FormatMemoryBytes renders a byte count as the streaming rows display it.
func FormatMemoryBytes(bytes int64) string {
	if bytes <= 0 {
		return "0Mi"
	}
	gb := float64(bytes) / (1024 * 1024 * 1024)
	if gb >= 1 {
		return fmt.Sprintf("%.1f GB", gb)
	}
	mb := float64(bytes) / (1024 * 1024)
	if mb >= 1 {
		return fmt.Sprintf("%.0f MB", mb)
	}
	kb := float64(bytes) / 1024
	return fmt.Sprintf("%.0f KB", kb)
}

// FormatAge renders an object's age the way every streaming row displays it.
func FormatAge(t time.Time) string {
	return timeutil.FormatAge(t)
}

// CreationMillis is the object creation time in unix millis, 0 when unset.
func CreationMillis(obj metav1.Object) int64 {
	if obj == nil {
		return 0
	}
	ts := obj.GetCreationTimestamp()
	if ts.IsZero() {
		return 0
	}
	return ts.UnixMilli()
}
