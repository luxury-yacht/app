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
	// Every streamed table is query-backed: the visible page is fetched over HTTP
	// and the live subscription exists only to learn WHEN to refetch. The stream
	// therefore ships only the change signal (Ref + ResourceVersion); the projected
	// row is never sent. The row argument is retained so the guardrail test can keep
	// policing that callers pass a projector-derived value, and because some callers
	// (e.g. pods) still build the projection for load-bearing broadcast scope.
	_ = row
	return m.newObjectUpdate(updateType, domain, obj, ref)
}
