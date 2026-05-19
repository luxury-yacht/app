package resourcestream

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

func (m *Manager) newObjectUpdate(updateType MessageType, domain string, obj metav1.Object, kind string) Update {
	apiGroup, apiVersion := apiGroupVersionForStreamKind(kind)
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
		APIGroup:        apiGroup,
		APIVersion:      apiVersion,
	}
}

func (m *Manager) newObjectRowUpdate(updateType MessageType, domain string, obj metav1.Object, kind string, row interface{}) Update {
	update := m.newObjectUpdate(updateType, domain, obj, kind)
	if updateType != MessageTypeDeleted {
		update.Row = row
	}
	return update
}

func apiGroupVersionForStreamKind(kind string) (string, string) {
	switch kind {
	case "Pod", "Node", "ConfigMap", "Secret", "Service", "ServiceAccount", "PersistentVolumeClaim", "PersistentVolume", "ResourceQuota", "LimitRange":
		return "", "v1"
	case "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet":
		return "apps", "v1"
	case "Job", "CronJob":
		return "batch", "v1"
	case "HorizontalPodAutoscaler":
		return "autoscaling", "v1"
	case "PodDisruptionBudget":
		return "policy", "v1"
	case "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding":
		return "rbac.authorization.k8s.io", "v1"
	case "EndpointSlice":
		return "discovery.k8s.io", "v1"
	case "Ingress", "IngressClass", "NetworkPolicy":
		return "networking.k8s.io", "v1"
	case "Gateway", "HTTPRoute", "GRPCRoute", "TLSRoute", "ListenerSet", "ReferenceGrant", "BackendTLSPolicy", "GatewayClass":
		return "gateway.networking.k8s.io", "v1"
	case "StorageClass":
		return "storage.k8s.io", "v1"
	case "ValidatingWebhookConfiguration", "MutatingWebhookConfiguration":
		return "admissionregistration.k8s.io", "v1"
	case "CustomResourceDefinition":
		return "apiextensions.k8s.io", "v1"
	default:
		return "", ""
	}
}
