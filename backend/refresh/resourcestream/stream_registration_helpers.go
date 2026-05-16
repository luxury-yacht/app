package resourcestream

import "k8s.io/client-go/tools/cache"

// This file contains the shared mechanics for resource stream registration.
// Resource-specific files decide which informers to wire; these helpers keep
// permission checks and Add/Update/Delete event mapping consistent.

type streamResourceHandler func(*Manager, interface{}, MessageType)

func (m *Manager) canListWatch(group, resource string) bool {
	return m.permissions == nil || m.permissions.CanListWatch(group, resource)
}

func (m *Manager) addResourceEventHandler(informer cache.SharedIndexInformer, handler streamResourceHandler) {
	if m == nil || informer == nil || handler == nil {
		return
	}
	informer.AddEventHandler(resourceStreamEventHandler(m, handler))
}

func resourceStreamEventHandler(m *Manager, handler streamResourceHandler) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { handler(m, obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { handler(m, newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { handler(m, obj, MessageTypeDeleted) },
	}
}
