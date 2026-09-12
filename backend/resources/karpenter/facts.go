package karpenter

import (
	"fmt"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type Requirement struct {
	Key       string   `json:"key"`
	Operator  string   `json:"operator"`
	Values    []string `json:"values,omitempty"`
	MinValues *int64   `json:"minValues,omitempty"`
}

type Taint struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Effect string `json:"effect"`
}

type Budget struct {
	Nodes    string   `json:"nodes"`
	Reasons  []string `json:"reasons,omitempty"`
	Schedule string   `json:"schedule,omitempty"`
	Duration string   `json:"duration,omitempty"`
}

// Facts are version-tolerant projections from discovered Karpenter objects.
// Missing fields stay absent; controller defaults are never invented here.
type Facts struct {
	NodeClass              *resourcemodel.ResourceLink `json:"nodeClass,omitempty"`
	NodePool               *resourcemodel.ResourceLink `json:"nodePool,omitempty"`
	Node                   *resourcemodel.ResourceLink `json:"node,omitempty"`
	Weight                 *int64                      `json:"weight,omitempty"`
	Replicas               *int64                      `json:"replicas,omitempty"`
	Limits                 map[string]string           `json:"limits,omitempty"`
	Capacity               map[string]string           `json:"capacity,omitempty"`
	Allocatable            map[string]string           `json:"allocatable,omitempty"`
	ConsolidationPolicy    string                      `json:"consolidationPolicy,omitempty"`
	ConsolidateAfter       string                      `json:"consolidateAfter,omitempty"`
	ExpireAfter            string                      `json:"expireAfter,omitempty"`
	TerminationGracePeriod string                      `json:"terminationGracePeriod,omitempty"`
	Requirements           []Requirement               `json:"requirements,omitempty"`
	Taints                 []Taint                     `json:"taints,omitempty"`
	StartupTaints          []Taint                     `json:"startupTaints,omitempty"`
	Budgets                []Budget                    `json:"budgets,omitempty"`
	ProviderID             string                      `json:"providerID,omitempty"`
	ImageID                string                      `json:"imageID,omitempty"`
	InstanceType           string                      `json:"instanceType,omitempty"`
	CapacityType           string                      `json:"capacityType,omitempty"`
	Zone                   string                      `json:"zone,omitempty"`
	Architecture           string                      `json:"architecture,omitempty"`
	Role                   string                      `json:"role,omitempty"`
	InstanceProfile        string                      `json:"instanceProfile,omitempty"`
	ImageFamily            string                      `json:"imageFamily,omitempty"`
	Subnets                []string                    `json:"subnets,omitempty"`
	SecurityGroups         []string                    `json:"securityGroups,omitempty"`
	Images                 []string                    `json:"images,omitempty"`
	Tags                   map[string]string           `json:"tags,omitempty"`
	PriceAdjustment        string                      `json:"priceAdjustment,omitempty"`
}

func BuildFacts(clusterID string, object *unstructured.Unstructured) *Facts {
	if object == nil || resourcekind.FamilyForResource(object.GroupVersionKind().Group, object.GetNamespace() != "") != resourcekind.KarpenterFamily {
		return nil
	}
	facts := &Facts{}
	spec := nestedMap(object.Object, "spec")
	switch object.GetKind() {
	case "NodePool", "Provisioner":
		buildPoolFacts(clusterID, object, spec, facts)
	case "NodeClaim", "Machine":
		buildClaimFacts(clusterID, object, spec, facts)
	case "NodeOverlay":
		facts.Weight = integer(spec, "weight")
		facts.Requirements = decodeList[Requirement](spec, "requirements")
		facts.PriceAdjustment = text(spec, "priceAdjustment")
		facts.Capacity = quantities(spec, "capacity")
	default:
		buildClassFacts(object, spec, facts)
	}
	return facts
}

func buildPoolFacts(clusterID string, object *unstructured.Unstructured, spec map[string]any, facts *Facts) {
	template := nestedMap(spec, "template", "spec")
	if object.GetKind() == "Provisioner" {
		template = spec
	}
	facts.NodeClass = reference(clusterID, nestedMap(template, "nodeClassRef"))
	facts.Weight = integer(spec, "weight")
	facts.Replicas = integer(spec, "replicas")
	facts.Limits = quantities(spec, "limits")
	facts.Capacity = quantities(object.Object, "status", "resources")
	facts.ConsolidationPolicy = text(spec, "disruption", "consolidationPolicy")
	facts.ConsolidateAfter = text(spec, "disruption", "consolidateAfter")
	facts.Budgets = decodeList[Budget](nestedMap(spec, "disruption"), "budgets")
	facts.ExpireAfter = text(template, "expireAfter")
	facts.TerminationGracePeriod = text(template, "terminationGracePeriod")
	facts.Requirements = decodeList[Requirement](template, "requirements")
	facts.Taints = decodeList[Taint](template, "taints")
	facts.StartupTaints = decodeList[Taint](template, "startupTaints")
}

