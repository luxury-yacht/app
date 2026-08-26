package endpointslice

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/stretchr/testify/require"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildStreamSummaryCarriesExactMetadata(t *testing.T) {
	slice := &discoveryv1.EndpointSlice{ObjectMeta: metav1.ObjectMeta{
		Name:        "api",
		Namespace:   "default",
		Labels:      map[string]string{"example.com/owner": "platform"},
		Annotations: map[string]string{"example.com/note": "visible"},
	}}

	row := BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, slice)

	require.Equal(t, slice.Labels, row.Metadata.Labels)
	require.Equal(t, slice.Annotations, row.Metadata.Annotations)
}
