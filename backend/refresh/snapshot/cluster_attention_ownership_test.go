package snapshot

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestClusterAttentionRejectsForeignClusterHealthRows(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	local := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout"), Source: attentionSourcePod,
		Status: "Running", StatusState: "Running", StatusPresentation: "ready", Restarts: 2,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}
	foreign := local
	foreign.Ref.ClusterID = "cluster-b"
	for _, mode := range []string{"upsert", "replace", "restore"} {
		t.Run(mode, func(t *testing.T) {
			index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a"}, func() time.Time { return now })
			t.Cleanup(index.Stop)
			switch mode {
			case "upsert":
				index.UpsertSource("pods", foreign)
				index.UpsertSource("pods", local)
			case "replace":
				index.ReplaceSource("pods", []attentionSourceRecord{foreign, local})
			case "restore":
				other := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-b"}, func() time.Time { return now })
				t.Cleanup(other.Stop)
				other.UpsertSource("pods", foreign)
				path := t.TempDir() + "/foreign.spill"
				require.NoError(t, other.SpillTo(path))
				require.NoError(t, index.RestoreFrom(path))
				index.UpsertSource("pods", local)
			}
			rows := index.Snapshot()
			require.Len(t, rows, 1, "a cluster's Attention table must contain only that cluster's findings")
			require.Equal(t, local.Ref, rows[0].Ref)
		})
	}
}

func TestAttentionReadinessGraceKeepsPodAndWorkloadRestartPolicies(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	created := now.Add(-time.Minute)
	for _, tc := range []struct {
		kind        string
		source      attentionSource
		findingType string
		severity    AttentionSeverity
		deadline    time.Time
	}{
		{"Pod", attentionSourcePod, "pod-not-ready", AttentionSeverityInfo, created.Add(attentionWarningGrace)},
		{"Deployment", attentionSourceWorkload, "replica-mismatch", AttentionSeverityWarning, time.Time{}},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			record := attentionSourceRecord{
				Ref: attentionTestRef(tc.kind, "payments", "checkout"), Source: tc.source,
				Status: "Running", StatusState: "Running", StatusPresentation: "ready",
				Ready: "0/1", Restarts: 2, AgeTimestamp: created.UnixMilli(),
			}
			evaluation := evaluateAttentionSource(record, now)
			require.NotNil(t, evaluation.Finding)
			require.Equal(t, []string{tc.findingType, "restarts"}, attentionCauseTypes(evaluation.Finding.Causes))
			require.Equal(t, tc.severity, evaluation.Finding.Causes[0].Severity)
			require.Equal(t, tc.deadline, evaluation.NextEvaluation)
		})
	}
}
