package network_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/network"
)

func TestManagerServiceErrors(t *testing.T) {
	client := kubefake.NewSimpleClientset()
	client.PrependReactor("get", "services", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	manager := network.NewService(network.Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			Logger:           stubLogger{},
		},
	})

	_, err := manager.GetService("default", "web")
	require.Error(t, err)
}

func TestManagerServicesListError(t *testing.T) {
	client := kubefake.NewSimpleClientset()
	client.PrependReactor("list", "services", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("list failed")
	})

	manager := network.NewService(network.Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			Logger:           stubLogger{},
		},
	})

	_, err := manager.Services("default")
	require.Error(t, err)
}

func TestManagerServicesBuildsFromEndpointSlices(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.5",
			Ports:     []corev1.ServicePort{{Port: 80}},
		},
	}
	client := kubefake.NewSimpleClientset(svc)
	manager := network.NewService(network.Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			Logger:           stubLogger{},
		},
	})

	details, err := manager.Services("default")
	require.NoError(t, err)
	require.Len(t, details, 1)
	require.Equal(t, "Unknown", details[0].HealthStatus) // no endpoint slices provided
}
