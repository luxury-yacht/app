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

func TestManagerNewObjectRowUpdateCarriesMetadataForStreamedBuiltInKinds(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	tests := []struct {
		name      string
		domain    string
		kind      string
		namespace string
	}{
		{name: "configmaps", domain: domainNamespaceConfig, kind: "ConfigMap", namespace: "default"},
		{name: "secrets", domain: domainNamespaceConfig, kind: "Secret", namespace: "default"},
		{name: "services", domain: domainNamespaceNetwork, kind: "Service", namespace: "default"},
		{name: "endpoint slices", domain: domainNamespaceNetwork, kind: "EndpointSlice", namespace: "default"},
		{name: "ingresses", domain: domainNamespaceNetwork, kind: "Ingress", namespace: "default"},
		{name: "network policies", domain: domainNamespaceNetwork, kind: "NetworkPolicy", namespace: "default"},
		{name: "gateways", domain: domainNamespaceNetwork, kind: "Gateway", namespace: "default"},
		{name: "http routes", domain: domainNamespaceNetwork, kind: "HTTPRoute", namespace: "default"},
		{name: "grpc routes", domain: domainNamespaceNetwork, kind: "GRPCRoute", namespace: "default"},
		{name: "tls routes", domain: domainNamespaceNetwork, kind: "TLSRoute", namespace: "default"},
		{name: "listener sets", domain: domainNamespaceNetwork, kind: "ListenerSet", namespace: "default"},
		{name: "reference grants", domain: domainNamespaceNetwork, kind: "ReferenceGrant", namespace: "default"},
		{name: "backend tls policies", domain: domainNamespaceNetwork, kind: "BackendTLSPolicy", namespace: "default"},
		{name: "persistent volume claims", domain: domainNamespaceStorage, kind: "PersistentVolumeClaim", namespace: "default"},
		{name: "horizontal pod autoscalers", domain: domainNamespaceAutoscaling, kind: "HorizontalPodAutoscaler", namespace: "default"},
		{name: "resource quotas", domain: domainNamespaceQuotas, kind: "ResourceQuota", namespace: "default"},
		{name: "limit ranges", domain: domainNamespaceQuotas, kind: "LimitRange", namespace: "default"},
		{name: "pod disruption budgets", domain: domainNamespaceQuotas, kind: "PodDisruptionBudget", namespace: "default"},
		{name: "roles", domain: domainNamespaceRBAC, kind: "Role", namespace: "default"},
		{name: "role bindings", domain: domainNamespaceRBAC, kind: "RoleBinding", namespace: "default"},
		{name: "service accounts", domain: domainNamespaceRBAC, kind: "ServiceAccount", namespace: "default"},
		{name: "persistent volumes", domain: domainClusterStorage, kind: "PersistentVolume"},
		{name: "storage classes", domain: domainClusterConfig, kind: "StorageClass"},
		{name: "ingress classes", domain: domainClusterConfig, kind: "IngressClass"},
		{name: "gateway classes", domain: domainClusterConfig, kind: "GatewayClass"},
		{name: "validating webhooks", domain: domainClusterConfig, kind: "ValidatingWebhookConfiguration"},
		{name: "mutating webhooks", domain: domainClusterConfig, kind: "MutatingWebhookConfiguration"},
		{name: "cluster roles", domain: domainClusterRBAC, kind: "ClusterRole"},
		{name: "cluster role bindings", domain: domainClusterRBAC, kind: "ClusterRoleBinding"},
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

			update := manager.newObjectRowUpdate(MessageTypeAdded, tt.domain, object, tt.kind, row)

			require.Equal(t, tt.domain, update.Domain)
			require.Equal(t, "cluster-id", update.ClusterID)
			require.Equal(t, "cluster-name", update.ClusterName)
			require.Equal(t, "123", update.ResourceVersion)
			require.Equal(t, "resource-uid", update.UID)
			require.Equal(t, "resource-name", update.Name)
			require.Equal(t, tt.namespace, update.Namespace)
			require.Equal(t, tt.kind, update.Kind)
			require.Equal(t, row, update.Row)
		})
	}
}
