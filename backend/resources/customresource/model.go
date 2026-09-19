/*
 * backend/resources/customresource/model.go
 *
 * CustomResource resource model: dynamic status extraction for any custom resource
 * instance (unstructured), feeding snapshot streaming summary rows and discovered
 * resource-family detail enrichments. Shared model helpers come from resourcemodel.
 */

package customresource

import (
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/argocd"
	"github.com/luxury-yacht/app/backend/resources/certmanager"
	"github.com/luxury-yacht/app/backend/resources/crdfacts"
	"github.com/luxury-yacht/app/backend/resources/externalsecrets"
	"github.com/luxury-yacht/app/backend/resources/prometheus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Descriptor is the discovery-backed identity shared by custom-resource model
// and stream projections.
type Descriptor struct {
	GVR          schema.GroupVersionResource
	KindFallback string
	CRDName      string
}

func NewDescriptor(group, version, resource, kindFallback, crdName string) Descriptor {
	return Descriptor{
		GVR:          schema.GroupVersionResource{Group: group, Version: version, Resource: resource},
		KindFallback: kindFallback,
		CRDName:      crdName,
	}
}

// BuildResourceModel builds a CustomResource resource model. Facts are owned by this
// package (customresource.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(
	clusterID string,
	resource *unstructured.Unstructured,
	descriptor Descriptor,
	scope resourcemodel.ResourceScope,
	namespaceFallback string,
) resourcemodel.ResourceModel {
	return buildResourceModel(clusterID, resource, descriptor, scope, namespaceFallback, BuildFacts(resource))
}

func buildResourceModel(clusterID string, resource *unstructured.Unstructured, descriptor Descriptor, scope resourcemodel.ResourceScope, namespaceFallback string, facts Facts) resourcemodel.ResourceModel {
	gvr := descriptor.GVR
	meta := objectMetaFromUnstructured(resource)
	if resource != nil && meta.Namespace == "" {
		meta.Namespace = namespaceFallback
	}
	status := statusPresentation(resource, meta, facts)
	kind := resourceKind(resource, descriptor.KindFallback)
	return resourcemodel.KubernetesResourceModel(clusterID, resourcekind.Identity{
		Group: gvr.Group, Version: gvr.Version, Kind: kind, Resource: gvr.Resource,
		Namespaced: scope == resourcemodel.ResourceScopeNamespaced,
	}, meta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the status shared by custom-resource details and table rows.
func BuildFacts(resource *unstructured.Unstructured) Facts {
	if resource == nil {
		return Facts{}
	}
	conditions := customResourceConditions(resource.Object)
	return Facts{
		Phase:              crdfacts.Text(resource.Object, "status", "phase"),
		State:              crdfacts.Text(resource.Object, "status", "state"),
		Ready:              customResourceReady(resource.Object, conditions),
		ObservedGeneration: crdfacts.Number(resource.Object, "status", "observedGeneration"),
		Conditions:         conditions,
	}
}

func statusPresentation(resource *unstructured.Unstructured, meta metav1.ObjectMeta, facts Facts) resourcemodel.ResourceStatusPresentation {
	signals := make([]resourcemodel.ResourceStatusSignal, 0, len(facts.Conditions)+3)
	if facts.Phase != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalPhase, Name: "status.phase", Status: facts.Phase})
	}
	if facts.State != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "status.state", Status: facts.State})
	}
	if facts.Ready != nil {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalReadiness, Name: "status.ready", Status: fmt.Sprintf("%t", *facts.Ready)})
	}
	signals = append(signals, resourcemodel.ConditionSignals(facts.Conditions)...)

	state, label, presentation := familyStatus(resource, facts)
	lifecycle := resourcemodel.ObjectLifecycle(meta)
	if status, ok := resourcemodel.DeletingObjectStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.ObjectSourceStatus(label, state, "", "", presentation, signals, lifecycle)
}

func familyStatus(resource *unstructured.Unstructured, facts Facts) (string, string, string) {
	for _, project := range []func(*unstructured.Unstructured) (string, string, string, bool){
		argocd.PrimaryStatus, certmanager.PrimaryStatus, externalsecrets.PrimaryStatus, prometheus.PrimaryStatus,
	} {
		if state, label, presentation, ok := project(resource); ok {
			return state, label, presentation
		}
	}
	return primaryStatus(facts)
}

