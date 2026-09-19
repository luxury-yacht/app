package resourcestream

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// SubscribeCustomResourceChanges connects catalog membership to the same watches
// that already drive custom-resource details and domain notifications.
func (m *Manager) SubscribeCustomResourceChanges(listener func(resourcemodel.ResourceRef)) func() {
	m.customChangeMu.Lock()
	defer m.customChangeMu.Unlock()
	if m.stopped.Load() || listener == nil {
		return func() {
			// Stopped managers and absent listeners do not create subscriptions.
		}
	}
	if m.customChangeSubscribers == nil {
		m.customChangeSubscribers = make(map[uint64]func(resourcemodel.ResourceRef))
	}
	m.nextCustomChangeID++
	id := m.nextCustomChangeID
	m.customChangeSubscribers[id] = listener
	return func() {
		m.customChangeMu.Lock()
		delete(m.customChangeSubscribers, id)
		m.customChangeMu.Unlock()
	}
}

func (m *Manager) notifyCustomResourceChange(ref resourcemodel.ResourceRef) {
	m.customChangeMu.Lock()
	listeners := make([]func(resourcemodel.ResourceRef), 0, len(m.customChangeSubscribers))
	if !m.stopped.Load() {
		for _, listener := range m.customChangeSubscribers {
			listeners = append(listeners, listener)
		}
	}
	m.customChangeMu.Unlock()
	// Never call consumers under a manager lock: catalog publication later sends
	// its own change signal back through this manager.
	for _, listener := range listeners {
		listener(ref)
	}
}

// WatchedCustomResource reads the current object, including absence, from the
// existing permission-gated informer. It never starts a new watch or an API call.
func (m *Manager) WatchedCustomResource(ref resourcemodel.ResourceRef) (metav1.Object, bool) {
	if ref.ClusterID != m.clusterMeta.ClusterID || m.stopped.Load() {
		return nil, false
	}
	m.customInformerMu.Lock()
	defer m.customInformerMu.Unlock()
	info := m.customInformers[ref.Resource+"."+ref.Group]
	if info == nil || info.gvr.Version != ref.Version || info.kind != ref.Kind {
		return nil, false
	}
	return info.currentObject(ref)
}

func (info *customResourceInformer) currentObject(ref resourcemodel.ResourceRef) (metav1.Object, bool) {
	key := ref.Name
	if ref.Namespace != "" {
		key = ref.Namespace + "/" + ref.Name
	}
	for index, namespace := range info.namespaces {
		if namespace != "" && namespace != ref.Namespace {
			continue
		}
		informer := info.informers[index]
		if !informer.HasSynced() {
			return nil, false
		}
		obj, _, err := informer.GetStore().GetByKey(key)
		resource, _ := obj.(metav1.Object)
		return resource, err == nil
	}
	return nil, false
}
