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

	permissionCache map[string]bool
	permissionMu    sync.RWMutex
	permissionGroup singleflight.Group

	permissionAudit       *permissions.Checker
	permissionAuditLogger logstream.Logger
	permissionAuditMu     sync.Mutex
	permissionAuditLogged map[string]bool
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

// ConfigurePermissionAudit enables runtime SSAR audit logging without changing decisions.
func (f *Factory) ConfigurePermissionAudit(checker *permissions.Checker, logger logstream.Logger) {
	if f == nil {
		return
	}
	f.permissionAudit = checker
	f.permissionAuditLogger = logger
	if f.permissionAuditLogged == nil {
		f.permissionAuditLogged = make(map[string]bool)
	}
}

// New returns a new informer Factory with the provided resync period.
func New(client kubernetes.Interface, apiextClient apiextensionsclientset.Interface, resync time.Duration, permissionCache map[string]bool) *Factory {
	if resync <= 0 {
		resync = config.RefreshResyncInterval
	}
	kubeFactory := informers.NewSharedInformerFactory(client, resync)
	result := &Factory{
		kubeClient:      client,
		resync:          resync,
		factory:         kubeFactory,
		permissionCache: make(map[string]bool),
	}
	if len(permissionCache) > 0 {
		for k, v := range permissionCache {
			result.permissionCache[k] = v
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
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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

	f.permissionMu.RLock()
	if allowed, ok := f.permissionCache[key]; ok {
		f.permissionMu.RUnlock()
		f.auditPermission(group, resource, verb, allowed, nil)
		return allowed, nil
	}
	f.permissionMu.RUnlock()

	value, err, _ := f.permissionGroup.Do(key, func() (interface{}, error) {
		f.permissionMu.RLock()
		if allowed, ok := f.permissionCache[key]; ok {
			f.permissionMu.RUnlock()
			return allowed, nil
		}
		f.permissionMu.RUnlock()

		review := &authorizationv1.SelfSubjectAccessReview{
			Spec: authorizationv1.SelfSubjectAccessReviewSpec{
				ResourceAttributes: &authorizationv1.ResourceAttributes{
					Group:    group,
					Resource: resource,
					Verb:     verb,
				},
			},
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		resp, err := f.kubeClient.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, review, metav1.CreateOptions{})
		if err != nil {
			klog.V(2).Infof("SelfSubjectAccessReview failed for %s/%s verb %s: %v", group, resource, verb, err)
			return nil, err
		}

		allowed := resp.Status.Allowed
		f.permissionMu.Lock()
		f.permissionCache[key] = allowed
		f.permissionMu.Unlock()
		return allowed, nil
	})
	if err != nil {
		return false, err
	}

	allowed, _ := value.(bool)
	f.auditPermission(group, resource, verb, allowed, nil)
	return allowed, nil
}

func (f *Factory) auditPermission(group, resource, verb string, cachedAllowed bool, cachedErr error) {
	if f == nil || f.permissionAudit == nil || cachedErr != nil {
		return
	}

	decision, err := f.permissionAudit.Can(context.Background(), group, resource, verb)
	if err != nil {
		return
	}

	if decision.Allowed == cachedAllowed {
		return
	}

	key := fmt.Sprintf("%s/%s/%s", group, resource, verb)
	f.permissionAuditMu.Lock()
	if f.permissionAuditLogged[key] {
		f.permissionAuditMu.Unlock()
		return
	}
	f.permissionAuditLogged[key] = true
	f.permissionAuditMu.Unlock()

	message := fmt.Sprintf(
		"permission mismatch for %s/%s verb %s (cached=%t runtime=%t source=%s)",
		group,
		resource,
		verb,
		cachedAllowed,
		decision.Allowed,
		decision.Source,
	)
	if f.permissionAuditLogger != nil {
		f.permissionAuditLogger.Warn(message, "Permissions")
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
	f.permissionMu.RLock()
	defer f.permissionMu.RUnlock()

	if len(f.permissionCache) == 0 {
		return nil
	}

	snapshot := make(map[string]bool, len(f.permissionCache))
	for k, v := range f.permissionCache {
		snapshot[k] = v
	}
	return snapshot
}
