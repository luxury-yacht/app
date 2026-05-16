package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"
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
