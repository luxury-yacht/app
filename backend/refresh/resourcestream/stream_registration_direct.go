package resourcestream

import (
	"github.com/luxury-yacht/app/backend/refresh/informer"
)

// This file registers the direct object-to-stream resources that still need a
// custom handler (related-object invalidation or a non-shared informer factory).
// Every plain object→row kind is registered from the descriptor registry via
// registerDescriptorStreams; see stream_descriptor_dispatch.go.

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