func primaryStatus(facts Facts) (state, label, presentation string) {
	if facts.Phase != "" {
		return facts.Phase, facts.Phase, presentationForState(facts.Phase)
	}
	if facts.State != "" {
		return facts.State, facts.State, presentationForState(facts.State)
	}
	if facts.Ready != nil {
		if *facts.Ready {
			return "true", "Ready", "ready"
		}
		return "false", "Not Ready", "warning"
	}
	if condition := conditionByType(facts.Conditions, "Ready"); condition != nil {
		return condition.Status, condition.Status, presentationForCondition(condition.Status)
	}
	return "unknown", "Unknown", "unknown"
}

func customResourceConditions(object map[string]any) []resourcemodel.ConditionFacts {
	conditions, ok, _ := unstructured.NestedSlice(object, "status", "conditions")
	if !ok || len(conditions) == 0 {
		return nil
	}
	facts := make([]resourcemodel.ConditionFacts, 0, len(conditions))
	for _, raw := range conditions {
		condition, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		next := resourcemodel.ConditionFacts{
			Type:    stringValue(condition["type"]),
			Status:  stringValue(condition["status"]),
			Reason:  stringValue(condition["reason"]),
			Message: stringValue(condition["message"]),
		}
		if timestamp := stringValue(condition["lastTransitionTime"]); timestamp != "" {
			if parsed, err := time.Parse(time.RFC3339, timestamp); err == nil {
				next.LastTransitionTime = metav1.NewTime(parsed)
			}
		}
		if next.Type == "" && next.Status == "" {
			continue
		}
		facts = append(facts, next)
	}
	return facts
}

func customResourceReady(object map[string]any, conditions []resourcemodel.ConditionFacts) *bool {
	if ready, ok, _ := unstructured.NestedBool(object, "status", "ready"); ok {
		return &ready
	}
	if readyString := crdfacts.Text(object, "status", "ready"); readyString != "" {
		return readinessValue(readyString)
	}
	if condition := conditionByType(conditions, "Ready"); condition != nil {
		return readinessValue(condition.Status)
	}
	return nil
}

func readinessValue(status string) *bool {
	switch strings.ToLower(status) {
	case "true", "false":
		ready := strings.EqualFold(status, "true")
		return &ready
	default:
		return nil
	}
}

func conditionByType(conditions []resourcemodel.ConditionFacts, conditionType string) *resourcemodel.ConditionFacts {
	for i := range conditions {
		if strings.EqualFold(conditions[i].Type, conditionType) {
			return &conditions[i]
		}
	}
	return nil
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func presentationForState(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "ready", "running", "active", "available", "bound", "succeeded", "true":
		return "ready"
	case "pending", "progressing", "reconciling", "creating", "updating":
		return "progressing"
	case "failed", "error", "false":
		return "error"
	default:
		return "unknown"
	}
}

func presentationForCondition(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "true":
		return "ready"
	case "false":
		return "warning"
	default:
		return "unknown"
	}
}

func resourceKind(resource *unstructured.Unstructured, fallback string) string {
	if resource == nil {
		return fallback
	}
	if kind := strings.TrimSpace(resource.GetKind()); kind != "" {
		return kind
	}
	return fallback
}

func objectMetaFromUnstructured(resource *unstructured.Unstructured) metav1.ObjectMeta {
	if resource == nil {
		return metav1.ObjectMeta{}
	}
	return metav1.ObjectMeta{
		Name:              resource.GetName(),
		Namespace:         resource.GetNamespace(),
		UID:               resource.GetUID(),
		ResourceVersion:   resource.GetResourceVersion(),
		Generation:        resource.GetGeneration(),
		Labels:            resource.GetLabels(),
		Annotations:       resource.GetAnnotations(),
		CreationTimestamp: resource.GetCreationTimestamp(),
		DeletionTimestamp: resource.GetDeletionTimestamp(),
		Finalizers:        resource.GetFinalizers(),
	}
}
