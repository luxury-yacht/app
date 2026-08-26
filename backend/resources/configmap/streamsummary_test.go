package configmap

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildStreamSummaryProjectsObjectMetadata(t *testing.T) {
	row := BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "settings",
			Namespace:   "payments",
			Labels:      map[string]string{"example.com/owner": "platform"},
			Annotations: map[string]string{"example.com/note": "managed"},
		},
	})

	require.NotNil(t, row.Metadata)
	require.Equal(t, "platform", row.Metadata.Labels["example.com/owner"])
	require.Equal(t, "managed", row.Metadata.Annotations["example.com/note"])
}
