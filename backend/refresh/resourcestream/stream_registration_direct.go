package resourcestream

import (
	"github.com/luxury-yacht/app/backend/refresh/informer"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// This file registers direct object-to-stream resources. These handlers do not
// need manager-level listers, indexers, or related-object lookup state; each
// informer event is forwarded to the matching resource stream handler.

func (m *Manager) registerConfigStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("", "configmaps") {
		m.addRelatedResourceEventHandler(shared.Core().V1().ConfigMaps().Informer(), (*Manager).handleConfigMapEvent)
	}
	if m.canListWatch("", "secrets") {
		m.addRelatedResourceEventHandler(shared.Core().V1().Secrets().Informer(), (*Manager).handleSecretEvent)
	}
}

func (m *Manager) registerAutoscalingStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("autoscaling", "horizontalpodautoscalers") {
		m.addRelatedResourceEventHandler(shared.Autoscaling().V1().HorizontalPodAutoscalers().Informer(), (*Manager).handleHPAEvent)
	}
}

func (m *Manager) registerClusterConfigStreams(factory *informer.Factory) {
	gatewayShared := factory.GatewayInformerFactory()
	if gatewayShared == nil {
		return
	}
	if m.canListWatch("gateway.networking.k8s.io", "gatewayclasses") {
		m.addResourceEventHandler(gatewayShared.Gateway().V1().GatewayClasses().Informer(), (*Manager).handleGatewayClass)
	}
}

type streamRegistration struct {
	group    string
	resource string
	informer func(informers.SharedInformerFactory) cache.SharedIndexInformer
	handler  streamResourceHandler
}

var sharedStreamRegistrations = []streamRegistration{
	{"", "persistentvolumeclaims", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().PersistentVolumeClaims().Informer()
	}, (*Manager).handlePersistentVolumeClaim},
	{"", "persistentvolumes", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().PersistentVolumes().Informer()
	}, (*Manager).handlePersistentVolume},
	{"rbac.authorization.k8s.io", "roles", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Rbac().V1().Roles().Informer()
	}, (*Manager).handleRole},
	{"rbac.authorization.k8s.io", "rolebindings", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Rbac().V1().RoleBindings().Informer()
	}, (*Manager).handleRoleBinding},
	{"", "serviceaccounts", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().ServiceAccounts().Informer()
	}, (*Manager).handleServiceAccount},
	{"rbac.authorization.k8s.io", "clusterroles", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Rbac().V1().ClusterRoles().Informer()
	}, (*Manager).handleClusterRole},
	{"rbac.authorization.k8s.io", "clusterrolebindings", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Rbac().V1().ClusterRoleBindings().Informer()
	}, (*Manager).handleClusterRoleBinding},
	{"", "resourcequotas", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().ResourceQuotas().Informer()
	}, (*Manager).handleResourceQuota},
	{"", "limitranges", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().LimitRanges().Informer()
	}, (*Manager).handleLimitRange},
	{"policy", "poddisruptionbudgets", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Policy().V1().PodDisruptionBudgets().Informer()
	}, (*Manager).handlePodDisruptionBudget},
	{"storage.k8s.io", "storageclasses", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Storage().V1().StorageClasses().Informer()
	}, (*Manager).handleStorageClass},
	{"networking.k8s.io", "ingressclasses", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Networking().V1().IngressClasses().Informer()
	}, (*Manager).handleIngressClass},
	{"admissionregistration.k8s.io", "validatingwebhookconfigurations", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Admissionregistration().V1().ValidatingWebhookConfigurations().Informer()
	}, (*Manager).handleValidatingWebhook},
	{"admissionregistration.k8s.io", "mutatingwebhookconfigurations", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Admissionregistration().V1().MutatingWebhookConfigurations().Informer()
	}, (*Manager).handleMutatingWebhook},
}

// registerSharedStreams wires every direct (non-stateful) built-in kind served by
// the shared informer factory from a single descriptor table.
func (m *Manager) registerSharedStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	for _, d := range sharedStreamRegistrations {
		if m.canListWatch(d.group, d.resource) {
			m.addResourceEventHandler(d.informer(shared), d.handler)
		}
	}
}
