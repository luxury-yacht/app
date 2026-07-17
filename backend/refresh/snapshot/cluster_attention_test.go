package snapshot

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

func attentionTestRef(kind, namespace, name string) resourcemodel.ResourceRef {
	group := "apps"
	resource := "deployments"
	if kind == "Pod" || kind == "Node" || kind == "Event" {
		group = ""
	}
	switch kind {
	case "Pod":
		resource = "pods"
	case "Node":
		resource = "nodes"
	case "Event":
		resource = "events"
	}
	return resourcemodel.ResourceRef{
		ClusterID: "cluster-a",
		Group:     group,
		Version:   "v1",
		Kind:      kind,
		Resource:  resource,
		Namespace: namespace,
		Name:      name,
		UID:       "uid-" + name,
	}
}

func TestEvaluateAttentionSourceCombinesPodReasonsAndPreservesIdentity(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	record := attentionSourceRecord{
		Ref:                attentionTestRef("Pod", "payments", "checkout-0"),
		Source:             attentionSourcePod,
		Status:             "CrashLoopBackOff",
		StatusPresentation: "error",
		StatusReason:       "CrashLoopBackOff",
		Restarts:           4,
		AgeTimestamp:       now.Add(-10 * time.Minute).UnixMilli(),
	}

	evaluation := evaluateAttentionSource(record, now)
	require.NotNil(t, evaluation.Finding)
	require.Equal(t, record.Ref, evaluation.Finding.Ref)
	require.Equal(t, "error", evaluation.Finding.Severity)
	require.Equal(t, "CrashLoopBackOff", evaluation.Finding.Status)
	require.Equal(t, []string{"CrashLoopBackOff", "4 restarts"}, evaluation.Finding.Reasons)
	require.True(t, evaluation.NextEvaluation.IsZero())
}

func TestEvaluateAttentionSourceDefersTransientPodWarningsUntilGracePeriod(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	createdAt := now.Add(-2 * time.Minute)
	record := attentionSourceRecord{
		Ref:                attentionTestRef("Pod", "payments", "checkout-1"),
		Source:             attentionSourcePod,
		Status:             "ContainerCreating",
		StatusPresentation: "warning",
		StatusReason:       "ContainerCreating",
		AgeTimestamp:       createdAt.UnixMilli(),
	}

	beforeGrace := evaluateAttentionSource(record, now)
	require.Nil(t, beforeGrace.Finding)
	require.Equal(t, createdAt.Add(attentionWarningGrace), beforeGrace.NextEvaluation)

	afterGrace := evaluateAttentionSource(record, createdAt.Add(attentionWarningGrace))
	require.NotNil(t, afterGrace.Finding)
	require.Equal(t, []string{"ContainerCreating"}, afterGrace.Finding.Reasons)
	require.True(t, afterGrace.NextEvaluation.IsZero())
}

func TestEvaluateAttentionSourceReportsInsufficientWorkloadReplicasAfterGrace(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	record := attentionSourceRecord{
		Ref:                attentionTestRef("Deployment", "payments", "checkout"),
		Source:             attentionSourceWorkload,
		Status:             "Updating",
		StatusPresentation: "warning",
		Ready:              "2/3",
		AgeTimestamp:       now.Add(-10 * time.Minute).UnixMilli(),
	}

	evaluation := evaluateAttentionSource(record, now)
	require.NotNil(t, evaluation.Finding)
	require.Equal(t, "warning", evaluation.Finding.Severity)
	require.Equal(t, []string{"Updating", "2/3 ready"}, evaluation.Finding.Reasons)
}

func TestEvaluateAttentionSourceReportsOnlyNodesThatNeedAttention(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	ready := attentionSourceRecord{
		Ref:                attentionTestRef("Node", "", "worker-a"),
		Source:             attentionSourceNode,
		Status:             "Ready",
		StatusPresentation: "ready",
	}
	require.Nil(t, evaluateAttentionSource(ready, now).Finding)

	cordoned := ready
	cordoned.Status = "Ready (Cordoned)"
	cordoned.StatusPresentation = "cordoned"
	evaluation := evaluateAttentionSource(cordoned, now)
	require.NotNil(t, evaluation.Finding)
	require.Equal(t, []string{"Ready (Cordoned)"}, evaluation.Finding.Reasons)
}

func TestEvaluateAttentionSourceExpiresWarningEventsAtTheLookbackBoundary(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	observedAt := now.Add(-time.Hour)
	record := attentionSourceRecord{
		Ref:          attentionTestRef("Event", "payments", "checkout-backoff"),
		Source:       attentionSourceEvent,
		Status:       "Warning",
		StatusReason: "BackOff",
		Message:      "Back-off restarting failed container",
		AgeTimestamp: observedAt.UnixMilli(),
	}

	evaluation := evaluateAttentionSource(record, now)
	require.NotNil(t, evaluation.Finding)
	require.Equal(t, []string{"BackOff", "Back-off restarting failed container"}, evaluation.Finding.Reasons)
	require.Equal(t, observedAt.Add(attentionEventLookback), evaluation.NextEvaluation)

	expired := evaluateAttentionSource(record, observedAt.Add(attentionEventLookback))
	require.Nil(t, expired.Finding)
	require.True(t, expired.NextEvaluation.IsZero())
}
