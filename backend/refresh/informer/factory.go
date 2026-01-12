package informer

import (
	"context"
	"fmt"
	"sync"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"

	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/singleflight"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
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

	// permissionCache stores legacy SSAR results for fallback when runtime checks fail.
	// Entries expire to avoid holding stale authorization decisions indefinitely.
	permissionCache map[string]permissionCacheEntry
	// permissionAllowed tracks permission keys that have been allowed at least once.
	permissionAllowed  map[string]struct{}
	permissionCacheTTL time.Duration
	permissionNow      func() time.Time
	permissionMu       sync.RWMutex
	permissionGroup    singleflight.Group

	runtimePermissions *permissions.Checker
	runtimeLogger      logstream.Logger
}

type permissionCacheEntry struct {
	allowed   bool
	expiresAt time.Time
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

// ConfigureRuntimePermissions sets the runtime permission checker used for gating.
func (f *Factory) ConfigureRuntimePermissions(checker *permissions.Checker, logger logstream.Logger) {
	if f == nil {
		return
	}
	f.runtimePermissions = checker
	f.runtimeLogger = logger
}

// New returns a new informer Factory with the provided resync period.
func New(client kubernetes.Interface, apiextClient apiextensionsclientset.Interface, resync time.Duration, permissionCache map[string]bool) *Factory {
	if resync <= 0 {
		resync = config.RefreshResyncInterval
	}
	kubeFactory := informers.NewSharedInformerFactory(client, resync)
	result := &Factory{
		kubeClient:         client,
		resync:             resync,
		factory:            kubeFactory,
		permissionCache:    make(map[string]permissionCacheEntry),
		permissionAllowed:  make(map[string]struct{}),
		permissionCacheTTL: config.PermissionCacheTTL,
		permissionNow:      time.Now,
	}
	if len(permissionCache) > 0 {
		for k, v := range permissionCache {
			result.storeLegacyPermission(k, v)
		}
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
	f.permissionCache = nil
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
	if f.kubeClient == nil {
		return false, fmt.Errorf("kubernetes client not initialised")
	}

	key := fmt.Sprintf("%s/%s/%s", group, resource, verb)

	if f.runtimePermissions != nil {
		decision, err := f.runtimePermissions.Can(context.Background(), group, resource, verb)
		if err == nil {
			f.storeLegacyPermission(key, decision.Allowed)
			return decision.Allowed, nil
		}
		if allowed, ok := f.readLegacyPermission(key); ok {
			f.logRuntimeFallback(group, resource, verb, err)
			return allowed, nil
		}
		return false, err
	}

	if allowed, ok := f.readLegacyPermission(key); ok {
		return allowed, nil
	}

	value, err, _ := f.permissionGroup.Do(key, func() (interface{}, error) {
		if allowed, ok := f.readLegacyPermission(key); ok {
			return allowed, nil
		}

		review := &authorizationv1.SelfSubjectAccessReview{
			Spec: authorizationv1.SelfSubjectAccessReviewSpec{
				ResourceAttributes: &authorizationv1.ResourceAttributes{
					Group:    group,
					Resource: resource,
					Verb:     verb,
				},
			},
		}

		ctx, cancel := context.WithTimeout(context.Background(), config.PermissionCheckTimeout)
		defer cancel()

		resp, err := f.kubeClient.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, review, metav1.CreateOptions{})
		if err != nil {
			klog.V(2).Infof("SelfSubjectAccessReview failed for %s/%s verb %s: %v", group, resource, verb, err)
			return nil, err
		}

		allowed := resp.Status.Allowed
		f.storeLegacyPermission(key, allowed)
		return allowed, nil
	})
	if err != nil {
		return false, err
	}

	allowed, _ := value.(bool)
	return allowed, nil
}

func (f *Factory) readLegacyPermission(key string) (bool, bool) {
	if f == nil {
		return false, false
	}
	now := f.permissionCacheNow()
	f.permissionMu.RLock()
	entry, ok := f.permissionCache[key]
	f.permissionMu.RUnlock()
	if !ok {
		return false, false
	}
	if !entry.expiresAt.IsZero() && now.After(entry.expiresAt) {
		// Drop expired entries so fallback does not reuse stale decisions.
		f.permissionMu.Lock()
		entry, ok = f.permissionCache[key]
		if ok && !entry.expiresAt.IsZero() && now.After(entry.expiresAt) {
			delete(f.permissionCache, key)
		}
		f.permissionMu.Unlock()
		return false, false
	}
	return entry.allowed, true
}

func (f *Factory) storeLegacyPermission(key string, allowed bool) {
	if f == nil {
		return
	}
	ttl := f.permissionCacheTTLValue()
	if ttl <= 0 {
		return
	}
	entry := permissionCacheEntry{
		allowed:   allowed,
		expiresAt: f.permissionCacheNow().Add(ttl),
	}
	f.permissionMu.Lock()
	if f.permissionCache != nil {
		f.permissionCache[key] = entry
	}
	if allowed && f.permissionAllowed != nil {
		f.permissionAllowed[key] = struct{}{}
	}
	f.permissionMu.Unlock()
}

func (f *Factory) logRuntimeFallback(group, resource, verb string, err error) {
	if err == nil {
		return
	}
	message := fmt.Sprintf(
		"permission fallback for %s/%s verb %s due to runtime error: %v",
		group,
		resource,
		verb,
		err,
	)
	if f.runtimeLogger != nil {
		f.runtimeLogger.Warn(message, "Permissions")
	} else {
		klog.V(1).Info(message)
	}
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

func (f *Factory) PermissionCacheSnapshot() map[string]bool {
	if f == nil {
		return nil
	}
	now := f.permissionCacheNow()
	f.permissionMu.Lock()
	defer f.permissionMu.Unlock()

	if len(f.permissionCache) == 0 {
		return nil
	}

	snapshot := make(map[string]bool, len(f.permissionCache))
	for k, entry := range f.permissionCache {
		if !entry.expiresAt.IsZero() && now.After(entry.expiresAt) {
			delete(f.permissionCache, k)
			continue
		}
		snapshot[k] = entry.allowed
	}
	if len(snapshot) == 0 {
		return nil
	}
	return snapshot
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

func (f *Factory) permissionCacheNow() time.Time {
	if f != nil && f.permissionNow != nil {
		return f.permissionNow()
	}
	return time.Now()
}

func (f *Factory) permissionCacheTTLValue() time.Duration {
	if f != nil && f.permissionCacheTTL > 0 {
		return f.permissionCacheTTL
	}
	return config.PermissionCacheTTL
}
