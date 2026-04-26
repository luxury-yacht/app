package gatewayapi

import (
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func conditionStates(conditions []metav1.Condition) []types.ConditionState {
	states := make([]types.ConditionState, 0, len(conditions))
	for _, condition := range conditions {
		state := types.ConditionState{
			Type:    condition.Type,
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		}
		if !condition.LastTransitionTime.IsZero() {
			state.LastTransitionTime = condition.LastTransitionTime.Time.Format("2006-01-02 15:04:05")
		}
		states = append(states, state)
	}
	return states
}

func summarizeConditions(conditions []metav1.Condition) types.ConditionsSummary {
	var summary types.ConditionsSummary
	for _, condition := range conditions {
		state := types.ConditionState{
			Type:    condition.Type,
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		}
		if !condition.LastTransitionTime.IsZero() {
			state.LastTransitionTime = condition.LastTransitionTime.Time.Format("2006-01-02 15:04:05")
		}
		switch condition.Type {
		case "Accepted":
			copy := state
			summary.Accepted = &copy
		case "Programmed":
			copy := state
			summary.Programmed = &copy
		case "Ready":
			copy := state
			summary.Ready = &copy
		case "ResolvedRefs":
			copy := state
			summary.Resolved = &copy
		}
	}
	return summary
}
