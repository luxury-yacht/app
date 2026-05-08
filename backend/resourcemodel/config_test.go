package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildConfigMapResourceModelFactsAndStatus(t *testing.T) {
	configMap := &corev1.ConfigMap{
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

	model := BuildConfigMapResourceModel("cluster-a", configMap, pods)
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "ConfigMap", model.Ref.Kind)
	require.Equal(t, "configmaps", model.Ref.Resource)
	require.Equal(t, "default", model.Ref.Namespace)
	require.Equal(t, ResourceScopeNamespaced, model.Scope)
	require.Equal(t, "3", model.Status.State)
	require.Equal(t, "3 items", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, []string{"A", "B"}, model.Facts.ConfigMap.DataKeys)
	require.Equal(t, []string{"cert"}, model.Facts.ConfigMap.BinaryDataKeys)
	require.Equal(t, 3, model.Facts.ConfigMap.DataCount)
	require.Equal(t, int64(9), model.Facts.ConfigMap.DataSizeBytes)
	require.Len(t, model.Facts.ConfigMap.UsedBy, 1)
	require.Equal(t, "Pod", model.Facts.ConfigMap.UsedBy[0].Ref.Kind)
	require.Equal(t, "web-0", model.Facts.ConfigMap.UsedBy[0].Ref.Name)
}

func TestBuildSecretResourceModelFactsAndStatus(t *testing.T) {
	immutable := true
	secret := &corev1.Secret{
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

	model := BuildSecretResourceModel("cluster-a", secret, pods)
	require.Equal(t, "Secret", model.Ref.Kind)
	require.Equal(t, "secrets", model.Ref.Resource)
	require.Equal(t, "kubernetes.io/tls", model.Status.State)
	require.Equal(t, "kubernetes.io/tls, 2 keys", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, "kubernetes.io/tls", model.Facts.Secret.Type)
	require.Equal(t, []string{"tls.crt", "tls.key"}, model.Facts.Secret.DataKeys)
	require.Equal(t, 2, model.Facts.Secret.DataCount)
	require.Equal(t, int64(7), model.Facts.Secret.DataSizeBytes)
	require.NotNil(t, model.Facts.Secret.Immutable)
	require.True(t, *model.Facts.Secret.Immutable)
	require.Len(t, model.Facts.Secret.UsedBy, 1)
	require.Equal(t, "api-0", model.Facts.Secret.UsedBy[0].Ref.Name)
}

func TestBuildConfigResourceModelTerminatingStatusPreservesSourceState(t *testing.T) {
	now := metav1.Now()
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "app-config",
			Namespace:         "default",
			DeletionTimestamp: &now,
			Finalizers:        []string{"example.com/finalizer"},
		},
		Data: map[string]string{"A": "one"},
	}
	configMapModel := BuildConfigMapResourceModel("cluster-a", configMap, nil)
	require.Equal(t, "Terminating", configMapModel.Status.Label)
	require.Equal(t, "1", configMapModel.Status.State)
	require.Equal(t, "terminating", configMapModel.Status.Presentation)
	require.True(t, configMapModel.Status.Lifecycle.FinalizerBlocked)

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "app-secret",
			Namespace:         "default",
			DeletionTimestamp: &now,
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{"password": []byte("secret")},
	}
	secretModel := BuildSecretResourceModel("cluster-a", secret, nil)
	require.Equal(t, "Terminating", secretModel.Status.Label)
	require.Equal(t, "Opaque", secretModel.Status.State)
	require.Equal(t, "terminating", secretModel.Status.Presentation)
}
