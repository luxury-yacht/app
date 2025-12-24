package config_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kubefake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/resources/config"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type stubLogger struct{}

func (stubLogger) Debug(string, ...string) {}
func (stubLogger) Info(string, ...string)  {}
func (stubLogger) Warn(string, ...string)  {}
func (stubLogger) Error(string, ...string) {}

func TestServiceConfigMapDetailsIncludesUsage(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "app-config",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-15 * time.Minute)),
			Labels:            map[string]string{"app": "web"},
		},
		Data:       map[string]string{"CONFIG": "value"},
		BinaryData: map[string][]byte{"secret": []byte("top-secret")},
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-0", Namespace: "default"},
		Spec: corev1.PodSpec{
			Volumes: []corev1.Volume{{
				Name: "config",
				VolumeSource: corev1.VolumeSource{
					ConfigMap: &corev1.ConfigMapVolumeSource{
						LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"},
					},
				},
			}},
			Containers: []corev1.Container{{
				Name: "web",
				Env: []corev1.EnvVar{{
					Name: "CONFIG_VALUE",
					ValueFrom: &corev1.EnvVarSource{
						ConfigMapKeyRef: &corev1.ConfigMapKeySelector{
							LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"},
							Key:                  "CONFIG",
						},
					},
				}},
			}},
		},
	}

	client := kubefake.NewClientset(cm.DeepCopy(), pod.DeepCopy())
	service := newConfigService(t, client)

	detail, err := service.ConfigMap("default", "app-config")
	require.NoError(t, err)
	require.Equal(t, "ConfigMap", detail.Kind)
	require.Equal(t, 2, detail.DataCount)
	require.Equal(t, []string{"web-0"}, detail.UsedBy)
	require.Contains(t, detail.BinaryData, "secret")
}

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

	client := kubefake.NewClientset(secret.DeepCopy(), pod.DeepCopy())
	service := newConfigService(t, client)

	detail, err := service.Secret("default", "app-secret")
	require.NoError(t, err)
	require.Equal(t, "Secret", detail.Kind)
	require.Equal(t, 1, detail.DataCount)
	require.Equal(t, []string{"api-0"}, detail.UsedBy)
	require.Contains(t, detail.Details, "Opaque")
}

func TestServiceConfigMapsListsAll(t *testing.T) {
	cmA := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "a", Namespace: "default"}}
	cmB := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "b", Namespace: "default"}}
	client := kubefake.NewClientset(cmA, cmB)
	service := newConfigService(t, client)

	configMaps, err := service.ConfigMaps("default")
	require.NoError(t, err)
	require.Len(t, configMaps, 2)
}

func TestServiceSecretsListsAll(t *testing.T) {
	secA := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "a", Namespace: "default"}}
	secB := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "b", Namespace: "default"}}
	client := kubefake.NewClientset(secA, secB)
	service := newConfigService(t, client)

	secrets, err := service.Secrets("default")
	require.NoError(t, err)
	require.Len(t, secrets, 2)
}

func newConfigService(t testing.TB, client *kubefake.Clientset) *config.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(stubLogger{}),
	)
	return config.NewService(config.Dependencies{Common: deps})
}
