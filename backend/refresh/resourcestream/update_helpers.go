package resourcestream

import (
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func (m *Manager) resourceRefForObject(obj metav1.Object, group, version, kind, resource string) resourcemodel.ResourceRef {
	if obj == nil {
		return resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: m.clusterMeta.ClusterID, Group: group, Version: version, Kind: kind, Resource: resource, Namespace: "", Name: "", UID: ""})
	}
	return resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: m.clusterMeta.ClusterID, Group: group, Version: version, Kind: kind, Resource: resource, Namespace: obj.GetNamespace(), Name: obj.GetName(), UID: string(obj.GetUID())})

}

func (m *Manager) helmReleaseRef(namespace, name string) resourcemodel.ResourceRef {
	return resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: m.clusterMeta.ClusterID, Group: "helm.sh", Version: "v3", Kind: "HelmRelease", Resource: "releases", Namespace: namespace, Name: name, UID: ""})

}

func (m *Manager) newObjectUpdate(updateType MessageType, domain, resourceVersion string, ref resourcemodel.ResourceRef) Update {
	if strings.TrimSpace(ref.ClusterID) == "" {
		ref.ClusterID = m.clusterMeta.ClusterID
	}
	return Update{
		Type:            updateType,
		Domain:          domain,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: resourceVersion,
		Ref:             &ref,
	}
}
