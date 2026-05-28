/*
 * backend/resources/config/secrets_test.go
 *
 * Tests for Secret resource handlers.
 * - Covers Secret resource handlers behavior and edge cases.
 */

package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestServiceSecretDetailsIncludesUsage(t *testing.T) {
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "app-secret",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-1 * time.Hour)),
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{"username": []byte("admin")},
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"},
		Spec: corev1.PodSpec{
			Volumes: []corev1.Volume{{
				Name:         "secret-vol",
				VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "app-secret"}},
			}},
			ImagePullSecrets: []corev1.LocalObjectReference{{Name: "app-secret"}},
			Containers: []corev1.Container{{
				Name: "api",
				Env: []corev1.EnvVar{{
					Name: "PASSWORD",
					ValueFrom: &corev1.EnvVarSource{
						SecretKeyRef: &corev1.SecretKeySelector{
							LocalObjectReference: corev1.LocalObjectReference{Name: "app-secret"},
							Key:                  "username",
						},
					},
				}},
			}},
		},
	}

	client := fake.NewClientset(secret.DeepCopy(), pod.DeepCopy())
	service := newConfigService(t, client)

	detail, err := service.Secret("default", "app-secret")
	require.NoError(t, err)
	require.Equal(t, "Secret", detail.Kind)
	require.Equal(t, 1, detail.DataCount)
	require.Len(t, detail.UsedBy, 1)
	require.Equal(t, "cluster-a", detail.UsedBy[0].ClusterID)
	require.Equal(t, "", detail.UsedBy[0].Group)
	require.Equal(t, "v1", detail.UsedBy[0].Version)
	require.Equal(t, "Pod", detail.UsedBy[0].Kind)
	require.Equal(t, "pods", detail.UsedBy[0].Resource)
	require.Equal(t, "default", detail.UsedBy[0].Namespace)
	require.Equal(t, "api-0", detail.UsedBy[0].Name)
	require.Contains(t, detail.Details, "Opaque")
}

func TestServiceSecretsListsAll(t *testing.T) {
	secA := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "a", Namespace: "default"}}
	secB := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "b", Namespace: "default"}}
	client := fake.NewClientset(secA, secB)
	service := newConfigService(t, client)

	secrets, err := service.Secrets("default")
	require.NoError(t, err)
	require.Len(t, secrets, 2)
}