func buildClaimFacts(clusterID string, object *unstructured.Unstructured, spec map[string]any, facts *Facts) {
	facts.NodeClass = reference(clusterID, nestedMap(spec, "nodeClassRef"))
	facts.NodePool = poolReference(clusterID, object)
	if name := text(object.Object, "status", "nodeName"); name != "" {
		link := resourcemodel.NewClusterResourceLink(clusterID, "", "v1", "Node", "nodes", name, "")
		facts.Node = &link
	}
	facts.ProviderID = text(object.Object, "status", "providerID")
	facts.ImageID = text(object.Object, "status", "imageID")
	facts.Capacity = quantities(object.Object, "status", "capacity")
	facts.Allocatable = quantities(object.Object, "status", "allocatable")
	facts.ExpireAfter = text(spec, "expireAfter")
	facts.TerminationGracePeriod = text(spec, "terminationGracePeriod")
	facts.Requirements = decodeList[Requirement](spec, "requirements")
	facts.Taints = decodeList[Taint](spec, "taints")
	facts.StartupTaints = decodeList[Taint](spec, "startupTaints")
	labels := object.GetLabels()
	facts.InstanceType = labels["node.kubernetes.io/instance-type"]
	facts.CapacityType = labels["karpenter.sh/capacity-type"]
	facts.Zone = labels["topology.kubernetes.io/zone"]
	facts.Architecture = labels["kubernetes.io/arch"]
}

func buildClassFacts(object *unstructured.Unstructured, spec map[string]any, facts *Facts) {
	facts.Role = text(spec, "role")
	facts.InstanceProfile = text(spec, "instanceProfile")
	if facts.InstanceProfile == "" {
		facts.InstanceProfile = text(object.Object, "status", "instanceProfile")
	}
	facts.ImageFamily = text(spec, "amiFamily")
	if facts.ImageFamily == "" {
		facts.ImageFamily = text(spec, "imageFamily")
	}
	facts.Subnets = resolvedIDs(object.Object, "subnets")
	facts.SecurityGroups = resolvedIDs(object.Object, "securityGroups")
	facts.Images = resolvedIDs(object.Object, "amis")
	facts.Tags, _, _ = unstructured.NestedStringMap(spec, "tags")
}

func reference(clusterID string, ref map[string]any) *resourcemodel.ResourceLink {
	name, kind := text(ref, "name"), text(ref, "kind")
	if name == "" || kind == "" {
		return nil
	}
	group, version := text(ref, "group"), ""
	if apiVersion := text(ref, "apiVersion"); apiVersion != "" {
		if gv, err := schema.ParseGroupVersion(apiVersion); err == nil {
			group, version = gv.Group, gv.Version
		}
	}
	link := resourcemodel.NewDisplayResourceLink(clusterID, group, version, kind, "", "", name)
	if version != "" {
		link = resourcemodel.NewClusterResourceLink(clusterID, group, version, kind, "", name, "")
	}
	return &link
}

func poolReference(clusterID string, object *unstructured.Unstructured) *resourcemodel.ResourceLink {
	for _, owner := range object.GetOwnerReferences() {
		gv, err := schema.ParseGroupVersion(owner.APIVersion)
		if err == nil && gv.Group == "karpenter.sh" && (owner.Kind == "NodePool" || owner.Kind == "Provisioner") {
			link := resourcemodel.NewClusterResourceLink(clusterID, gv.Group, gv.Version, owner.Kind, "", owner.Name, string(owner.UID))
			return &link
		}
	}
	if name := object.GetLabels()["karpenter.sh/nodepool"]; name != "" {
		link := resourcemodel.NewDisplayResourceLink(clusterID, "karpenter.sh", "", "NodePool", "", "", name)
		return &link
	}
	return nil
}

func text(object map[string]any, fields ...string) string {
	value, _, _ := unstructured.NestedString(object, fields...)
	return value
}
func nestedMap(object map[string]any, fields ...string) map[string]any {
	value, _, _ := unstructured.NestedMap(object, fields...)
	return value
}
func integer(object map[string]any, field string) *int64 {
	value, found, _ := unstructured.NestedInt64(object, field)
	if !found {
		return nil
	}
	return &value
}
func quantities(object map[string]any, fields ...string) map[string]string {
	result := make(map[string]string)
	for key, value := range nestedMap(object, fields...) {
		switch value.(type) {
		case string, int64, float64:
			result[key] = fmt.Sprint(value)
		}
	}
	return result
}
func decodeList[T any](object map[string]any, field string) []T {
	values, _, _ := unstructured.NestedSlice(object, field)
	var result []T
	for _, value := range values {
		raw, ok := value.(map[string]any)
		if !ok {
			continue
		}
		var entry T
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &entry); err == nil {
			result = append(result, entry)
		}
	}
	return result
}
func resolvedIDs(object map[string]any, field string) []string {
	entries, _, _ := unstructured.NestedSlice(object, "status", field)
	var result []string
	for _, entry := range entries {
		if raw, ok := entry.(map[string]any); ok {
			if id := text(raw, "id"); id != "" {
				result = append(result, id)
			}
		}
	}
	return result
}
