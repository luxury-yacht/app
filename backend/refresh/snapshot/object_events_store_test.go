package snapshot

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	kubefake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

// The events store keeps each Event as its catalog Summary plus a slim fact.
// An object's Events tab served from the store must be the page the API list
// serves for the same Events, field for field: every value the tab shows has
// to survive the slim projection.
func TestObjectEventsStorePageMatchesTheAPIListPage(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	now := time.Now().Truncate(time.Second)
	web := corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Namespace: "team-a", Name: "web", UID: "web-uid", FieldPath: "spec.containers{app}"}
	object := func(name, rv string, ref corev1.ObjectReference) metav1.ObjectMeta {
		return metav1.ObjectMeta{Name: name, Namespace: ref.Namespace, ResourceVersion: rv, UID: types.UID("uid-" + name),
			CreationTimestamp: metav1.NewTime(now.Add(-time.Hour))}
	}
	legacy := &corev1.Event{
		ObjectMeta:     object("web.legacy", "11", web),
		InvolvedObject: web, Type: corev1.EventTypeWarning, Reason: "  BackOff ", Message: " Back-off restarting ",
		Count: 7, Source: corev1.EventSource{Component: "kubelet", Host: "node-a"},
		FirstTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)), LastTimestamp: metav1.NewTime(now.Add(-time.Minute)),
	}
	legacy.Labels = map[string]string{"app": "web"}
	legacy.Annotations = map[string]string{"note": "kept"}
	series := &corev1.Event{
		ObjectMeta:     object("web.series", "12", web),
		InvolvedObject: web, Type: corev1.EventTypeNormal, Reason: "Pulled",
		EventTime:           metav1.NewMicroTime(now.Add(-20 * time.Minute)),
		Series:              &corev1.EventSeries{Count: 40, LastObservedTime: metav1.NewMicroTime(now.Add(-2 * time.Second))},
		ReportingController: "kubelet", ReportingInstance: "node-a",
	}
	creationOnly := &corev1.Event{ObjectMeta: object("web.created", "13", web), InvolvedObject: web, Type: corev1.EventTypeNormal}
	noAPIVersion := web
	noAPIVersion.APIVersion = ""
	unversioned := &corev1.Event{ObjectMeta: object("web.unversioned", "14", web), InvolvedObject: noAPIVersion,
		LastTimestamp: metav1.NewTime(now.Add(-5 * time.Minute))}
	otherGroup := web
	otherGroup.APIVersion = "example.com/v1"
	sibling := &corev1.Event{ObjectMeta: object("web.crd", "15", web), InvolvedObject: otherGroup, LastTimestamp: metav1.NewTime(now)}
	otherObject := web
	otherObject.Name = "api"
	unrelated := &corev1.Event{ObjectMeta: object("api.1", "16", web), InvolvedObject: otherObject, LastTimestamp: metav1.NewTime(now)}

	// The API server's field selector returns the Events naming the object's
	// namespace, kind, and name; the group is told apart after the list.
	selected := []corev1.Event{*legacy, *series, *creationOnly, *unversioned, *sibling}
	client := kubefake.NewClientset()
	client.PrependReactor("list", "events", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, &corev1.EventList{ListMeta: metav1.ListMeta{ResourceVersion: "20"}, Items: selected}, nil
	})
	store := newEventStore(t, meta, legacy, series, creationOnly, unversioned, sibling, unrelated)

	ctx := WithClusterMeta(context.Background(), meta)
	scope := "team-a:/v1:Pod:web"
	fromAPI, err := (&ObjectEventsBuilder{client: client}).Build(ctx, scope)
	require.NoError(t, err)
	fromStore, err := (&ObjectEventsBuilder{client: kubefake.NewClientset(), events: store}).Build(ctx, scope)
	require.NoError(t, err)

	apiPayload := fromAPI.Payload.(ObjectEventsSnapshotPayload)
	require.Len(t, apiPayload.Events, 4, "the API page keeps the core-group Events")
	want, err := json.Marshal(apiPayload)
	require.NoError(t, err)
	got, err := json.Marshal(fromStore.Payload)
	require.NoError(t, err)
	require.JSONEq(t, string(want), string(got))
	require.Equal(t, fromAPI.Stats, fromStore.Stats)
}
