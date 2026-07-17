package snapshot

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/stretchr/testify/require"
)

func TestAttentionQueryAdapterUsesFindingLabelsForSearchAndSort(t *testing.T) {
	row := AttentionFinding{
		Kind: "Pod", Name: "checkout-0", Namespace: "payments", Status: "CrashLoopBackOff",
		Causes: []AttentionCause{
			{Type: "error-presentation", Label: "Error status", Message: "CrashLoopBackOff"},
			{Type: "restarts", Label: "Restarts", Message: "4 restarts"},
		},
	}
	adapter := attentionTableQueryAdapter()

	searchText := strings.Join(adapter.SearchText(row), " ")
	require.Contains(t, searchText, "Error status")
	require.Contains(t, searchText, "Restarts")
	require.Contains(t, searchText, "CrashLoopBackOff")
	require.Contains(t, searchText, "4 restarts")
	require.Equal(t, "Error status, Restarts", adapter.SortValue(row, "reason"))
}

func TestClusterAttentionBuilderServesQueryBackedPages(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	index := newClusterAttentionIndex(meta, func() time.Time { return now })
	t.Cleanup(index.Stop)
	for _, name := range []string{"zeta", "alpha"} {
		index.UpsertSource("pods", attentionSourceRecord{
			Ref: attentionTestRef("Pod", "payments", name), Source: attentionSourcePod,
			Status: "Running", StatusPresentation: "ready", Restarts: 1,
			AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
		})
	}
	builder := &ClusterAttentionBuilder{index: index}
	ctx := WithClusterMeta(context.Background(), meta)

	snapshot, err := builder.Build(ctx, refresh.JoinClusterScope(meta.ClusterID, "?limit=1&sortField=name&sortDirection=asc"))
	require.NoError(t, err)
	payload := snapshot.Payload.(ClusterAttentionSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "alpha", payload.Rows[0].Name)
	require.Equal(t, 2, payload.Total)
	require.NotEmpty(t, payload.Continue)
	require.Equal(t, meta.ClusterID, payload.Rows[0].Ref.ClusterID)
}

func TestClusterAttentionBuilderFiltersRowsByAnyFindingCause(t *testing.T) {
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	index := newClusterAttentionIndex(meta, time.Now)
	t.Cleanup(index.Stop)
	for _, row := range []AttentionFinding{
		{
			Ref: attentionTestRef("Pod", "payments", "crash"), Kind: "Pod", Name: "crash", Namespace: "payments",
			Severity: AttentionSeverityError, Status: "CrashLoopBackOff",
			Causes: []AttentionCause{
				{Type: "error-presentation", Label: "Error status", Message: "CrashLoopBackOff", Severity: AttentionSeverityError},
				{Type: "restarts", Label: "Restarts", Message: "4 restarts", Severity: AttentionSeverityWarning},
			},
		},
		{
			Ref: attentionTestRef("Pod", "payments", "failed"), Kind: "Pod", Name: "failed", Namespace: "payments",
			Severity: AttentionSeverityError, Status: "Failed",
			Causes: []AttentionCause{{Type: "error-presentation", Label: "Error status", Message: "Failed", Severity: AttentionSeverityError}},
		},
	} {
		row.ClusterMeta = meta
		index.maintained.store.Upsert(row)
	}

	result, err := (&ClusterAttentionBuilder{index: index}).Build(
		WithClusterMeta(context.Background(), meta),
		refresh.JoinClusterScope(meta.ClusterID, "?limit=10&facet.findings=restarts"),
	)
	require.NoError(t, err)
	payload := result.Payload.(ClusterAttentionSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "crash", payload.Rows[0].Name)
	require.Equal(t, []ResourceQueryFacetOption{
		{Value: "error-presentation", Label: "Error status"},
		{Value: "restarts", Label: "Restarts"},
	}, testFacetOptions(payload.FacetValues, "findings"))
}

func TestClusterAttentionBuilderReturnsTransientNotReadyPodForOverviewFilters(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	index := newClusterAttentionIndex(meta, func() time.Time { return now })
	t.Cleanup(index.Stop)
	index.UpsertSource("pods", attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusState: "Running", StatusPresentation: "ready", Ready: "0/1",
		AgeTimestamp: now.Add(-2 * time.Minute).UnixMilli(),
	})

	result, err := (&ClusterAttentionBuilder{index: index}).Build(
		WithClusterMeta(context.Background(), meta),
		refresh.JoinClusterScope(meta.ClusterID, "?limit=10&kinds=Pod&facet.findings=pod-not-ready"),
	)
	require.NoError(t, err)
	payload := result.Payload.(ClusterAttentionSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "checkout-0", payload.Rows[0].Name)
	require.Equal(t, AttentionSeverityInfo, payload.Rows[0].Severity)
	require.Equal(t, AttentionSeverityCounts{Info: 1}, payload.SeverityCounts)
}

