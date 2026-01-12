/*
 * backend/resources/config/configmaps_test.go
 *
 * Tests for ConfigMap resource handlers.
 * - Covers ConfigMap resource handlers behavior and edge cases.
 */

package config

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	clientgofake "k8s.io/client-go/kubernetes/fake"
)

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

	client := clientgofake.NewClientset(cm.DeepCopy(), pod.DeepCopy())
	service := newConfigService(t, client)

	detail, err := service.ConfigMap("default", "app-config")
	require.NoError(t, err)
	require.Equal(t, "ConfigMap", detail.Kind)
	require.Equal(t, 2, detail.DataCount)
	require.Equal(t, []string{"web-0"}, detail.UsedBy)
	require.Contains(t, detail.BinaryData, "secret")
}

func TestServiceConfigMapsListsAll(t *testing.T) {
	cmA := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "a", Namespace: "default"}}
	cmB := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "b", Namespace: "default"}}
	client := clientgofake.NewClientset(cmA, cmB)
	service := newConfigService(t, client)

	configMaps, err := service.ConfigMaps("default")
	require.NoError(t, err)
	require.Len(t, configMaps, 2)
}

func newConfigService(t testing.TB, client *clientgofake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
	)
	return NewService(deps)
}
