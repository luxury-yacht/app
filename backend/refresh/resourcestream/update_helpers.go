package resourcestream

import (
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func (m *Manager) resourceRefForObject(obj metav1.Object, group, version, kind, resource string) resourcemodel.ResourceRef {
	if obj == nil {
		return resourcemodel.NewResourceRef(m.clusterMeta.ClusterID, group, version, kind, resource, "", "", "")
	}
	return resourcemodel.NewResourceRef(
		m.clusterMeta.ClusterID,
		group,
		version,
		kind,
		resource,
		obj.GetNamespace(),
		obj.GetName(),
		string(obj.GetUID()),
	)
}

func (m *Manager) helmReleaseRef(namespace, name string) resourcemodel.ResourceRef {
	return resourcemodel.NewResourceRef(
		m.clusterMeta.ClusterID,
		"helm.sh",
		"v3",
		"HelmRelease",
		"releases",
		namespace,
		name,
		"",
	)
}

func (m *Manager) newObjectUpdate(updateType MessageType, domain string, obj metav1.Object, ref resourcemodel.ResourceRef) Update {
	if strings.TrimSpace(ref.ClusterID) == "" {
		ref.ClusterID = m.clusterMeta.ClusterID
	}
	return Update{
		Type:            updateType,
		Domain:          domain,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: obj.GetResourceVersion(),
		Ref:             &ref,
	}
}

func (m *Manager) newObjectRowUpdate(updateType MessageType, domain string, obj metav1.Object, ref resourcemodel.ResourceRef, row interface{}) Update {
	update := m.newObjectUpdate(updateType, domain, obj, ref)
	// Deletes never carry a row; notify-only domains never carry one either —
	// their query-backed views consume only the change signal (see notify_only.go).
	if updateType != MessageTypeDeleted && !isNotifyOnlyStreamDomain(domain) {
		update.Row = row
	}
	return update
}
