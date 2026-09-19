package types

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestRouteConditionsAndSummaryPreserveTheSameConditionEvidence(t *testing.T) {
	for _, transition := range []metav1.Time{{}, {Time: time.Date(2026, 9, 18, 12, 30, 0, 0, time.UTC)}} {
		condition := resourcemodel.ConditionFacts{Type: "Accepted", Status: "False", Reason: "NotAllowedByListeners", Message: "namespace not allowed", LastTransitionTime: transition}
		detail := RouteDetailsFromFacts("HTTPRoute", metav1.ObjectMeta{}, resourcemodel.RouteCommonFacts{
			Conditions: []resourcemodel.ConditionFacts{condition},
			Summary:    resourcemodel.ConditionsSummaryFacts{Accepted: &condition},
		})
		require.Len(t, detail.Conditions, 1)
		require.Equal(t, &detail.Conditions[0], detail.Summary.Accepted)
		require.Equal(t, condition.Status, detail.Conditions[0].Status)
		require.Equal(t, condition.Reason, detail.Conditions[0].Reason)
		require.Equal(t, condition.Message, detail.Conditions[0].Message)
		if transition.IsZero() {
			require.Empty(t, detail.Conditions[0].LastTransitionTime)
		} else {
			parsed, err := time.Parse("2006-01-02 15:04:05", detail.Conditions[0].LastTransitionTime)
			require.NoError(t, err)
			require.Equal(t, transition.Time, parsed)
		}
		require.Nil(t, detail.Summary.Ready)
	}
}