func TestClusterAttentionBuilderSortsSeverityByOperationalPriority(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	index := newClusterAttentionIndex(meta, func() time.Time { return now })
	t.Cleanup(index.Stop)
	for _, test := range []struct {
		name     string
		severity AttentionSeverity
	}{
		{name: "informational", severity: AttentionSeverityInfo},
		{name: "warning", severity: AttentionSeverityWarning},
		{name: "error", severity: AttentionSeverityError},
	} {
		ref := attentionTestRef("Deployment", "payments", test.name)
		index.maintained.store.Upsert(AttentionFinding{
			ClusterMeta: meta,
			Ref:         ref,
			Kind:        ref.Kind,
			Name:        ref.Name,
			Namespace:   ref.Namespace,
			Severity:    test.severity,
			Status:      test.name,
			Causes: []AttentionCause{{
				Type: test.name, Label: test.name, Message: test.name, Severity: test.severity,
			}},
		})
	}
	builder := &ClusterAttentionBuilder{index: index}
	ctx := WithClusterMeta(context.Background(), meta)

	result, err := builder.Build(ctx, refresh.JoinClusterScope(meta.ClusterID, "?limit=10&sort=severity&sortDirection=asc"))
	require.NoError(t, err)
	rows := result.Payload.(ClusterAttentionSnapshot).Rows
	require.Equal(t, []AttentionSeverity{AttentionSeverityError, AttentionSeverityWarning, AttentionSeverityInfo}, []AttentionSeverity{
		rows[0].Severity, rows[1].Severity, rows[2].Severity,
	})
}

func TestClusterAttentionBuilderPublishesFullSeverityCounts(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	index := newClusterAttentionIndex(meta, func() time.Time { return now })
	t.Cleanup(index.Stop)
	for _, test := range []struct {
		name     string
		severity AttentionSeverity
	}{
		{name: "informational", severity: AttentionSeverityInfo},
		{name: "warning", severity: AttentionSeverityWarning},
		{name: "error", severity: AttentionSeverityError},
	} {
		ref := attentionTestRef("Deployment", "payments", test.name)
		index.maintained.store.Upsert(AttentionFinding{
			ClusterMeta: meta,
			Ref:         ref,
			Kind:        ref.Kind,
			Name:        ref.Name,
			Namespace:   ref.Namespace,
			Severity:    test.severity,
			Status:      test.name,
			Causes: []AttentionCause{{
				Type: test.name, Label: test.name, Message: test.name, Severity: test.severity,
			}},
		})
	}
	builder := &ClusterAttentionBuilder{index: index}
	ctx := WithClusterMeta(context.Background(), meta)

	result, err := builder.Build(ctx, refresh.JoinClusterScope(
		meta.ClusterID,
		"?limit=1&facet.severities=warning",
	))
	require.NoError(t, err)
	require.Len(t, result.Payload.(ClusterAttentionSnapshot).Rows, 1)

	wire, err := json.Marshal(result.Payload)
	require.NoError(t, err)
	var payload struct {
		SeverityCounts struct {
			Info    int `json:"info"`
			Warning int `json:"warning"`
			Error   int `json:"error"`
		} `json:"severityCounts"`
	}
	require.NoError(t, json.Unmarshal(wire, &payload))
	require.Equal(t, 1, payload.SeverityCounts.Info)
	require.Equal(t, 1, payload.SeverityCounts.Warning)
	require.Equal(t, 1, payload.SeverityCounts.Error)
}

func TestClusterAttentionBuilderPublishesIgnoreRulesAndFindingTypeCatalog(t *testing.T) {
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	index := newClusterAttentionIndex(meta, time.Now)
	t.Cleanup(index.Stop)
	ignored := attentionTestRef("Deployment", "payments", "checkout")
	index.SetIgnoreRules(AttentionIgnoreRules{
		ObjectFindings:      []AttentionObjectFindingIgnore{{Ref: ignored, FindingType: "replica-mismatch"}},
		ClusterFindingTypes: []string{"restarts"},
		GlobalFindingTypes:  []string{"warning-event"},
	})

	result, err := (&ClusterAttentionBuilder{index: index}).Build(
		WithClusterMeta(context.Background(), meta),
		refresh.JoinClusterScope(meta.ClusterID, ""),
	)
	require.NoError(t, err)
	payload := result.Payload.(ClusterAttentionSnapshot)
	require.Equal(t, []AttentionObjectFindingIgnore{{Ref: ignored, FindingType: "replica-mismatch"}}, payload.IgnoreRules.ObjectFindings)
	require.Equal(t, []string{"restarts"}, payload.IgnoreRules.ClusterFindingTypes)
	require.Equal(t, []string{"warning-event"}, payload.IgnoreRules.GlobalFindingTypes)
	require.Contains(t, payload.FindingTypes, AttentionFindingTypeDefinition{ID: "restarts", Label: "Restarts"})
}
