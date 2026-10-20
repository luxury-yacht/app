package resourcestream

import "k8s.io/client-go/tools/cache"

// This file contains the shared mechanics for the stream's informer
// registrations: permission checks and Add/Update/Delete event mapping.

type relatedResourceHandler func(*Manager, interface{}, interface{}, MessageType)

func (m *Manager) canListWatch(group, resource string) bool {
	return m.permissions == nil || m.permissions.CanListWatch(group, resource)
}

func (m *Manager) addRelatedResourceEventHandler(informer cache.SharedIndexInformer, handler relatedResourceHandler) {
	if m == nil || informer == nil || handler == nil {
		return
	}
	informer.AddEventHandler(relatedResourceStreamEventHandler(m, handler))
}

func relatedResourceStreamEventHandler(m *Manager, handler relatedResourceHandler) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { handler(m, nil, obj, MessageTypeAdded) },
		UpdateFunc: func(oldObj, newObj interface{}) { handler(m, oldObj, newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { handler(m, obj, nil, MessageTypeDeleted) },
	}
}
