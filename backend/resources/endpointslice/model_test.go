package endpointslice_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/resources/endpointslice"
)

// TestBuildResourceModelFactsAndStatus covers the EndpointSlice status presentation
// + facts that moved here with the model (was in resourcemodel's network test).
func TestBuildResourceModelFactsAndStatus(t *testing.T) {
	notReady := false
	terminating := true
	portName := "http"
	portValue := int32(8080)
	protocol := corev1.ProtocolTCP
	appProtocol := "kubernetes.io/h2c"
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-a",
			Namespace: "default",
			Labels:    map[string]string{discoveryv1.LabelServiceName: "api"},
			UID:       types.UID("slice-uid"),
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports: []discoveryv1.EndpointPort{{
			Name:        &portName,
			Port:        &portValue,
			Protocol:    &protocol,
			AppProtocol: &appProtocol,
		}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.244.0.10"},
			Conditions: discoveryv1.EndpointConditions{
				Ready:       &notReady,
				Terminating: &terminating,
			},
			TargetRef: &corev1.ObjectReference{
				APIVersion: "v1",
				Kind:       "Pod",
				Name:       "api-0",
				UID:        types.UID("pod-uid"),
			},
		}},
	}

	model := endpointslice.BuildResourceModel("cluster-a", slice)
	require.Equal(t, "EndpointSlice", model.Ref.Kind)
	require.Equal(t, "endpointslices", model.Ref.Resource)
	require.Equal(t, "0", model.Status.State)
	require.Equal(t, "No ready addresses", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)

	facts := endpointslice.BuildFacts("cluster-a", slice)
	require.Len(t, facts.NotReadyAddresses, 1)
	require.Equal(t, "10.244.0.10", facts.NotReadyAddresses[0].IP)
	require.NotNil(t, facts.NotReadyAddresses[0].TargetRef.Ref)
	require.Nil(t, facts.NotReadyAddresses[0].TargetRef.Display)
	require.Equal(t, "cluster-a", facts.NotReadyAddresses[0].TargetRef.Ref.ClusterID)
	require.Equal(t, "v1", facts.NotReadyAddresses[0].TargetRef.Ref.Version)
	require.Equal(t, "Pod", facts.NotReadyAddresses[0].TargetRef.Ref.Kind)
	require.Equal(t, "default", facts.NotReadyAddresses[0].TargetRef.Ref.Namespace)
	require.Equal(t, "api-0", facts.NotReadyAddresses[0].TargetRef.Ref.Name)
	require.Equal(t, "Service", facts.Service.Display.Kind)
	require.Equal(t, "api", facts.Service.Display.Name)
	require.Equal(t, "http", facts.Ports[0].Name)
	require.Equal(t, int32(8080), facts.Ports[0].Port)
	require.Equal(t, "TCP", facts.Ports[0].Protocol)
	require.Equal(t, "kubernetes.io/h2c", facts.Ports[0].AppProtocol)
}
