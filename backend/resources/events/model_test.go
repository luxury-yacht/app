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

func TestBuildFactsProjectsCompleteEventDetails(t *testing.T) {
	eventTime := metav1.NewMicroTime(time.Date(2026, 1, 3, 12, 0, 0, 0, time.UTC))
	lastObserved := metav1.NewMicroTime(time.Date(2026, 1, 3, 12, 5, 0, 0, time.UTC))
	event := &corev1.Event{
		Action:              "Killing",
		ReportingController: "kubernetes.io/kubelet",
		ReportingInstance:   "kubelet-node-a",
		EventTime:           eventTime,
		Series: &corev1.EventSeries{
			Count:            7,
			LastObservedTime: lastObserved,
		},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "v1",
			Kind:       "Pod",
			Namespace:  "apps",
			Name:       "orders-abc",
			FieldPath:  "spec.containers{api}",
		},
		Related: &corev1.ObjectReference{
			APIVersion: "v1",
			Kind:       "Node",
			Name:       "node-a",
			FieldPath:  "status.conditions{Ready}",
		},
	}

	facts := BuildFacts("cluster-a", event)

	require.Equal(t, "Killing", facts.Action)
	require.Equal(t, "kubernetes.io/kubelet", facts.ReportingController)
	require.Equal(t, "kubelet-node-a", facts.ReportingInstance)
	require.Equal(t, eventTime.Time, facts.EventTime.Time)
	require.Equal(t, eventTime.Time, facts.FirstTimestamp.Time)
	require.Equal(t, lastObserved.Time, facts.LastTimestamp.Time)
	require.NotNil(t, facts.SeriesCount)
	require.Equal(t, int32(7), *facts.SeriesCount)
	require.NotNil(t, facts.SeriesLastObservedTime)
	require.Equal(t, lastObserved.Time, facts.SeriesLastObservedTime.Time)
	require.Equal(t, "spec.containers{api}", facts.InvolvedObjectFieldPath)
	require.NotNil(t, facts.RelatedObject)
	require.NotNil(t, facts.RelatedObject.Ref)
	require.Equal(t, "cluster-a", facts.RelatedObject.Ref.ClusterID)
	require.Equal(t, "", facts.RelatedObject.Ref.Group)
	require.Equal(t, "v1", facts.RelatedObject.Ref.Version)
	require.Equal(t, "Node", facts.RelatedObject.Ref.Kind)
	require.Equal(t, "node-a", facts.RelatedObject.Ref.Name)
	require.Equal(t, "status.conditions{Ready}", facts.RelatedObjectFieldPath)
}

func TestBuildFactsOmitsMissingSeriesObservationTime(t *testing.T) {
	facts := BuildFacts("cluster-a", &corev1.Event{Series: &corev1.EventSeries{Count: 2}})

	require.NotNil(t, facts.SeriesCount)
	require.Nil(t, facts.SeriesLastObservedTime)
}
