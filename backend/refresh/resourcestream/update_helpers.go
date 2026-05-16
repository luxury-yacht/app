package resourcestream

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

func (m *Manager) newObjectUpdate(updateType MessageType, domain string, obj metav1.Object, kind string) Update {
	return Update{
		Type:            updateType,
		Domain:          domain,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: obj.GetResourceVersion(),
		UID:             string(obj.GetUID()),
		Name:            obj.GetName(),
		Namespace:       obj.GetNamespace(),
		Kind:            kind,
	}
}

func (m *Manager) newObjectRowUpdate(updateType MessageType, domain string, obj metav1.Object, kind string, row interface{}) Update {
	update := m.newObjectUpdate(updateType, domain, obj, kind)
	if updateType != MessageTypeDeleted {
		update.Row = row
	}
	return update
}
