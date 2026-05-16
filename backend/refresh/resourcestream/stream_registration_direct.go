package resourcestream

import "github.com/luxury-yacht/app/backend/refresh/informer"

// This file registers direct object-to-stream resources. These handlers do not
// need manager-level listers, indexers, or related-object lookup state; each
// informer event is forwarded to the matching resource stream handler.

func (m *Manager) registerConfigStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("", "configmaps") {
		m.addResourceEventHandler(shared.Core().V1().ConfigMaps().Informer(), (*Manager).handleConfigMap)
	}
	if m.canListWatch("", "secrets") {
		m.addResourceEventHandler(shared.Core().V1().Secrets().Informer(), (*Manager).handleSecret)
	}
}

func (m *Manager) registerStorageStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("", "persistentvolumeclaims") {
		m.addResourceEventHandler(shared.Core().V1().PersistentVolumeClaims().Informer(), (*Manager).handlePersistentVolumeClaim)
	}
	if m.canListWatch("", "persistentvolumes") {
		m.addResourceEventHandler(shared.Core().V1().PersistentVolumes().Informer(), (*Manager).handlePersistentVolume)
	}
}

func (m *Manager) registerAutoscalingStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("autoscaling", "horizontalpodautoscalers") {
		m.addResourceEventHandler(shared.Autoscaling().V1().HorizontalPodAutoscalers().Informer(), (*Manager).handleHPA)
	}
}

func (m *Manager) registerRBACStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("rbac.authorization.k8s.io", "roles") {
		m.addResourceEventHandler(shared.Rbac().V1().Roles().Informer(), (*Manager).handleRole)
	}
	if m.canListWatch("rbac.authorization.k8s.io", "rolebindings") {
		m.addResourceEventHandler(shared.Rbac().V1().RoleBindings().Informer(), (*Manager).handleRoleBinding)
	}
	if m.canListWatch("", "serviceaccounts") {
		m.addResourceEventHandler(shared.Core().V1().ServiceAccounts().Informer(), (*Manager).handleServiceAccount)
	}
	if m.canListWatch("rbac.authorization.k8s.io", "clusterroles") {
		m.addResourceEventHandler(shared.Rbac().V1().ClusterRoles().Informer(), (*Manager).handleClusterRole)
	}
	if m.canListWatch("rbac.authorization.k8s.io", "clusterrolebindings") {
		m.addResourceEventHandler(shared.Rbac().V1().ClusterRoleBindings().Informer(), (*Manager).handleClusterRoleBinding)
	}
}

func (m *Manager) registerQuotaStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("", "resourcequotas") {
		m.addResourceEventHandler(shared.Core().V1().ResourceQuotas().Informer(), (*Manager).handleResourceQuota)
	}
	if m.canListWatch("", "limitranges") {
		m.addResourceEventHandler(shared.Core().V1().LimitRanges().Informer(), (*Manager).handleLimitRange)
	}
	if m.canListWatch("policy", "poddisruptionbudgets") {
		m.addResourceEventHandler(shared.Policy().V1().PodDisruptionBudgets().Informer(), (*Manager).handlePodDisruptionBudget)
	}
}

func (m *Manager) registerClusterConfigStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared != nil {
		if m.canListWatch("storage.k8s.io", "storageclasses") {
			m.addResourceEventHandler(shared.Storage().V1().StorageClasses().Informer(), (*Manager).handleStorageClass)
		}
		if m.canListWatch("networking.k8s.io", "ingressclasses") {
			m.addResourceEventHandler(shared.Networking().V1().IngressClasses().Informer(), (*Manager).handleIngressClass)
		}
		if m.canListWatch("admissionregistration.k8s.io", "validatingwebhookconfigurations") {
			m.addResourceEventHandler(shared.Admissionregistration().V1().ValidatingWebhookConfigurations().Informer(), (*Manager).handleValidatingWebhook)
		}
		if m.canListWatch("admissionregistration.k8s.io", "mutatingwebhookconfigurations") {
			m.addResourceEventHandler(shared.Admissionregistration().V1().MutatingWebhookConfigurations().Informer(), (*Manager).handleMutatingWebhook)
		}
	}

	gatewayShared := factory.GatewayInformerFactory()
	if gatewayShared == nil {
		return
	}
	if m.canListWatch("gateway.networking.k8s.io", "gatewayclasses") {
		m.addResourceEventHandler(gatewayShared.Gateway().V1().GatewayClasses().Informer(), (*Manager).handleGatewayClass)
	}
}
