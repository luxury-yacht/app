package resourcestream

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestManagerNewObjectUpdateCopiesClusterAndObjectMetadata(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "cfg",
			Namespace:       "default",
			UID:             "cfg-uid",
			ResourceVersion: "42",
		},
	}

	ref := manager.resourceRefForObject(configMap, "", "v1", "ConfigMap", "configmaps")
	update := manager.newObjectUpdate(MessageTypeModified, domainNamespaceConfig, configMap, ref)

	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainNamespaceConfig, update.Domain)
	require.Equal(t, "cluster-id", update.ClusterID)
	require.Equal(t, "cluster-name", update.ClusterName)
	require.Equal(t, "42", update.ResourceVersion)
	require.Equal(t, "cfg-uid", update.Ref.UID)
	require.Equal(t, "cfg", update.Ref.Name)
	require.Equal(t, "default", update.Ref.Namespace)
	require.Equal(t, "ConfigMap", update.Ref.Kind)
	require.Equal(t, "", update.Ref.Group)
	require.Equal(t, "v1", update.Ref.Version)
	require.Equal(t, ref, *update.Ref)
}

func TestManagerResourceRefForObjectBuildsValidatedIdentity(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cfg",
			Namespace: "default",
			UID:       "cfg-uid",
		},
	}

	ref := manager.resourceRefForObject(configMap, "", "v1", "ConfigMap", "configmaps")

	require.NoError(t, resourcemodel.ValidateResourceRef(ref))
	require.Equal(t, "cluster-id", ref.ClusterID)
	require.Equal(t, "configmaps", ref.Resource)
}

func TestManagerResourceRefForObjectValidationRejectsIncompleteIdentity(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	configMap := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "cfg"}}

	require.Error(t, resourcemodel.ValidateResourceRef(manager.resourceRefForObject(configMap, "", "", "ConfigMap", "configmaps")))
	require.Error(t, resourcemodel.ValidateResourceRef(manager.resourceRefForObject(configMap, "", "v1", "Deployment", "deployments")))
}

func TestManagerNewObjectRowUpdateCarriesMetadataFromResourceRef(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	tests := []struct {
		name      string
		domain    string
		kind      string
		namespace string
		group     string
		version   string
		resource  string
	}{
		{name: "configmaps", domain: domainNamespaceConfig, kind: "ConfigMap", namespace: "default", version: "v1", resource: "configmaps"},
		{name: "endpoint slices", domain: domainNamespaceNetwork, kind: "EndpointSlice", namespace: "default", group: "discovery.k8s.io", version: "v1", resource: "endpointslices"},
		{name: "cluster roles", domain: domainClusterRBAC, kind: "ClusterRole", group: "rbac.authorization.k8s.io", version: "v1", resource: "clusterroles"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			object := &metav1.ObjectMeta{
				Name:            "resource-name",
				Namespace:       tt.namespace,
				UID:             "resource-uid",
				ResourceVersion: "123",
			}
			row := map[string]string{
				"clusterId": "cluster-id",
				"kind":      tt.kind,
				"name":      "resource-name",
			}
			if tt.namespace != "" {
				row["namespace"] = tt.namespace
			}

			ref := manager.resourceRefForObject(object, tt.group, tt.version, tt.kind, tt.resource)
			update := manager.newObjectRowUpdate(MessageTypeAdded, tt.domain, object, ref, row)

			require.Equal(t, tt.domain, update.Domain)
			require.Equal(t, "cluster-id", update.ClusterID)
			require.Equal(t, "cluster-name", update.ClusterName)
			require.Equal(t, "123", update.ResourceVersion)
			require.Equal(t, "resource-uid", update.Ref.UID)
			require.Equal(t, "resource-name", update.Ref.Name)
			require.Equal(t, tt.namespace, update.Ref.Namespace)
			require.Equal(t, tt.kind, update.Ref.Kind)
			require.Equal(t, tt.group, update.Ref.Group)
			require.Equal(t, tt.version, update.Ref.Version)
			require.Equal(t, tt.resource, update.Ref.Resource)
			require.Equal(t, ref, *update.Ref)
		})
	}
}
