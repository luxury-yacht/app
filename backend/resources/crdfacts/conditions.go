package crdfacts

import "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

type Condition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
	ObservedGeneration *int64 `json:"observedGeneration,omitempty"`
	Presentation       string `json:"presentation"`
}

func Conditions(object *unstructured.Unstructured) []Condition {
	values, _, _ := unstructured.NestedSlice(object.Object, "status", "conditions")
	var result []Condition
	for _, value := range values {
		condition := Read[Condition](map[string]any{"condition": value}, "condition")
		if condition == nil || condition.Type == "" {
			continue
		}
		condition.Presentation = conditionPresentation(*condition)
		if condition.ObservedGeneration != nil && *condition.ObservedGeneration < object.GetGeneration() {
			condition.Presentation = "progressing"
		}
		result = append(result, *condition)
	}
	return result
}

func conditionPresentation(condition Condition) string {
	if condition.Status != "True" && condition.Status != "False" {
		return "unknown"
	}
	if condition.Type == "Denied" {
		if condition.Status == "True" {
			return "error"
		}
		return "ready"
	}
	if condition.Type == "Issuing" {
		if condition.Status == "True" {
			return "progressing"
		}
		return "ready"
	}
	if condition.Status == "True" {
		return "ready"
	}
	return "warning"
}

func FindCondition(conditions []Condition, name string) *Condition {
	for i := range conditions {
		if conditions[i].Type == name {
			return &conditions[i]
		}
	}
	return nil
}

func Readiness(conditions []Condition, names ...string) (state, label, presentation string) {
	for _, name := range names {
		condition := FindCondition(conditions, name)
		if condition == nil {
			continue
		}
		if condition.Presentation == "progressing" {
			return condition.Status, "Reconciling", "progressing"
		}
		switch condition.Status {
		case "True":
			return condition.Status, "Ready", "ready"
		case "False":
			return condition.Status, "Not Ready", "warning"
		default:
			return condition.Status, "Unknown", "unknown"
		}
	}
	return "unknown", "Unknown", "unknown"
}
