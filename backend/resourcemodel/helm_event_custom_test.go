package resourcemodel

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	helmtime "helm.sh/helm/v3/pkg/time"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildHelmReleaseResourceModelSyntheticIdentityAndFacts(t *testing.T) {
	first := helmtime.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	last := helmtime.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)
	rel := &release.Release{
		Name:      "orders",
		Namespace: "apps",
		Version:   3,
		Chart: &chart.Chart{Metadata: &chart.Metadata{
			Name:        "orders-chart",
			Version:     "1.2.3",
			AppVersion:  "4.5.6",
			Annotations: map[string]string{"category": "backend"},
		}},
		Info: &release.Info{
			Status:        release.StatusDeployed,
			FirstDeployed: first,
			LastDeployed:  last,
			Description:   "Upgrade complete",
		},
		Labels: map[string]string{"app.kubernetes.io/name": "orders"},
	}
	history := []*release.Release{{
		Version: 2,
		Chart:   &chart.Chart{Metadata: &chart.Metadata{Name: "orders-chart", Version: "1.2.2"}},
		Info:    &release.Info{Status: release.StatusSuperseded, LastDeployed: first},
	}}
	resources := []ResourceLink{BuildHelmManifestResourceLink("cluster-a", "apps/v1", "Deployment", "apps", "orders")}

	model := BuildHelmReleaseResourceModel("cluster-a", rel, "", resources, history)

	require.Equal(t, ResourceSourceSynthetic, model.Source)
	require.Equal(t, ResourceRef{
		ClusterID: "cluster-a",
		Group:     "helm.sh",
		Version:   "v3",
		Kind:      "HelmRelease",
		Resource:  "releases",
		Namespace: "apps",
		Name:      "orders",
	}, model.Ref)
	require.Equal(t, "deployed", model.Status.State)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, map[string]string{"category": "backend"}, model.Metadata.Annotations)

	facts := model.Facts.HelmRelease
	require.NotNil(t, facts)
	require.Equal(t, "orders-chart-1.2.3", facts.Chart)
	require.Equal(t, "1.2.3", facts.Version)
	require.Equal(t, "4.5.6", facts.AppVersion)
	require.Equal(t, 3, facts.Revision)
	require.Equal(t, "deployed", facts.RawStatus)
	require.Equal(t, "Upgrade complete", facts.Description)
	require.Equal(t, metav1.NewTime(last.Time), *facts.Updated)
	require.Len(t, facts.Resources, 1)
	require.Equal(t, "Deployment", facts.Resources[0].Ref.Kind)
	require.Equal(t, "apps", facts.Resources[0].Ref.Group)
	require.Equal(t, "v1", facts.Resources[0].Ref.Version)
	require.Equal(t, "apps", facts.Resources[0].Ref.Namespace)
	require.Len(t, facts.History, 1)
	require.Equal(t, "superseded", facts.History[0].Status)
}

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

	model := BuildEventResourceModel("cluster-a", event)

	require.Equal(t, "Warning", model.Status.State)
	require.Equal(t, "warning", model.Status.Presentation)
	facts := model.Facts.Event
	require.NotNil(t, facts)
	require.Equal(t, "kubelet on node-a", facts.Source)
	require.Equal(t, "BackOff", facts.Reason)
	require.Equal(t, "Deployment", facts.InvolvedObject.Ref.Kind)
	require.Equal(t, "apps", facts.InvolvedObject.Ref.Group)
	require.Equal(t, "v1", facts.InvolvedObject.Ref.Version)
	require.Equal(t, "apps", facts.InvolvedObject.Ref.Namespace)
	require.Equal(t, "orders", facts.InvolvedObject.Ref.Name)
	require.Equal(t, "deployment-uid", facts.InvolvedObject.Ref.UID)
	require.Equal(t, "Deployment/orders", EventObjectDisplay(event))

	event.InvolvedObject.APIVersion = ""
	partialFacts := BuildEventFacts("cluster-a", event)
	require.Nil(t, partialFacts.InvolvedObject.Ref)
	require.NotNil(t, partialFacts.InvolvedObject.Display)
	require.Equal(t, "Deployment", partialFacts.InvolvedObject.Display.Kind)
	require.Equal(t, "orders", partialFacts.InvolvedObject.Display.Name)
}

func TestBuildCustomResourceModelExtractsDynamicStatus(t *testing.T) {
	resource := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "databases.example.com/v1alpha1",
		"kind":       "Database",
		"metadata": map[string]any{
			"name":       "orders",
			"namespace":  "apps",
			"uid":        "database-uid",
			"generation": int64(4),
		},
		"status": map[string]any{
			"phase":              "Reconciling",
			"ready":              false,
			"observedGeneration": int64(3),
			"conditions": []any{map[string]any{
				"type":               "Ready",
				"status":             "False",
				"reason":             "WaitingForStorage",
				"message":            "volume is not ready",
				"lastTransitionTime": "2026-01-04T12:00:00Z",
			}},
		},
	}}
	gvr := schema.GroupVersionResource{Group: "databases.example.com", Version: "v1alpha1", Resource: "databases"}

	model := BuildCustomResourceModel("cluster-a", resource, gvr, "Database", "databases.databases.example.com", ResourceScopeNamespaced, "")

	require.Equal(t, ResourceRef{
		ClusterID: "cluster-a",
		Group:     "databases.example.com",
		Version:   "v1alpha1",
		Kind:      "Database",
		Resource:  "databases",
		Namespace: "apps",
		Name:      "orders",
		UID:       "database-uid",
	}, model.Ref)
	require.Equal(t, "Reconciling", model.Status.State)
	require.Equal(t, "progressing", model.Status.Presentation)
	facts := model.Facts.CustomResource
	require.NotNil(t, facts)
	require.Equal(t, "Reconciling", facts.Phase)
	require.False(t, *facts.Ready)
	require.Equal(t, int64(3), *facts.ObservedGeneration)
	require.Len(t, facts.Conditions, 1)
	require.Equal(t, "Ready", facts.Conditions[0].Type)
	require.Equal(t, "False", facts.Conditions[0].Status)
	require.Equal(t, "CustomResourceDefinition", facts.CRD.Ref.Kind)
	require.Equal(t, "databases.databases.example.com", facts.CRD.Ref.Name)
}
