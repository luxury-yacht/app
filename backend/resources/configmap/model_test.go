package configmap_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/configmap"
)

// TestBuildResourceModelFactsAndStatus covers the ConfigMap status presentation +
// facts (incl. reverse links) that moved here with the model.
func TestBuildResourceModelFactsAndStatus(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "app-config", Namespace: "default", UID: types.UID("cm-uid")},
		Data:       map[string]string{"B": "two", "A": "one"},
		BinaryData: map[string][]byte{"cert": []byte("tls")},
	}
	pods := &corev1.PodList{Items: []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "web-0", Namespace: "default", UID: types.UID("pod-uid")},
			Spec: corev1.PodSpec{
				Volumes: []corev1.Volume{{
					Name: "config",
					VolumeSource: corev1.VolumeSource{
						ConfigMap: &corev1.ConfigMapVolumeSource{
							LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"},
						},
					},
				}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "other-ns", Namespace: "other"},
			Spec: corev1.PodSpec{
				Volumes: []corev1.Volume{{
					Name: "config",
					VolumeSource: corev1.VolumeSource{
						ConfigMap: &corev1.ConfigMapVolumeSource{
							LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"},
						},
					},
				}},
			},
		},
	}}

	model := configmap.BuildResourceModel("cluster-a", cm)
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "ConfigMap", model.Ref.Kind)
	require.Equal(t, "configmaps", model.Ref.Resource)
	require.Equal(t, "default", model.Ref.Namespace)
	require.Equal(t, resourcemodel.ResourceScopeNamespaced, model.Scope)
	require.Equal(t, "3", model.Status.State)
	require.Equal(t, "3 items", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)

	relationships := resourcemodel.NewResourceRelationshipIndex("cluster-a", resourcemodel.ResourceRelationshipIndexOptions{Pods: pods})
	facts := configmap.BuildFacts(cm, relationships, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks})
	require.Equal(t, []string{"A", "B"}, facts.DataKeys)
	require.Equal(t, []string{"cert"}, facts.BinaryDataKeys)
	require.Equal(t, 3, facts.DataCount)
	require.Equal(t, int64(9), facts.DataSizeBytes)
	require.Len(t, facts.UsedBy, 1)
	require.Equal(t, "Pod", facts.UsedBy[0].Ref.Kind)
	require.Equal(t, "web-0", facts.UsedBy[0].Ref.Name)
}

func TestBuildResourceModelTerminatingStatus(t *testing.T) {
	now := metav1.Now()
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "app-config",
			Namespace:         "default",
			DeletionTimestamp: &now,
			Finalizers:        []string{"example.com/finalizer"},
		},
		Data: map[string]string{"A": "one"},
	}
	model := configmap.BuildResourceModel("cluster-a", cm)
	require.Equal(t, "Terminating", model.Status.Label)
	require.Equal(t, "1", model.Status.State)
	require.Equal(t, "terminating", model.Status.Presentation)
	require.True(t, model.Status.Lifecycle.FinalizerBlocked)
}
