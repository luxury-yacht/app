/*
 * backend/objectcatalog/watch.go
 *
 * Informer-driven incremental catalog updates.
 */

package objectcatalog

import (
	"context"
	"time"

	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

type watchEventType int

const (
	watchEventAdd watchEventType = iota
	watchEventUpdate
	watchEventDelete
)

type watchEvent struct {
	eventType watchEventType
	gvr       string
	key       string
	obj       metav1.Object
}

const (
	watchPendingBufferSize = 8192
	watchDebounceInterval  = 200 * time.Millisecond
)

var watchInformerAccessor = map[schema.GroupResource]func(informers.SharedInformerFactory) cache.SharedIndexInformer{
	{Group: "", Resource: "pods"}:                                          func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Pods().Informer() },
	{Group: "apps", Resource: "deployments"}:                               func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Apps().V1().Deployments().Informer() },
	{Group: "apps", Resource: "statefulsets"}:                              func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Apps().V1().StatefulSets().Informer() },
	{Group: "apps", Resource: "daemonsets"}:                                func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Apps().V1().DaemonSets().Informer() },
	{Group: "apps", Resource: "replicasets"}:                               func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Apps().V1().ReplicaSets().Informer() },
	{Group: "batch", Resource: "jobs"}:                                     func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Batch().V1().Jobs().Informer() },
	{Group: "batch", Resource: "cronjobs"}:                                 func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Batch().V1().CronJobs().Informer() },
	{Group: "", Resource: "services"}:                                      func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Services().Informer() },
	{Group: "discovery.k8s.io", Resource: "endpointslices"}:                func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Discovery().V1().EndpointSlices().Informer() },
	{Group: "", Resource: "configmaps"}:                                    func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().ConfigMaps().Informer() },
	{Group: "", Resource: "secrets"}:                                       func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Secrets().Informer() },
	{Group: "", Resource: "persistentvolumeclaims"}:                        func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().PersistentVolumeClaims().Informer() },
	{Group: "", Resource: "resourcequotas"}:                                func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().ResourceQuotas().Informer() },
	{Group: "", Resource: "limitranges"}:                                   func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().LimitRanges().Informer() },
	{Group: "networking.k8s.io", Resource: "ingresses"}:                    func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Networking().V1().Ingresses().Informer() },
	{Group: "networking.k8s.io", Resource: "networkpolicies"}:              func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Networking().V1().NetworkPolicies().Informer() },
	{Group: "autoscaling", Resource: "horizontalpodautoscalers"}:           func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Autoscaling().V1().HorizontalPodAutoscalers().Informer() },
	{Group: "rbac.authorization.k8s.io", Resource: "clusterroles"}:        func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Rbac().V1().ClusterRoles().Informer() },
	{Group: "rbac.authorization.k8s.io", Resource: "clusterrolebindings"}: func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Rbac().V1().ClusterRoleBindings().Informer() },
	{Group: "rbac.authorization.k8s.io", Resource: "roles"}:               func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Rbac().V1().Roles().Informer() },
	{Group: "rbac.authorization.k8s.io", Resource: "rolebindings"}:        func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Rbac().V1().RoleBindings().Informer() },
	{Group: "", Resource: "namespaces"}:                                    func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Namespaces().Informer() },
	{Group: "", Resource: "nodes"}:                                         func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Nodes().Informer() },
	{Group: "", Resource: "persistentvolumes"}:                             func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().PersistentVolumes().Informer() },
	{Group: "storage.k8s.io", Resource: "storageclasses"}:                 func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Storage().V1().StorageClasses().Informer() },
}

type watchNotifier struct {
	service *Service
	pending chan watchEvent
	ctx     context.Context
}

func newWatchNotifier(ctx context.Context, svc *Service) *watchNotifier {
	return &watchNotifier{
		service: svc,
		pending: make(chan watchEvent, watchPendingBufferSize),
		ctx:     ctx,
	}
}

// flush applies a batch of watch events to the catalog.
func (n *watchNotifier) flush(events []watchEvent) {
	if len(events) == 0 {
		return
	}
	// sync() parallel goroutines write to the aliased s.items/newItems map
	// without holding s.mu. Skip to avoid a concurrent-write race.
	if n.service.syncInProgress.Load() {
		return
	}

	s := n.service
	changed := false

	s.mu.Lock()
	for _, evt := range events {
		desc, ok := s.resources[evt.gvr]
		if !ok {
			continue
		}
		switch evt.eventType {
		case watchEventAdd, watchEventUpdate:
			if evt.obj == nil {
				continue
			}
			s.items[evt.key] = s.buildSummary(desc, evt.obj)
			s.lastSeen[evt.key] = s.now()
			changed = true
		case watchEventDelete:
			if _, exists := s.items[evt.key]; exists {
				delete(s.items, evt.key)
				delete(s.lastSeen, evt.key)
				changed = true
			}
		}
	}
	if !changed {
		s.mu.Unlock()
		return
	}
	itemsCopy := cloneSummaryMap(s.items)
	s.mu.Unlock()

	// Descriptors() acquires s.mu.RLock — must call after Unlock.
	descriptors := s.Descriptors()
	// rebuildCacheFromItems calls publishStreamingState which acquires s.mu.Lock.
	s.rebuildCacheFromItems(itemsCopy, descriptors)
	s.broadcastStreaming(true)
}

