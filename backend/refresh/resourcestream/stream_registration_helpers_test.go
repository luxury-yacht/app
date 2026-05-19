package resourcestream

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
	k8sfake "k8s.io/client-go/kubernetes/fake"
)

func TestResourceStreamEventHandlerMapsInformerEventsToMessageTypes(t *testing.T) {
	manager := &Manager{}
	var calls []struct {
		obj        interface{}
		updateType MessageType
	}
	handler := func(gotManager *Manager, obj interface{}, updateType MessageType) {
		require.Same(t, manager, gotManager)
		calls = append(calls, struct {
			obj        interface{}
			updateType MessageType
		}{obj: obj, updateType: updateType})
	}

	events := resourceStreamEventHandler(manager, handler)
	events.AddFunc("added")
	events.UpdateFunc("old", "modified")
	events.DeleteFunc("deleted")

	require.Equal(t, []struct {
		obj        interface{}
		updateType MessageType
	}{
		{obj: "added", updateType: MessageTypeAdded},
		{obj: "modified", updateType: MessageTypeModified},
		{obj: "deleted", updateType: MessageTypeDeleted},
	}, calls)
}

func TestManagerCanListWatchAllowsUngatedManagers(t *testing.T) {
	manager := &Manager{}

	require.True(t, manager.canListWatch("", "pods"))
	require.True(t, manager.canListWatch("apps", "deployments"))
}

func TestNewManagerGatesHPAListerWithListWatchPermission(t *testing.T) {
	review := func(_ context.Context, group, resource, _ string) (bool, error) {
		if group == "autoscaling" && resource == "horizontalpodautoscalers" {
			return false, nil
		}
		return true, nil
	}
	checker := permissions.NewCheckerWithReview("c1", time.Minute, review)
	factory := informer.New(k8sfake.NewSimpleClientset(), nil, time.Minute, checker)

	manager := NewManager(
		factory,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		nil,
	)

	require.Nil(t, manager.hpaLister)
}
