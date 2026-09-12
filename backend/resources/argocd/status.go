package argocd

import (
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"strings"
)

func statusOrUnknown(value string) string {
	if value == "" {
		return "Unknown"
	}
	return value
}

func statusPresentation(status string) string {
	switch strings.ToLower(status) {
	case "healthy", "synced", "succeeded", "true":
		return "ready"
	case "progressing", "running":
		return "progressing"
	case "degraded", "failed", "error":
		return "error"
	case "outofsync", "missing", "suspended", "false":
		return "warning"
	default:
		return "unknown"
	}
}

// PrimaryStatus keeps Argo's health semantics in every custom-resource projection.
// Sync remains a separate signal: a synced Application can still be degraded.
func PrimaryStatus(object *unstructured.Unstructured) (state, label, presentation string, ok bool) {
	if !isArgoCD(object) {
		return "", "", "", false
	}
	switch strings.ToLower(object.GetKind()) {
	case "application":
		state = statusOrUnknown(text(object.Object, "status", "health", "status"))
	case "applicationset":
		state = applicationSetHealth(conditions(object))
	default:
		return "", "", "", false
	}
	return state, state, statusPresentation(state), true
}

func applicationSetHealth(conditions []Condition) string {
	result := "Unknown"
	for _, condition := range conditions {
		if condition.Type == "ErrorOccurred" && condition.Status == "True" {
			return "Degraded"
		}
		if condition.Type == "ResourcesUpToDate" {
			if condition.Status == "True" {
				result = "Healthy"
			} else {
				result = "Progressing"
			}
		}
	}
	return result
}

func conditions(object *unstructured.Unstructured) []Condition {
	values, _, _ := unstructured.NestedSlice(object.Object, "status", "conditions")
	result := make([]Condition, 0, len(values))
	for _, raw := range values {
		record, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		condition := read[Condition](map[string]any{"condition": record}, "condition")
		if condition == nil || condition.Type == "" {
			continue
		}
		condition.Presentation = conditionPresentation(*condition)
		result = append(result, *condition)
	}
	return result
}

func conditionPresentation(condition Condition) string {
	if condition.Type == "ErrorOccurred" {
		switch condition.Status {
		case "True":
			return "error"
		case "False":
			return "ready"
		default:
			return "unknown"
		}
	}
	// Application conditions report errors/warnings by type, without a boolean status.
	if condition.Status == "" {
		if strings.HasSuffix(condition.Type, "Error") {
			return "error"
		}
		if strings.HasSuffix(condition.Type, "Warning") {
			return "warning"
		}
		return "unknown"
	}
	return statusPresentation(condition.Status)
}
