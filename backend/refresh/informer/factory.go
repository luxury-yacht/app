package informer

import (
	"context"
	"fmt"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"

	"golang.org/x/sync/errgroup"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// Factory wraps the shared informer factory used by the refresh subsystem.
type Factory struct {
	kubeClient    kubernetes.Interface
	apiextFactory apiextinformers.SharedInformerFactory
	resync        time.Duration

	once     sync.Once
	factory  informers.SharedInformerFactory
	synced   bool
	syncedMu sync.RWMutex

	syncedFns   []cache.InformerSynced
	syncedFnsMu sync.Mutex

	pendingClusterInformers []clusterInformerRegistration

	// permissionAllowed tracks permission keys that have been allowed at least once.
	permissionAllowed map[string]struct{}
	permissionMu      sync.RWMutex

	runtimePermissions *permissions.Checker
}

const podNodeIndexName = "pods:node"

func podNodeIndexFunc(obj interface{}) ([]string, error) {
	pod, ok := obj.(*corev1.Pod)
	if !ok || pod == nil {
		return nil, nil
	}
	if pod.Spec.NodeName == "" {
		return nil, nil
	}
	return []string{pod.Spec.NodeName}, nil
}

// CanListResource reports whether the current identity can list the supplied resource.
func (f *Factory) CanListResource(group, resource string) (bool, error) {
	if f == nil {
		return false, fmt.Errorf("informer factory not initialised")
	}
	return f.checkResourceVerb(group, resource, "list")
}

// CanWatchResource reports whether the current identity can watch the supplied resource.
func (f *Factory) CanWatchResource(group, resource string) (bool, error) {
	if f == nil {
		return false, fmt.Errorf("informer factory not initialised")
	}
	return f.checkResourceVerb(group, resource, "watch")
}

// CanListWatch reports whether the current identity can both list and watch the resource.
// Returns false if either permission is denied or if checking fails.
func (f *Factory) CanListWatch(group, resource string) bool {
	if f == nil {
		return false
	}
	listAllowed, listErr := f.CanListResource(group, resource)
	if listErr != nil || !listAllowed {
		return false
	}
	watchAllowed, watchErr := f.CanWatchResource(group, resource)
	if watchErr != nil || !watchAllowed {
		return false
	}
	return true
}

// New returns a new informer Factory with the provided resync period.
// The checker is used for all permission (SSAR) checks; it must not be nil.
func New(client kubernetes.Interface, apiextClient apiextensionsclientset.Interface, resync time.Duration, checker *permissions.Checker) *Factory {
	if resync <= 0 {
		resync = config.RefreshResyncInterval
	}
	kubeFactory := informers.NewSharedInformerFactory(client, resync)
	result := &Factory{
		kubeClient:         client,
		resync:             resync,
		factory:            kubeFactory,
		permissionAllowed:  make(map[string]struct{}),
		runtimePermissions: checker,
	}
	result.registerClusterInformer("", "nodes", func() cache.SharedIndexInformer {
		return kubeFactory.Core().V1().Nodes().Informer()
	})
	podInformer := kubeFactory.Core().V1().Pods().Informer()
	if err := podInformer.AddIndexers(cache.Indexers{podNodeIndexName: podNodeIndexFunc}); err != nil {
		klog.V(2).Infof("pods informer: failed to add node index: %v", err)
	}
	result.registerInformer(podInformer)
	result.registerInformer(kubeFactory.Core().V1().ConfigMaps().Informer())
	result.registerInformer(kubeFactory.Core().V1().Secrets().Informer())
	result.registerInformer(kubeFactory.Core().V1().Services().Informer())
	result.registerInformer(kubeFactory.Discovery().V1().EndpointSlices().Informer())
	result.registerClusterInformer("", "namespaces", func() cache.SharedIndexInformer {
		return kubeFactory.Core().V1().Namespaces().Informer()
	})
	result.registerInformer(kubeFactory.Apps().V1().ReplicaSets().Informer())
	result.registerInformer(kubeFactory.Apps().V1().Deployments().Informer())
	result.registerInformer(kubeFactory.Apps().V1().StatefulSets().Informer())
	result.registerInformer(kubeFactory.Apps().V1().DaemonSets().Informer())
	result.registerInformer(kubeFactory.Batch().V1().Jobs().Informer())
	result.registerInformer(kubeFactory.Batch().V1().CronJobs().Informer())
	result.registerClusterInformer("rbac.authorization.k8s.io", "clusterroles", func() cache.SharedIndexInformer {
		return kubeFactory.Rbac().V1().ClusterRoles().Informer()
	})
	result.registerClusterInformer("rbac.authorization.k8s.io", "clusterrolebindings", func() cache.SharedIndexInformer {
		return kubeFactory.Rbac().V1().ClusterRoleBindings().Informer()
	})
	result.registerClusterInformer("rbac.authorization.k8s.io", "roles", func() cache.SharedIndexInformer {
		return kubeFactory.Rbac().V1().Roles().Informer()
	})
	result.registerClusterInformer("rbac.authorization.k8s.io", "rolebindings", func() cache.SharedIndexInformer {
		return kubeFactory.Rbac().V1().RoleBindings().Informer()
	})
	result.registerInformer(kubeFactory.Core().V1().ServiceAccounts().Informer())
	result.registerClusterInformer("", "persistentvolumes", func() cache.SharedIndexInformer {
		return kubeFactory.Core().V1().PersistentVolumes().Informer()
	})
	result.registerInformer(kubeFactory.Core().V1().PersistentVolumeClaims().Informer())
	result.registerInformer(kubeFactory.Core().V1().ResourceQuotas().Informer())
	result.registerInformer(kubeFactory.Core().V1().LimitRanges().Informer())
	result.registerClusterInformer("storage.k8s.io", "storageclasses", func() cache.SharedIndexInformer {
		return kubeFactory.Storage().V1().StorageClasses().Informer()
	})
	result.registerClusterInformer("networking.k8s.io", "ingressclasses", func() cache.SharedIndexInformer {
		return kubeFactory.Networking().V1().IngressClasses().Informer()
	})
	result.registerInformer(kubeFactory.Networking().V1().Ingresses().Informer())
	result.registerInformer(kubeFactory.Networking().V1().NetworkPolicies().Informer())
	result.registerInformer(kubeFactory.Autoscaling().V1().HorizontalPodAutoscalers().Informer())
	// Keep PDBs in sync for the namespace quotas refresh domain.
	result.registerInformer(kubeFactory.Policy().V1().PodDisruptionBudgets().Informer())
	result.registerClusterInformer("admissionregistration.k8s.io", "validatingwebhookconfigurations", func() cache.SharedIndexInformer {
		return kubeFactory.Admissionregistration().V1().ValidatingWebhookConfigurations().Informer()
	})
	result.registerClusterInformer("admissionregistration.k8s.io", "mutatingwebhookconfigurations", func() cache.SharedIndexInformer {
		return kubeFactory.Admissionregistration().V1().MutatingWebhookConfigurations().Informer()
	})
	result.registerInformer(kubeFactory.Core().V1().Events().Informer())

	if apiextClient != nil {
		result.apiextFactory = apiextinformers.NewSharedInformerFactory(apiextClient, resync)
		result.registerClusterInformer("apiextensions.k8s.io", "customresourcedefinitions", func() cache.SharedIndexInformer {
			return result.apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer()
		})
	}

	result.processPendingClusterInformers()

	return result
}

// Start initialises informers for core resources and waits for their caches to sync.
func (f *Factory) Start(ctx context.Context) error {
	var startErr error
	f.once.Do(func() {
		go f.factory.Start(ctx.Done())
		if f.apiextFactory != nil {
			go f.apiextFactory.Start(ctx.Done())
		}

		synced := cache.WaitForCacheSync(ctx.Done(), f.syncedFns...)
		f.syncedMu.Lock()
		f.synced = synced
		f.syncedMu.Unlock()
		if !synced {
			startErr = context.Canceled
		}
	})
	return startErr
}

// SharedInformerFactory exposes the underlying factory once started.
func (f *Factory) SharedInformerFactory() informers.SharedInformerFactory {
	return f.factory
}

// APIExtensionsInformerFactory exposes the apiextensions informer factory when available.
func (f *Factory) APIExtensionsInformerFactory() apiextinformers.SharedInformerFactory {
	return f.apiextFactory
}

// HasSynced reports cache sync status.
func (f *Factory) HasSynced(ctx context.Context) bool {
	f.syncedMu.RLock()
	defer f.syncedMu.RUnlock()
	return f.synced
}

// Shutdown clears factory references to allow garbage collection.
// The informers themselves stop via context cancellation, but clearing
// references ensures memory is reclaimed during transport rebuilds.
func (f *Factory) Shutdown() error {
	f.syncedMu.Lock()
	f.synced = false
	f.syncedMu.Unlock()

	f.syncedFnsMu.Lock()
	f.syncedFns = nil
	f.syncedFnsMu.Unlock()

	f.permissionMu.Lock()
	f.permissionAllowed = nil
	f.permissionMu.Unlock()

	// Clear factory references to allow GC
	f.factory = nil
	f.apiextFactory = nil
	f.pendingClusterInformers = nil

	return nil
}

func (f *Factory) registerInformer(inf cache.SharedIndexInformer) {
	if inf == nil {
		return
	}
	f.syncedFnsMu.Lock()
	f.syncedFns = append(f.syncedFns, inf.HasSynced)
	f.syncedFnsMu.Unlock()
}

type informerFactoryFunc func() cache.SharedIndexInformer

type clusterInformerRegistration struct {
	group    string
	resource string
	factory  informerFactoryFunc
}

type PermissionRequest struct {
	Group    string
	Resource string
	Verb     string
}

func (f *Factory) registerClusterInformer(group, resource string, factory informerFactoryFunc) {
	if f.kubeClient == nil || factory == nil {
		return
	}
	f.pendingClusterInformers = append(f.pendingClusterInformers, clusterInformerRegistration{
		group:    group,
		resource: resource,
		factory:  factory,
	})
}

func (f *Factory) processPendingClusterInformers() {
	if len(f.pendingClusterInformers) == 0 {
		return
	}

	requestsMap := make(map[string]PermissionRequest, len(f.pendingClusterInformers)*2)
	for _, pending := range f.pendingClusterInformers {
		if pending.group == "" && pending.resource == "" {
			continue
		}
		keyList := fmt.Sprintf("list:%s/%s", pending.group, pending.resource)
		requestsMap[keyList] = PermissionRequest{Group: pending.group, Resource: pending.resource, Verb: "list"}
		keyWatch := fmt.Sprintf("watch:%s/%s", pending.group, pending.resource)
		requestsMap[keyWatch] = PermissionRequest{Group: pending.group, Resource: pending.resource, Verb: "watch"}
	}

	if len(requestsMap) > 0 {
		requests := make([]PermissionRequest, 0, len(requestsMap))
		for _, req := range requestsMap {
			requests = append(requests, req)
		}
		ctx, cancel := context.WithTimeout(context.Background(), config.PermissionPrimeTimeout)
		_ = f.PrimePermissions(ctx, requests)
		cancel()
	}

	for _, pending := range f.pendingClusterInformers {
		listAllowed, listErr := f.CanListResource(pending.group, pending.resource)
		watchAllowed, watchErr := f.CanWatchResource(pending.group, pending.resource)
		if listErr != nil || watchErr != nil {
			klog.V(2).Infof("Skipping informer for %s/%s due to access check error: %v %v", pending.group, pending.resource, listErr, watchErr)
			continue
		}
		if !listAllowed || !watchAllowed {
			klog.V(2).Infof("Skipping informer for %s/%s due to insufficient permissions", pending.group, pending.resource)
			continue
		}
		f.registerInformer(pending.factory())
	}

	f.pendingClusterInformers = nil
}

func (f *Factory) checkResourceVerb(group, resource, verb string) (bool, error) {
	if f.runtimePermissions == nil {
		return false, fmt.Errorf("permission checker not configured")
	}

	key := fmt.Sprintf("%s/%s/%s", group, resource, verb)
	decision, err := f.runtimePermissions.Can(context.Background(), group, resource, verb)
	if err != nil {
		return false, err
	}
	if decision.Allowed {
		f.trackAllowedPermission(key)
	}
	return decision.Allowed, nil
}

// trackAllowedPermission records that a permission key has been granted at least once.
func (f *Factory) trackAllowedPermission(key string) {
	if f == nil {
		return
	}
	f.permissionMu.Lock()
	if f.permissionAllowed != nil {
		f.permissionAllowed[key] = struct{}{}
	}
	f.permissionMu.Unlock()
}

func (f *Factory) PrimePermissions(ctx context.Context, requests []PermissionRequest) error {
	if len(requests) == 0 {
		return nil
	}
	unique := make(map[string]PermissionRequest, len(requests))
	for _, req := range requests {
		key := fmt.Sprintf("%s/%s/%s", req.Group, req.Resource, req.Verb)
		unique[key] = req
	}

	g, _ := errgroup.WithContext(ctx)
	g.SetLimit(16)
	for _, req := range unique {
		req := req
		g.Go(func() error {
			_, err := f.checkResourceVerb(req.Group, req.Resource, req.Verb)
			return err
		})
	}
	return g.Wait()
}

// PermissionAllowedSnapshot returns keys that have been allowed at least once.
func (f *Factory) PermissionAllowedSnapshot() []string {
	if f == nil {
		return nil
	}
	f.permissionMu.RLock()
	defer f.permissionMu.RUnlock()
	if len(f.permissionAllowed) == 0 {
		return nil
	}
	keys := make([]string, 0, len(f.permissionAllowed))
	for key := range f.permissionAllowed {
		keys = append(keys, key)
	}
	return keys
}
