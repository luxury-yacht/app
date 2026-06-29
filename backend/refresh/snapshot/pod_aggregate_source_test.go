package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type trackingOwnerIndexedPodSource struct {
	indexName  string
	indexKeys  []string
	indexRows  []interface{}
	rowsCalled bool
}

func (s *trackingOwnerIndexedPodSource) Rows(gvr schema.GroupVersionResource) []interface{} {
	if gvr == PodGVR {
		s.rowsCalled = true
	}
	return nil
}

func (s *trackingOwnerIndexedPodSource) RowsByIndex(gvr schema.GroupVersionResource, indexName string, values []string) []interface{} {
	if gvr != PodGVR {
		return nil
	}
	s.indexName = indexName
	s.indexKeys = append([]string(nil), values...)
	return append([]interface{}(nil), s.indexRows...)
}

func (s *trackingOwnerIndexedPodSource) StoreResourceVersion(schema.GroupVersionResource) string {
	return ""
}

func TestWorkloadOwnerPodRowsFromIngestUsesOwnerIndex(t *testing.T) {
	webKey := workloadOwnerKey("Deployment", "team-a", "web")
	apiKey := workloadOwnerKey("Deployment", "team-b", "api")
	source := &trackingOwnerIndexedPodSource{
		indexRows: []interface{}{
			ingest.Bundle{
				Table:     streamrows.PodSummary{Namespace: "team-b", Name: "api-1"},
				Aggregate: streamrows.PodAggregate{Namespace: "team-b", Name: "api-1", OwnerKey: apiKey},
			},
			ingest.Bundle{
				Table:     streamrows.PodSummary{Namespace: "team-a", Name: "web-1"},
				Aggregate: streamrows.PodAggregate{Namespace: "team-a", Name: "web-1", OwnerKey: webKey},
			},
		},
	}

	aggregates, summaries := workloadOwnerPodRowsFromIngest(source, []WorkloadSummary{
		{Kind: "Deployment", Namespace: "team-b", Name: "api"},
		{Kind: "Deployment", Namespace: "team-a", Name: "web"},
	})

	require.False(t, source.rowsCalled, "all-namespaces owner pod reads should use the ingest owner-key index")
	require.Equal(t, podOwnerKeyIndexName, source.indexName)
	require.Equal(t, []string{webKey, apiKey}, source.indexKeys)
	require.ElementsMatch(t, []streamrows.PodAggregate{
		{Namespace: "team-b", Name: "api-1", OwnerKey: apiKey},
		{Namespace: "team-a", Name: "web-1", OwnerKey: webKey},
	}, aggregates)
	require.Equal(t, streamrows.PodSummary{Namespace: "team-a", Name: "web-1"}, summaries["team-a/web-1"])
	require.Equal(t, streamrows.PodSummary{Namespace: "team-b", Name: "api-1"}, summaries["team-b/api-1"])
}
