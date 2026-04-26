package gatewayapi

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestSummarizeConditionsPicksKnownConditionTypes(t *testing.T) {
	summary := summarizeConditions([]metav1.Condition{
		{Type: "Accepted", Status: metav1.ConditionTrue, Reason: "Accepted"},
		{Type: "Programmed", Status: metav1.ConditionFalse, Reason: "Pending"},
		{Type: "ResolvedRefs", Status: metav1.ConditionTrue, Reason: "Resolved"},
	})

	if summary.Accepted == nil || summary.Accepted.Status != "True" || summary.Accepted.Reason != "Accepted" {
		t.Fatalf("unexpected accepted summary: %#v", summary.Accepted)
	}
	if summary.Programmed == nil || summary.Programmed.Status != "False" || summary.Programmed.Reason != "Pending" {
		t.Fatalf("unexpected programmed summary: %#v", summary.Programmed)
	}
	if summary.Resolved == nil || summary.Resolved.Status != "True" || summary.Resolved.Reason != "Resolved" {
		t.Fatalf("unexpected resolved summary: %#v", summary.Resolved)
	}
}
