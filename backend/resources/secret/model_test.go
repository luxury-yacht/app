package secret_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/secret"
)

// TestBuildResourceModelFactsAndStatus covers the Secret status presentation +
// facts (incl. reverse links) that moved here with the model.
func TestBuildResourceModelFactsAndStatus(t *testing.T) {
	immutable := true
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "app-secret", Namespace: "default", UID: types.UID("secret-uid")},
		Type:       corev1.SecretTypeTLS,
		Immutable:  &immutable,
		Data:       map[string][]byte{"tls.key": []byte("key"), "tls.crt": []byte("cert")},
	}
	pods := &corev1.PodList{Items: []corev1.Pod{{
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default", UID: types.UID("pod-uid")},
		Spec: corev1.PodSpec{
			ImagePullSecrets: []corev1.LocalObjectReference{{Name: "app-secret"}},
		},
	}}}

	model := secret.BuildResourceModel("cluster-a", sec)
	require.Equal(t, "Secret", model.Ref.Kind)
	require.Equal(t, "secrets", model.Ref.Resource)
	require.Equal(t, "kubernetes.io/tls", model.Status.State)
	require.Equal(t, "kubernetes.io/tls, 2 keys", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)

	relationships := resourcemodel.NewResourceRelationshipIndex("cluster-a", resourcemodel.ResourceRelationshipIndexOptions{Pods: pods})
	facts := secret.BuildFacts(sec, relationships, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks})
	require.Equal(t, "kubernetes.io/tls", facts.Type)
	require.Equal(t, []string{"tls.crt", "tls.key"}, facts.DataKeys)
	require.Equal(t, 2, facts.DataCount)
	require.Equal(t, int64(7), facts.DataSizeBytes)
	require.NotNil(t, facts.Immutable)
	require.True(t, *facts.Immutable)
	require.Len(t, facts.UsedBy, 1)
	require.Equal(t, "api-0", facts.UsedBy[0].Ref.Name)
}

func TestBuildResourceModelTerminatingStatus(t *testing.T) {
	now := metav1.Now()
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "app-secret",
			Namespace:         "default",
			DeletionTimestamp: &now,
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{"password": []byte("secret")},
	}
	model := secret.BuildResourceModel("cluster-a", sec)
	require.Equal(t, "Terminating", model.Status.Label)
	require.Equal(t, "Opaque", model.Status.State)
	require.Equal(t, "terminating", model.Status.Presentation)
}
