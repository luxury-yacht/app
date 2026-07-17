package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/stretchr/testify/require"
)

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
