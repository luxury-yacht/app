package events

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildEventResourceModelInvolvedObjectLinks(t *testing.T) {
	eventTime := metav1.NewMicroTime(time.Date(2026, 1, 3, 12, 0, 0, 0, time.UTC))
	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: "orders.123", Namespace: "apps", UID: "event-uid"},
		Type:       corev1.EventTypeWarning,
		Reason:     "BackOff",
		Message:    "Back-off restarting failed container",
		Count:      5,
		EventTime:  eventTime,
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
			Namespace:  "apps",
			Name:       "orders",
			UID:        types.UID("deployment-uid"),
		},
		Source: corev1.EventSource{Component: "kubelet", Host: "node-a"},
	}

	model := BuildResourceModel("cluster-a", event)
	require.Equal(t, "Warning", model.Status.State)
	require.Equal(t, "warning", model.Status.Presentation)

	facts := BuildFacts("cluster-a", event)
	require.Equal(t, "kubelet on node-a", facts.Source)
	require.Equal(t, "BackOff", facts.Reason)
	require.NotNil(t, facts.InvolvedObject)
	require.Nil(t, facts.InvolvedObject.Display)
	require.Equal(t, "Deployment", facts.InvolvedObject.Ref.Kind)
	require.Equal(t, "apps", facts.InvolvedObject.Ref.Group)
	require.Equal(t, "v1", facts.InvolvedObject.Ref.Version)
	require.Equal(t, "apps", facts.InvolvedObject.Ref.Namespace)
	require.Equal(t, "orders", facts.InvolvedObject.Ref.Name)
	require.Equal(t, "deployment-uid", facts.InvolvedObject.Ref.UID)
	require.Equal(t, "Deployment/orders", EventObjectDisplay(event))

	event.InvolvedObject.APIVersion = ""
	partialFacts := BuildFacts("cluster-a", event)
	require.Nil(t, partialFacts.InvolvedObject.Ref)
	require.NotNil(t, partialFacts.InvolvedObject.Display)
	require.Equal(t, "Deployment", partialFacts.InvolvedObject.Display.Kind)
	require.Equal(t, "orders", partialFacts.InvolvedObject.Display.Name)
}
