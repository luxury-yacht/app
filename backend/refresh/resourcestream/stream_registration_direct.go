package resourcestream

import (
	"github.com/luxury-yacht/app/backend/refresh/informer"
)

// This file registers the direct object-to-stream resources that still need a
// custom handler (related-object invalidation or a non-shared informer factory).
// Every plain object→row kind is registered from the descriptor registry via
// registerDescriptorStreams; see stream_descriptor_dispatch.go.

// registerHelmStorageStreams wires the Helm-release refresh signal off the dedicated
// label-filtered (owner=helm) helm-storage informers — NOT the shared configmap/secret
// informers, which the cutover removed (ConfigMap/Secret are owned-reflector ingest
// kinds). The helm-storage informers hold the full typed release objects the
// old-vs-new release-key compare needs. The namespace-config table's live notify is
// driven separately by the generic ingest notify sink (registerIngestNotifyStreams);
// these handlers carry only the helm side-effect, so the two never double-fire.
func (m *Manager) registerHelmStorageStreams(factory *informer.Factory) {
	helm := factory.HelmStorage()
	if helm == nil {
		return
	}
	if inf := helm.ConfigMapInformer(); inf != nil {
		m.addRelatedResourceEventHandler(inf, (*Manager).handleConfigMapEvent)
	}
	if inf := helm.SecretInformer(); inf != nil {
		m.addRelatedResourceEventHandler(inf, (*Manager).handleSecretEvent)
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
