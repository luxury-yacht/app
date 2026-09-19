package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/stretchr/testify/require"
)

func TestClusterAttentionRuntimeRevocationFiltersRetainedRowsAndCounts(t *testing.T) {
	for _, query := range []string{"", "?limit=10", "?limit=10&search=allowed"} {
		t.Run(query, func(t *testing.T) {
			meta := ClusterMeta{ClusterID: "cluster-a"}
			index := newClusterAttentionIndex(meta, time.Now)
			t.Cleanup(index.Stop)
			pod := attentionTestRef("Pod", "denied-namespace", "denied-pod")
			node := attentionTestRef("Node", "", "allowed-node")
			custom := attentionTestRef("Pod", "allowed-namespace", "allowed-custom")
			custom.Group = "example.com"
			for _, row := range []AttentionFinding{
				{Ref: pod, Namespace: pod.Namespace, Severity: AttentionSeverityError},
				{Ref: node, Severity: AttentionSeverityInfo},
				{Ref: custom, Namespace: custom.Namespace, Severity: AttentionSeverityWarning},
			} {
				row.Causes = []AttentionCause{{Type: "test-health", Severity: row.Severity}}
				index.maintained.store.Upsert(row)
			}

			// Cold restoration must rebuild the authorization facet too.
			path := t.TempDir() + "/attention.spill"
			require.NoError(t, index.SpillTo(path))
			restored := newClusterAttentionIndex(meta, time.Now)
			t.Cleanup(restored.Stop)
			require.NoError(t, restored.RestoreFrom(path))
			index = restored
			builder := &ClusterAttentionBuilder{index: index, sources: []typedTableResourceSource{
				{Kind: "Pod", Resource: "pods"}, {Kind: "Node", Resource: "nodes"},
			}}
			base := WithClusterMeta(context.Background(), meta)
			denied := domainpermissions.WithAllowedResources(base, clusterAttentionDomainName,
				domainpermissions.AllowedResources{"core/pods": false, "core/nodes": true})
			result, err := builder.Build(denied, refresh.JoinClusterScope(meta.ClusterID, query))
			require.NoError(t, err)
			payload := result.Payload.(ClusterAttentionSnapshot)
			require.Len(t, payload.Rows, 2)
			for _, row := range payload.Rows {
				require.NotEqual(t, pod, row.Ref)
			}
			require.Equal(t, 2, payload.Total)
			require.Equal(t, 2, payload.UnfilteredTotal)
			require.Equal(t, AttentionSeverityCounts{Info: 1, Warning: 1}, payload.SeverityCounts)
			require.NotContains(t, payload.Namespaces, pod.Namespace)
			require.Contains(t, payload.Kinds, "Pod", "catalog-owned Pod kind remains visible")
			require.Contains(t, payload.Capabilities.KindVocabulary, "Pod")
			require.NotEmpty(t, payload.Issues)

			// Filtering a request must not erase retained state needed after recovery.
			recovered := domainpermissions.WithAllowedResources(base, clusterAttentionDomainName,
				domainpermissions.AllowedResources{"core/pods": true, "core/nodes": true})
			result, err = builder.Build(recovered, refresh.JoinClusterScope(meta.ClusterID, "?limit=10"))
			require.NoError(t, err)
			require.Len(t, result.Payload.(ClusterAttentionSnapshot).Rows, 3)
		})
	}
}

func TestClusterAttentionReadinessFiltersUnavailableSourcesAndRecovers(t *testing.T) {
	for _, query := range []string{"", "?limit=10"} {
		t.Run(query, func(t *testing.T) {
			meta := ClusterMeta{ClusterID: "cluster-a"}
			index := newClusterAttentionIndex(meta, time.Now)
			t.Cleanup(index.Stop)
			pod := attentionTestRef("Pod", "denied-namespace", "denied-pod")
			index.maintained.store.Upsert(AttentionFinding{Ref: pod, Namespace: pod.Namespace, Severity: AttentionSeverityError})
			builder := &ClusterAttentionBuilder{index: index, sources: []typedTableResourceSource{{Kind: "Pod", Resource: "pods"}}}
			base := WithClusterMeta(context.Background(), meta)
			for _, state := range []refresh.ResourceReadiness{refresh.ResourceReadinessUnavailable, refresh.ResourceReadinessPending, refresh.ResourceReadinessDegraded, refresh.ResourceReadinessReady} {
				ctx := withResourceReadiness(base, map[string]refresh.ResourceReadiness{"core/pods": state})
				result, err := builder.Build(ctx, refresh.JoinClusterScope(meta.ClusterID, query))
				require.NoError(t, err)
				payload := result.Payload.(ClusterAttentionSnapshot)
				if state == refresh.ResourceReadinessUnavailable {
					require.Empty(t, payload.Rows)
					require.Zero(t, payload.Total)
					require.Zero(t, payload.UnfilteredTotal)
					require.Empty(t, payload.Kinds)
					require.Empty(t, payload.Capabilities.KindVocabulary)
					require.Equal(t, AttentionSeverityCounts{}, payload.SeverityCounts)
				} else {
					require.Len(t, payload.Rows, 1, "retained rows remain usable while an allowed source syncs")
				}
			}
			denied := domainpermissions.WithAllowedResources(base, clusterAttentionDomainName, domainpermissions.AllowedResources{"core/pods": false})
			result, err := builder.Build(denied, refresh.JoinClusterScope(meta.ClusterID, query))
			require.NoError(t, err)
			require.Empty(t, result.Payload.(ClusterAttentionSnapshot).Rows)
		})
	}
}
