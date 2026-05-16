package resourcestream

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
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

	update := manager.newObjectUpdate(MessageTypeModified, domainNamespaceConfig, configMap, "ConfigMap")

	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainNamespaceConfig, update.Domain)
	require.Equal(t, "cluster-id", update.ClusterID)
	require.Equal(t, "cluster-name", update.ClusterName)
	require.Equal(t, "42", update.ResourceVersion)
	require.Equal(t, "cfg-uid", update.UID)
	require.Equal(t, "cfg", update.Name)
	require.Equal(t, "default", update.Namespace)
	require.Equal(t, "ConfigMap", update.Kind)
	require.Nil(t, update.Row)
}

func TestManagerNewObjectRowUpdateOmitsRowsForDeletes(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "secret",
			Namespace:       "default",
			UID:             "secret-uid",
			ResourceVersion: "9",
		},
	}
	row := map[string]string{"name": "secret"}

	added := manager.newObjectRowUpdate(MessageTypeAdded, domainNamespaceConfig, secret, "Secret", row)
	require.Equal(t, row, added.Row)

	deleted := manager.newObjectRowUpdate(MessageTypeDeleted, domainNamespaceConfig, secret, "Secret", row)
	require.Nil(t, deleted.Row)
	require.Equal(t, "secret", deleted.Name)
	require.Equal(t, "default", deleted.Namespace)
}
