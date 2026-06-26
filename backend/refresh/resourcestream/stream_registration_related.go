package resourcestream

import (
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// This file registers resources whose streamed output depends on related
// objects or cached lookup state. These registrations intentionally keep the
// required listers and indexers visible next to the informer event handlers.

// registerPodStreams wires the pod live-stream change signal. Pods is an owned-reflector
// ingest kind (IngestOwned): the typed pod informer is never instantiated, so the signal
// comes from the pod reflector's whole-Bundle Sink instead of a shared-informer event
// handler. The bundle carries the projected PodSummary (Table half — the Node/owner the
// broadcast scopes need) and the catalog Summary (Catalog half — the UID/resourceVersion
// the change Ref needs), so the emitted notify is identical to the typed-pod handler's.
// When no ingest manager is wired (a unit test), the pod stream has no live signal; tests
// drive handlePod/handlePodEvent directly.
func (m *Manager) registerPodStreams(factory *informer.Factory, ingestManager *ingest.IngestManager) {
	if factory.SharedInformerFactory() == nil || ingestManager == nil {
		return
	}
	if m.canListWatch("", "pods") {
		ingestManager.AddBundleSink(podGVR, podNotifyBundleSink{manager: m})
	}
}

// registerNodeStreams wires the node live-stream change signal. Nodes is an owned-reflector
// ingest kind (IngestOwned): the typed node informer is never instantiated, so the signal-only
// signal comes from the ingest reflector's Catalog-half Sink (registerNodeIngestNotify) instead
// of a shared-informer event handler — identical to the pod/workload/network path. When no
// ingest manager is wired (a unit test), the node stream has no live signal; tests drive
// handleNode directly with a wired typed lister.
func (m *Manager) registerNodeStreams(factory *informer.Factory, ingestManager *ingest.IngestManager) {
	if factory.SharedInformerFactory() == nil {
		return
	}
	m.registerNodeIngestNotify(ingestManager)
}

// registerWorkloadStreams wires the workload kinds' change signal. The five workload kinds
// (Deployment/StatefulSet/DaemonSet/Job/CronJob) are owned-reflector ingest kinds: the typed
// informers are never instantiated, so their signal-only signal comes from the ingest
// reflector's Catalog-half Sink (registerWorkloadIngestNotify) instead of a shared-informer
// event handler — identical to the pod path. ReplicaSet is NOT cut: its typed informer stays
// registered, and its event handler keeps re-broadcasting affected pods, because the pod
// projector + cluster-overview resolve pod owners through the RS lister. When no ingest
// manager is wired (a unit test), the workload streams have no live signal; tests drive
// handleWorkload / the HPA paths directly with a wired typed lister.
func (m *Manager) registerWorkloadStreams(factory *informer.Factory, ingestManager *ingest.IngestManager) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("apps", "replicasets") {
		rsInformer := shared.Apps().V1().ReplicaSets()
		m.rsLister = rsInformer.Lister()
		m.addRelatedResourceEventHandler(rsInformer.Informer(), (*Manager).handleReplicaSetEvent)
	}
	m.registerWorkloadIngestNotify(ingestManager)
}
