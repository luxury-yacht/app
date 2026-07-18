package snapshot

import (
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

func TestFrontendAttentionFindingTypeConstantsBelongToBackendCatalog(t *testing.T) {
	source, err := os.ReadFile("../../../frontend/src/modules/cluster/clusterAttentionFindingTypes.ts")
	require.NoError(t, err)
	matches := regexp.MustCompile(`:\s*'([^']+)'`).FindAllSubmatch(source, -1)
	require.NotEmpty(t, matches)
	for _, match := range matches {
		require.True(t, IsAttentionFindingType(string(match[1])), "frontend finding type %q is absent from backend catalog", match[1])
	}
}

func attentionTestRef(kind, namespace, name string) resourcemodel.ResourceRef {
	group := ""
	resource := ""
	switch kind {
	case "Pod":
		resource = "pods"
	case "Node":
		resource = "nodes"
	case "Event":
		resource = "events"
	case "Deployment":
		group, resource = "apps", "deployments"
	case "StatefulSet":
		group, resource = "apps", "statefulsets"
	case "DaemonSet":
		group, resource = "apps", "daemonsets"
	case "Job":
		group, resource = "batch", "jobs"
	case "CronJob":
		group, resource = "batch", "cronjobs"
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

func TestAttentionPoliciesUseTheClosedSeverityCatalog(t *testing.T) {
	require.Equal(t, map[AttentionSeverity]attentionSeverityDefinition{
		AttentionSeverityInfo:    {Priority: 1, SortRank: 2},
		AttentionSeverityWarning: {Priority: 2, SortRank: 1},
		AttentionSeverityError:   {Priority: 3, SortRank: 0},
	}, attentionSeverityDefinitions)

	ruleIDs := make(map[string]bool, len(attentionClassificationRules))
	for _, rule := range attentionClassificationRules {
		require.NotEmpty(t, rule.ID)
		require.NotEmpty(t, rule.Label)
		require.False(t, ruleIDs[rule.ID], "duplicate Attention classification rule %q", rule.ID)
		ruleIDs[rule.ID] = true
		require.Contains(t, attentionSeverityDefinitions, rule.Severity, "rule %q uses an undeclared severity", rule.ID)
		if rule.GraceSeverity != "" {
			require.Contains(t, attentionSeverityDefinitions, rule.GraceSeverity, "rule %q uses an undeclared grace severity", rule.ID)
		}
	}
	for signal, policy := range attentionSignalPolicies {
		require.NotEmpty(t, policy.Label)
		require.False(t, ruleIDs[string(signal)], "duplicate Attention finding type %q", signal)
		ruleIDs[string(signal)] = true
		require.Contains(t, attentionSeverityDefinitions, policy.Severity, "signal %q uses an undeclared severity", signal)
		if policy.GraceSeverity != "" {
			require.Contains(t, attentionSeverityDefinitions, policy.GraceSeverity, "signal %q uses an undeclared grace severity", signal)
		}
	}
	require.Len(t, AttentionFindingTypes(), len(ruleIDs))
}

func TestEvaluateAttentionSourceClassifiesIntentionalInactiveWorkloadsAsInfo(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		record attentionSourceRecord
	}{
		{
			name: "deployment scaled to zero",
			record: attentionSourceRecord{
				Ref: attentionTestRef("Deployment", "payments", "api"), Source: attentionSourceWorkload,
				Status: "Scaled to 0", StatusPresentation: "inactive", StatusReason: "ScaledToZero", Ready: "0/0",
				AgeTimestamp: now.Add(-time.Minute).UnixMilli(),
			},
		},
		{
			name: "statefulset scaled to zero",
			record: attentionSourceRecord{
				Ref: attentionTestRef("StatefulSet", "payments", "queue"), Source: attentionSourceWorkload,
				Status: "Scaled to 0", StatusPresentation: "inactive", StatusReason: "ScaledToZero", Ready: "0/0",
				AgeTimestamp: now.Add(-time.Minute).UnixMilli(),
			},
		},
		{
			name: "cronjob idle",
			record: attentionSourceRecord{
				Ref: attentionTestRef("CronJob", "payments", "backup"), Source: attentionSourceWorkload,
				Status: "Idle", StatusPresentation: "inactive", Ready: "0",
				AgeTimestamp: now.Add(-time.Minute).UnixMilli(),
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			evaluation := evaluateAttentionSource(test.record, now)
			require.NotNil(t, evaluation.Finding)
			require.Equal(t, AttentionSeverityInfo, evaluation.Finding.Severity)
			require.True(t, evaluation.NextEvaluation.IsZero())
		})
	}
}

func TestEvaluateAttentionSourceUsesFriendlyDaemonSetNoEligibleNodesFinding(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	record := attentionSourceRecord{
		Ref: attentionTestRef("DaemonSet", "monitoring", "node-agent"), Source: attentionSourceWorkload,
		Status: "No eligible nodes", StatusPresentation: "warning", StatusReason: "NoEligibleNodes", Ready: "0/0",
		AgeTimestamp: now.Add(-10 * time.Minute).UnixMilli(),
	}

	evaluation := evaluateAttentionSource(record, now)
	require.NotNil(t, evaluation.Finding)
	require.Equal(t, AttentionSeverityInfo, evaluation.Finding.Severity)
	require.Equal(t, []string{"No eligible nodes"}, attentionCauseMessages(evaluation.Finding.Causes))
	require.True(t, evaluation.NextEvaluation.IsZero())
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
	require.Equal(t, AttentionSeverityError, evaluation.Finding.Severity)
	require.Equal(t, "CrashLoopBackOff", evaluation.Finding.Status)
	require.Equal(t, []string{"CrashLoopBackOff", "4 restarts"}, attentionCauseMessages(evaluation.Finding.Causes))
	require.True(t, evaluation.NextEvaluation.IsZero())
}

func TestEvaluateAttentionSourceProjectsStableCauseTypes(t *testing.T) {
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
	require.Equal(t, []AttentionCause{
		{Type: "error-presentation", Label: "Error status", Message: "CrashLoopBackOff", Severity: AttentionSeverityError},
		{Type: "restarts", Label: "Restarts", Message: "4 restarts", Severity: AttentionSeverityWarning},
	}, evaluation.Finding.Causes)
}

func TestEvaluateYoungErroredWorkloadDoesNotHideBehindReplicaGrace(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	createdAt := now.Add(-time.Minute)
	record := attentionSourceRecord{
		Ref:                attentionTestRef("Deployment", "payments", "checkout"),
		Source:             attentionSourceWorkload,
		Status:             "Failed",
		StatusPresentation: "error",
		StatusReason:       "ProgressDeadlineExceeded",
		Ready:              "0/3",
		AgeTimestamp:       createdAt.UnixMilli(),
	}

	evaluation := evaluateAttentionSource(record, now)
	require.NotNil(t, evaluation.Finding)
	require.Equal(t, AttentionSeverityError, evaluation.Finding.Severity)
	require.Equal(t, []AttentionCause{{
		Type: "error-presentation", Label: "Error status", Message: "ProgressDeadlineExceeded", Severity: AttentionSeverityError,
	}}, evaluation.Finding.Causes)
	require.Equal(t, createdAt.Add(attentionWarningGrace), evaluation.NextEvaluation)
}

func TestEvaluateAttentionSourcePublishesTransientPodWarningsAsInfoUntilGracePeriod(t *testing.T) {
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
	require.NotNil(t, beforeGrace.Finding)
	require.Equal(t, AttentionSeverityInfo, beforeGrace.Finding.Severity)
	require.Equal(t, []AttentionCause{{
		Type: "pod-unhealthy", Label: "Unhealthy pods", Message: "ContainerCreating", Severity: AttentionSeverityInfo,
	}}, beforeGrace.Finding.Causes)
	require.Equal(t, createdAt.Add(attentionWarningGrace), beforeGrace.NextEvaluation)

	afterGrace := evaluateAttentionSource(record, createdAt.Add(attentionWarningGrace))
	require.NotNil(t, afterGrace.Finding)
	require.Equal(t, AttentionSeverityWarning, afterGrace.Finding.Severity)
	require.Equal(t, []AttentionCause{{
		Type: "pod-unhealthy", Label: "Unhealthy pods", Message: "ContainerCreating", Severity: AttentionSeverityWarning,
	}}, afterGrace.Finding.Causes)
	require.True(t, afterGrace.NextEvaluation.IsZero())
}

func TestEvaluateAttentionSourceTracksContainerReadinessIndependentlyOfPresentation(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	createdAt := now.Add(-2 * time.Minute)
	record := attentionSourceRecord{
		Ref:                attentionTestRef("Pod", "payments", "checkout-1"),
		Source:             attentionSourcePod,
		Status:             "Running",
		StatusState:        "Running",
		StatusPresentation: "ready",
		Ready:              "0/1",
		AgeTimestamp:       createdAt.UnixMilli(),
	}

	beforeGrace := evaluateAttentionSource(record, now)
	require.NotNil(t, beforeGrace.Finding)
	require.Equal(t, AttentionSeverityInfo, beforeGrace.Finding.Severity)
	require.Equal(t, []AttentionCause{{
		Type: "pod-not-ready", Label: "Pods not ready", Message: "0/1 ready", Severity: AttentionSeverityInfo,
	}}, beforeGrace.Finding.Causes)
	require.Equal(t, createdAt.Add(attentionWarningGrace), beforeGrace.NextEvaluation)

	afterGrace := evaluateAttentionSource(record, createdAt.Add(attentionWarningGrace))
	require.NotNil(t, afterGrace.Finding)
	require.Equal(t, AttentionSeverityWarning, afterGrace.Finding.Severity)
	require.Equal(t, []AttentionCause{{
		Type: "pod-not-ready", Label: "Pods not ready", Message: "0/1 ready", Severity: AttentionSeverityWarning,
	}}, afterGrace.Finding.Causes)

	record.Status = "Succeeded"
	record.StatusState = "Succeeded"
	require.Nil(t, evaluateAttentionSource(record, now).Finding)
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
	require.Equal(t, AttentionSeverityWarning, evaluation.Finding.Severity)
	require.Equal(t, []string{"Updating", "2/3 ready"}, attentionCauseMessages(evaluation.Finding.Causes))
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
	require.Equal(t, []string{"Ready (Cordoned)"}, attentionCauseMessages(evaluation.Finding.Causes))
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
	require.Equal(t, []string{"BackOff · Back-off restarting failed container"}, attentionCauseMessages(evaluation.Finding.Causes))
	require.Equal(t, observedAt.Add(attentionEventLookback), evaluation.NextEvaluation)

	expired := evaluateAttentionSource(record, observedAt.Add(attentionEventLookback))
	require.Nil(t, expired.Finding)
	require.True(t, expired.NextEvaluation.IsZero())
}