// run collects events and flushes in debounced batches.
func (n *watchNotifier) run() {
	var batch []watchEvent
	var timer *time.Timer
	var timerC <-chan time.Time

	for {
		select {
		case <-n.ctx.Done():
			if len(batch) > 0 {
				n.flush(batch)
			}
			if timer != nil {
				timer.Stop()
			}
			return
		case evt, ok := <-n.pending:
			if !ok {
				if len(batch) > 0 {
					n.flush(batch)
				}
				return
			}
			batch = append(batch, evt)
			if timer == nil {
				timer = time.NewTimer(watchDebounceInterval)
				timerC = timer.C
			} else {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(watchDebounceInterval)
			}
		case <-timerC:
			if len(batch) > 0 {
				n.flush(batch)
				batch = nil
			}
			timer = nil
			timerC = nil
		}
	}
}

// send enqueues a watch event. Drops if buffer is full.
func (n *watchNotifier) send(evt watchEvent) {
	select {
	case n.pending <- evt:
	default:
		if n.service.deps.Logger != nil {
			n.service.logWarn("catalog watch notifier buffer full, dropping event")
		}
	}
}

// makeHandler builds an informer event handler for the given GroupResource.
func makeHandler(gr schema.GroupResource, notifier *watchNotifier, svc *Service) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			metaObj, ok := toMetaObject(obj)
			if !ok {
				return
			}
			gvr, desc := svc.resolveGRToDescriptor(gr)
			if desc == nil {
				return
			}
			notifier.send(watchEvent{
				eventType: watchEventAdd,
				gvr:       gvr,
				key:       catalogKey(*desc, metaObj.GetNamespace(), metaObj.GetName()),
				obj:       metaObj,
			})
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			// Skip no-op updates from informer resync.
			if oldMeta, ok := toMetaObject(oldObj); ok {
				if newMeta, ok := toMetaObject(newObj); ok {
					if oldMeta.GetResourceVersion() == newMeta.GetResourceVersion() {
						return
					}
				}
			}
			metaObj, ok := toMetaObject(newObj)
			if !ok {
				return
			}
			gvr, desc := svc.resolveGRToDescriptor(gr)
			if desc == nil {
				return
			}
			notifier.send(watchEvent{
				eventType: watchEventUpdate,
				gvr:       gvr,
				key:       catalogKey(*desc, metaObj.GetNamespace(), metaObj.GetName()),
				obj:       metaObj,
			})
		},
		DeleteFunc: func(obj interface{}) {
			if d, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				obj = d.Obj
			}
			metaObj, ok := toMetaObject(obj)
			if !ok {
				return
			}
			gvr, desc := svc.resolveGRToDescriptor(gr)
			if desc == nil {
				return
			}
			notifier.send(watchEvent{
				eventType: watchEventDelete,
				gvr:       gvr,
				key:       catalogKey(*desc, metaObj.GetNamespace(), metaObj.GetName()),
				obj:       nil,
			})
		},
	}
}

// registerWatchHandlers attaches event handlers to shared informers.
func registerWatchHandlers(
	factory informers.SharedInformerFactory,
	apiextFactory apiextinformers.SharedInformerFactory,
	notifier *watchNotifier,
	svc *Service,
) {
	if factory == nil {
		return
	}
	for gr, accessor := range watchInformerAccessor {
		inf := accessor(factory)
		if inf == nil {
			continue
		}
		inf.AddEventHandler(makeHandler(gr, notifier, svc))
	}
	if apiextFactory != nil {
		crdInformer := apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer()
		gr := schema.GroupResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}
		crdInformer.AddEventHandler(makeHandler(gr, notifier, svc))
	}
}

func (s *Service) resolveGRToDescriptor(gr schema.GroupResource) (string, *resourceDescriptor) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for gvr, desc := range s.resources {
		if desc.Group == gr.Group && desc.Resource == gr.Resource {
			return gvr, &desc
		}
	}
	return "", nil
}

func toMetaObject(obj interface{}) (metav1.Object, bool) {
	if obj == nil {
		return nil, false
	}
	metaObj, ok := obj.(metav1.Object)
	return metaObj, ok
}
