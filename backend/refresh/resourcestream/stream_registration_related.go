package resourcestream

import "github.com/luxury-yacht/app/backend/refresh/informer"

// This file registers resources whose streamed output depends on related
// objects or cached lookup state. These registrations intentionally keep the
// required listers and indexers visible next to the informer event handlers.

func (m *Manager) registerPodStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("", "pods") {
		podInformer := shared.Core().V1().Pods()
		m.podLister = podInformer.Lister()
		m.podIndexer = podInformer.Informer().GetIndexer()
		m.addResourceEventHandler(podInformer.Informer(), (*Manager).handlePod)
	}
}

func (m *Manager) registerNodeStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("", "nodes") {
		nodeInformer := shared.Core().V1().Nodes()
		m.nodeLister = nodeInformer.Lister()
		m.addResourceEventHandler(nodeInformer.Informer(), (*Manager).handleNode)
	}
}

func (m *Manager) registerWorkloadStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("apps", "replicasets") {
		rsInformer := shared.Apps().V1().ReplicaSets()
		m.rsLister = rsInformer.Lister()
	}
	if m.canListWatch("apps", "deployments") {
		deploymentInformer := shared.Apps().V1().Deployments()
		m.deploymentLister = deploymentInformer.Lister()
		m.addResourceEventHandler(deploymentInformer.Informer(), (*Manager).handleWorkload)
	}
	if m.canListWatch("apps", "statefulsets") {
		statefulInformer := shared.Apps().V1().StatefulSets()
		m.statefulLister = statefulInformer.Lister()
		m.addResourceEventHandler(statefulInformer.Informer(), (*Manager).handleWorkload)
	}
	if m.canListWatch("apps", "daemonsets") {
		daemonInformer := shared.Apps().V1().DaemonSets()
		m.daemonLister = daemonInformer.Lister()
		m.addResourceEventHandler(daemonInformer.Informer(), (*Manager).handleWorkload)
	}
	if m.canListWatch("batch", "jobs") {
		jobInformer := shared.Batch().V1().Jobs()
		m.jobLister = jobInformer.Lister()
		m.addResourceEventHandler(jobInformer.Informer(), (*Manager).handleWorkload)
	}
	if m.canListWatch("batch", "cronjobs") {
		cronInformer := shared.Batch().V1().CronJobs()
		m.cronJobLister = cronInformer.Lister()
		m.addResourceEventHandler(cronInformer.Informer(), (*Manager).handleWorkload)
	}
}
