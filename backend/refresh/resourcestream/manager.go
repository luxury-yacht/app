package resourcestream

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynamicinformer "k8s.io/client-go/dynamic/dynamicinformer"
	appslisters "k8s.io/client-go/listers/apps/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	discoverylisters "k8s.io/client-go/listers/discovery/v1"
	networklisters "k8s.io/client-go/listers/networking/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const podNodeIndexName = "pods:node"

const (
	domainPods                 = "pods"
	domainWorkloads            = "namespace-workloads"
	domainNamespaceConfig      = "namespace-config"
	domainNamespaceNetwork     = "namespace-network"
	domainNamespaceRBAC        = "namespace-rbac"
	domainNamespaceCustom      = "namespace-custom"
	domainNamespaceHelm        = "namespace-helm"
	domainNamespaceAutoscaling = "namespace-autoscaling"
	domainNamespaceQuotas      = "namespace-quotas"
	domainNamespaceStorage     = "namespace-storage"
	// Cluster-scoped domains stream resources without namespace scopes.
	domainClusterRBAC    = "cluster-rbac"
	domainClusterStorage = "cluster-storage"
	domainClusterConfig  = "cluster-config"
	domainClusterCRDs    = "cluster-crds"
	domainClusterCustom  = "cluster-custom"
	domainNodes          = "nodes"
)

const (
	helmReleaseSecretType = "helm.sh/release.v1"
	helmReleaseNamePrefix = "sh.helm.release.v1."
	helmReleaseOwnerLabel = "owner"
	helmReleaseOwnerValue = "helm"
)

type subscription struct {
	ch      chan Update
	drops   chan DropReason
	created time.Time
	once    sync.Once
	// resyncing is set when backpressure triggers a RESET for this subscriber.
	resyncing uint32
}

// bufferedUpdate tags an update with a sequence for resume tokens.
type bufferedUpdate struct {
	sequence uint64
	update   Update
}

// updateBuffer stores a fixed-size ring of updates for stream resumption.
type updateBuffer struct {
	items []bufferedUpdate
	start int
	count int
	max   int
}

// newUpdateBuffer allocates a resume buffer capped at the requested size.
func newUpdateBuffer(max int) *updateBuffer {
	return &updateBuffer{
		items: make([]bufferedUpdate, max),
		max:   max,
	}
}

// add inserts an update, evicting the oldest when the buffer is full.
func (b *updateBuffer) add(update bufferedUpdate) {
	if b.max == 0 {
		return
	}
	if b.count < b.max {
		index := (b.start + b.count) % b.max
		b.items[index] = update
		b.count++
		return
	}
	b.items[b.start] = update
	b.start = (b.start + 1) % b.max
}

// since returns updates newer than the provided sequence, or false if too old.
func (b *updateBuffer) since(sequence uint64) ([]bufferedUpdate, bool) {
	if b.count == 0 {
		return nil, false
	}
	oldest := b.items[b.start].sequence
	latestIndex := (b.start + b.count - 1) % b.max
	latest := b.items[latestIndex].sequence
	if sequence < oldest {
		return nil, false
	}
	if sequence >= latest {
		return []bufferedUpdate{}, true
	}
	updates := make([]bufferedUpdate, 0, b.count)
	for i := 0; i < b.count; i++ {
		index := (b.start + i) % b.max
		item := b.items[index]
		if item.sequence > sequence {
			updates = append(updates, item)
		}
	}
	return updates, true
}

func (s *subscription) close(reason DropReason) {
	if s == nil {
		return
	}
	s.once.Do(func() {
		if reason != "" {
			select {
			case s.drops <- reason:
			default:
			}
		}
		close(s.drops)
		close(s.ch)
	})
}

func (s *subscription) isResyncing() bool {
	return s != nil && atomic.LoadUint32(&s.resyncing) == 1
}

func (s *subscription) markResyncing() bool {
	if s == nil {
		return false
	}
	return atomic.CompareAndSwapUint32(&s.resyncing, 0, 1)
}

type customResourceInformer struct {
	gvr      schema.GroupVersionResource
	kind     string
	domain   string
	informer cache.SharedIndexInformer
	stopCh   chan struct{}
	stopOnce sync.Once
}

func (c *customResourceInformer) stop() {
	if c == nil {
		return
	}
	c.stopOnce.Do(func() {
		close(c.stopCh)
	})
}

// Manager fan-outs informer updates to websocket subscribers.
type Manager struct {
	clusterMeta snapshot.ClusterMeta
	metrics     metrics.Provider
	logger      logstream.Logger
	telemetry   *telemetry.Recorder
	permissions permissions.ListWatchChecker

	dynamicClient dynamic.Interface

	podLister        corelisters.PodLister
	podIndexer       cache.Indexer
	nodeLister       corelisters.NodeLister
	serviceLister    corelisters.ServiceLister
	sliceLister      discoverylisters.EndpointSliceLister
	rsLister         appslisters.ReplicaSetLister
	deploymentLister appslisters.DeploymentLister
	statefulLister   appslisters.StatefulSetLister
	daemonLister     appslisters.DaemonSetLister
	jobLister        batchlisters.JobLister
	cronJobLister    batchlisters.CronJobLister
	ingressLister    networklisters.IngressLister
	policyLister     networklisters.NetworkPolicyLister

	customInformerMu sync.Mutex
	customInformers  map[string]*customResourceInformer
	// customInvalidator evicts cached YAML/details when custom resources change.
	customInvalidatorMu sync.RWMutex
	customInvalidator   func(kind, namespace, name string)

	mu          sync.RWMutex
	subscribers map[string]map[string]map[uint64]*subscription
	nextID      uint64
	buffers     map[string]*updateBuffer
	sequences   map[string]uint64
}

// NewManager wires informer handlers into a resource stream manager.
func NewManager(
	factory *informer.Factory,
	provider metrics.Provider,
	logger logstream.Logger,
	recorder *telemetry.Recorder,
	meta snapshot.ClusterMeta,
	dynamicClient dynamic.Interface,
) *Manager {
	if logger == nil {
		logger = noopLogger{}
	}
	mgr := &Manager{
		clusterMeta:     meta,
		metrics:         provider,
		logger:          logger,
		telemetry:       recorder,
		permissions:     factory,
		dynamicClient:   dynamicClient,
		customInformers: make(map[string]*customResourceInformer),
		subscribers:     make(map[string]map[string]map[uint64]*subscription),
		buffers:         make(map[string]*updateBuffer),
		sequences:       make(map[string]uint64),
	}

	if factory == nil {
		return mgr
	}

	shared := factory.SharedInformerFactory()
	if shared == nil {
		return mgr
	}

	// All informers watch at cluster scope, so every resource needs a permission check
	// to prevent lazy informer creation for resources the user cannot list/watch cluster-wide.
	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "pods") {
		podInformer := shared.Core().V1().Pods()
		mgr.podLister = podInformer.Lister()
		mgr.podIndexer = podInformer.Informer().GetIndexer()
		podInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handlePod(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handlePod(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handlePod(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "configmaps") {
		configMapInformer := shared.Core().V1().ConfigMaps()
		configMapInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleConfigMap(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleConfigMap(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleConfigMap(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "secrets") {
		secretInformer := shared.Core().V1().Secrets()
		secretInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleSecret(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleSecret(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleSecret(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "services") {
		serviceInformer := shared.Core().V1().Services()
		mgr.serviceLister = serviceInformer.Lister()
		serviceInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleService(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleService(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleService(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("discovery.k8s.io", "endpointslices") {
		sliceInformer := shared.Discovery().V1().EndpointSlices()
		mgr.sliceLister = sliceInformer.Lister()
		sliceInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleEndpointSlice(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleEndpointSlice(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleEndpointSlice(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("networking.k8s.io", "ingresses") {
		ingressInformer := shared.Networking().V1().Ingresses()
		mgr.ingressLister = ingressInformer.Lister()
		ingressInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleIngress(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleIngress(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleIngress(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("networking.k8s.io", "networkpolicies") {
		policyInformer := shared.Networking().V1().NetworkPolicies()
		mgr.policyLister = policyInformer.Lister()
		policyInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleNetworkPolicy(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleNetworkPolicy(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleNetworkPolicy(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "persistentvolumeclaims") {
		pvcInformer := shared.Core().V1().PersistentVolumeClaims()
		pvcInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handlePersistentVolumeClaim(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handlePersistentVolumeClaim(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handlePersistentVolumeClaim(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("autoscaling", "horizontalpodautoscalers") {
		hpaInformer := shared.Autoscaling().V1().HorizontalPodAutoscalers()
		hpaInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleHPA(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleHPA(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleHPA(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "nodes") {
		nodeInformer := shared.Core().V1().Nodes()
		mgr.nodeLister = nodeInformer.Lister()
		nodeInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleNode(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleNode(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleNode(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("apps", "replicasets") {
		rsInformer := shared.Apps().V1().ReplicaSets()
		mgr.rsLister = rsInformer.Lister()
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("apps", "deployments") {
		deploymentInformer := shared.Apps().V1().Deployments()
		mgr.deploymentLister = deploymentInformer.Lister()
		deploymentInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("apps", "statefulsets") {
		statefulInformer := shared.Apps().V1().StatefulSets()
		mgr.statefulLister = statefulInformer.Lister()
		statefulInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("apps", "daemonsets") {
		daemonInformer := shared.Apps().V1().DaemonSets()
		mgr.daemonLister = daemonInformer.Lister()
		daemonInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("batch", "jobs") {
		jobInformer := shared.Batch().V1().Jobs()
		mgr.jobLister = jobInformer.Lister()
		jobInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("batch", "cronjobs") {
		cronInformer := shared.Batch().V1().CronJobs()
		mgr.cronJobLister = cronInformer.Lister()
		cronInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("rbac.authorization.k8s.io", "roles") {
		roleInformer := shared.Rbac().V1().Roles()
		roleInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleRole(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleRole(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleRole(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("rbac.authorization.k8s.io", "rolebindings") {
		bindingInformer := shared.Rbac().V1().RoleBindings()
		bindingInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleRoleBinding(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleRoleBinding(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleRoleBinding(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "serviceaccounts") {
		serviceAccountInformer := shared.Core().V1().ServiceAccounts()
		serviceAccountInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleServiceAccount(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleServiceAccount(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleServiceAccount(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "resourcequotas") {
		resourceQuotaInformer := shared.Core().V1().ResourceQuotas()
		resourceQuotaInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleResourceQuota(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleResourceQuota(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleResourceQuota(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "limitranges") {
		limitRangeInformer := shared.Core().V1().LimitRanges()
		limitRangeInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleLimitRange(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleLimitRange(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleLimitRange(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("policy", "poddisruptionbudgets") {
		pdbInformer := shared.Policy().V1().PodDisruptionBudgets()
		pdbInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handlePodDisruptionBudget(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handlePodDisruptionBudget(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handlePodDisruptionBudget(obj, MessageTypeDeleted) },
		})
	}

	// Cluster-scoped informers drive the cluster tab streaming domains.
	// Each is gated on permissions to avoid triggering forbidden list/watch errors.
	if mgr.permissions == nil || mgr.permissions.CanListWatch("rbac.authorization.k8s.io", "clusterroles") {
		clusterRoleInformer := shared.Rbac().V1().ClusterRoles()
		clusterRoleInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleClusterRole(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleClusterRole(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleClusterRole(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("rbac.authorization.k8s.io", "clusterrolebindings") {
		clusterRoleBindingInformer := shared.Rbac().V1().ClusterRoleBindings()
		clusterRoleBindingInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleClusterRoleBinding(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleClusterRoleBinding(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleClusterRoleBinding(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("", "persistentvolumes") {
		pvInformer := shared.Core().V1().PersistentVolumes()
		pvInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handlePersistentVolume(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handlePersistentVolume(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handlePersistentVolume(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("storage.k8s.io", "storageclasses") {
		storageClassInformer := shared.Storage().V1().StorageClasses()
		storageClassInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleStorageClass(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleStorageClass(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleStorageClass(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("networking.k8s.io", "ingressclasses") {
		ingressClassInformer := shared.Networking().V1().IngressClasses()
		ingressClassInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleIngressClass(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleIngressClass(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleIngressClass(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("admissionregistration.k8s.io", "validatingwebhookconfigurations") {
		validatingWebhookInformer := shared.Admissionregistration().V1().ValidatingWebhookConfigurations()
		validatingWebhookInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleValidatingWebhook(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleValidatingWebhook(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleValidatingWebhook(obj, MessageTypeDeleted) },
		})
	}

	if mgr.permissions == nil || mgr.permissions.CanListWatch("admissionregistration.k8s.io", "mutatingwebhookconfigurations") {
		mutatingWebhookInformer := shared.Admissionregistration().V1().MutatingWebhookConfigurations()
		mutatingWebhookInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { mgr.handleMutatingWebhook(obj, MessageTypeAdded) },
			UpdateFunc: func(_, newObj interface{}) { mgr.handleMutatingWebhook(newObj, MessageTypeModified) },
			DeleteFunc: func(obj interface{}) { mgr.handleMutatingWebhook(obj, MessageTypeDeleted) },
		})
	}

	mgr.initCustomResourceInformers(factory)

	return mgr
}

// Stop halts any dynamically managed informers that are not owned by the shared factory.
func (m *Manager) Stop() {
	if m == nil {
		return
	}
	m.customInformerMu.Lock()
	defer m.customInformerMu.Unlock()
	for key, informer := range m.customInformers {
		informer.stop()
		delete(m.customInformers, key)
	}
}

// SetCustomResourceCacheInvalidator registers a cache eviction callback for custom resources.
func (m *Manager) SetCustomResourceCacheInvalidator(invalidator func(kind, namespace, name string)) {
	if m == nil {
		return
	}
	m.customInvalidatorMu.Lock()
	m.customInvalidator = invalidator
	m.customInvalidatorMu.Unlock()
}

func (m *Manager) invalidateCustomResourceCache(kind, namespace, name string) {
	m.customInvalidatorMu.RLock()
	invalidator := m.customInvalidator
	m.customInvalidatorMu.RUnlock()
	if invalidator == nil {
		return
	}
	invalidator(kind, namespace, name)
}

func (m *Manager) initCustomResourceInformers(factory *informer.Factory) {
	if m == nil || m.dynamicClient == nil || factory == nil {
		return
	}
	// CustomResourceDefinitions are cluster-scoped — gate on permissions.
	if m.permissions != nil && !m.permissions.CanListWatch("apiextensions.k8s.io", "customresourcedefinitions") {
		return
	}
	apiextFactory := factory.APIExtensionsInformerFactory()
	if apiextFactory == nil {
		return
	}
	crdInformer := apiextFactory.Apiextensions().V1().CustomResourceDefinitions()
	crdInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { m.handleCustomResourceDefinition(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { m.handleCustomResourceDefinition(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { m.handleCustomResourceDefinition(obj, MessageTypeDeleted) },
	})
}

func (m *Manager) handleCustomResourceDefinition(obj interface{}, updateType MessageType) {
	crd := customResourceDefinitionFromObject(obj)
	if crd == nil {
		return
	}
	// CRD updates feed both the cluster CRD stream and custom resource informers.
	m.handleClusterCRD(obj, updateType)
	if updateType == MessageTypeDeleted {
		m.removeCustomInformer(crd.Name)
		return
	}
	m.ensureCustomInformer(crd)
}

func (m *Manager) ensureCustomInformer(crd *apiextensionsv1.CustomResourceDefinition) {
	if m == nil || m.dynamicClient == nil || crd == nil {
		return
	}
	customDomain := domainNamespaceCustom
	namespace := metav1.NamespaceAll
	switch crd.Spec.Scope {
	case apiextensionsv1.NamespaceScoped:
		customDomain = domainNamespaceCustom
		namespace = metav1.NamespaceAll
	case apiextensionsv1.ClusterScoped:
		customDomain = domainClusterCustom
		namespace = ""
	default:
		m.removeCustomInformer(crd.Name)
		return
	}
	version := preferredCustomCRDVersion(crd)
	if version == "" || crd.Spec.Names.Plural == "" {
		return
	}
	gvr := schema.GroupVersionResource{
		Group:    crd.Spec.Group,
		Version:  version,
		Resource: crd.Spec.Names.Plural,
	}
	kind := crd.Spec.Names.Kind

	m.customInformerMu.Lock()
	existing := m.customInformers[crd.Name]
	if existing != nil && existing.gvr == gvr && existing.kind == kind && existing.domain == customDomain {
		m.customInformerMu.Unlock()
		return
	}
	if existing != nil {
		existing.stop()
		delete(m.customInformers, crd.Name)
	}

	// Use a dynamic informer per CRD to stream custom resource updates.
	dynamicInformer := dynamicinformer.NewFilteredDynamicInformer(
		m.dynamicClient,
		gvr,
		namespace,
		0,
		cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc},
		nil,
	)
	informer := dynamicInformer.Informer()
	info := &customResourceInformer{
		gvr:      gvr,
		kind:     kind,
		domain:   customDomain,
		informer: informer,
		stopCh:   make(chan struct{}),
	}
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { m.handleCustomResource(obj, MessageTypeAdded, info) },
		UpdateFunc: func(_, newObj interface{}) { m.handleCustomResource(newObj, MessageTypeModified, info) },
		DeleteFunc: func(obj interface{}) { m.handleCustomResource(obj, MessageTypeDeleted, info) },
	})
	m.customInformers[crd.Name] = info
	m.customInformerMu.Unlock()

	go informer.Run(info.stopCh)
}

func (m *Manager) removeCustomInformer(crdName string) {
	if m == nil || crdName == "" {
		return
	}
	m.customInformerMu.Lock()
	defer m.customInformerMu.Unlock()
	if informer, ok := m.customInformers[crdName]; ok {
		informer.stop()
		delete(m.customInformers, crdName)
	}
}

func (m *Manager) handleCustomResource(obj interface{}, updateType MessageType, info *customResourceInformer) {
	resource := customResourceFromObject(obj)
	if resource == nil || info == nil {
		return
	}

	kind := resource.GetKind()
	if kind == "" {
		kind = info.kind
	}
	domain := info.domain
	if domain == "" {
		domain = domainNamespaceCustom
	}
	if kind != "" && resource.GetName() != "" {
		// Invalidate cached YAML/details on custom resource updates.
		m.invalidateCustomResourceCache(kind, resource.GetNamespace(), resource.GetName())
	}

	update := Update{
		Type:            updateType,
		Domain:          domain,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: resource.GetResourceVersion(),
		UID:             string(resource.GetUID()),
		Name:            resource.GetName(),
		Namespace:       resource.GetNamespace(),
		Kind:            kind,
	}
	if updateType != MessageTypeDeleted {
		if domain == domainClusterCustom {
			update.Row = snapshot.BuildClusterCustomSummary(m.clusterMeta, resource, info.gvr.Group, info.kind)
		} else {
			update.Row = snapshot.BuildNamespaceCustomSummary(m.clusterMeta, resource, info.gvr.Group, info.kind)
		}
	}

	if domain == domainClusterCustom {
		m.broadcast(domain, scopesForCluster(), update)
		return
	}
	m.broadcast(domain, scopesForNamespace(resource.GetNamespace()), update)
}

// Cluster CRD updates keep the CRD list aligned with snapshot formatting.
func (m *Manager) handleClusterCRD(obj interface{}, updateType MessageType) {
	crd := customResourceDefinitionFromObject(obj)
	if crd == nil {
		return
	}

	summary := snapshot.BuildClusterCRDSummary(m.clusterMeta, crd)
	update := Update{
		Type:            updateType,
		Domain:          domainClusterCRDs,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: crd.ResourceVersion,
		UID:             string(crd.UID),
		Name:            crd.Name,
		Namespace:       crd.Namespace,
		Kind:            "CustomResourceDefinition",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainClusterCRDs, scopesForCluster(), update)
}

func preferredCustomCRDVersion(crd *apiextensionsv1.CustomResourceDefinition) string {
	if crd == nil {
		return ""
	}
	for _, version := range crd.Spec.Versions {
		if version.Served && version.Storage {
			return version.Name
		}
	}
	if len(crd.Spec.Versions) > 0 {
		return crd.Spec.Versions[0].Name
	}
	return ""
}

// Subscribe registers a new subscriber for the supplied domain/scope.
func (m *Manager) Subscribe(domain, scope string) (*Subscription, error) {
	if m == nil {
		return nil, errors.New("resource stream not initialised")
	}
	normalized, err := normalizeScopeForDomain(domain, scope)
	if err != nil {
		return nil, err
	}
	// Avoid pre-checking permissions so partial streams can still deliver updates.

	m.mu.Lock()
	scopeSubscribers, ok := m.subscribers[domain]
	if !ok {
		scopeSubscribers = make(map[string]map[uint64]*subscription)
		m.subscribers[domain] = scopeSubscribers
	}

	subs, ok := scopeSubscribers[normalized]
	if !ok {
		subs = make(map[uint64]*subscription)
		scopeSubscribers[normalized] = subs
	}
	if len(subs) >= config.ResourceStreamMaxSubscribersPerScope {
		m.mu.Unlock()
		err := fmt.Errorf("resource stream subscriber limit reached for %s/%s", domain, normalized)
		m.logger.Warn(err.Error(), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return nil, err
	}

	id := atomic.AddUint64(&m.nextID, 1)
	sub := &subscription{
		ch:      make(chan Update, config.ResourceStreamSubscriberBufferSize),
		drops:   make(chan DropReason, 1),
		created: time.Now(),
	}
	subs[id] = sub
	m.mu.Unlock()

	cancel := func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if domainSubs, ok := m.subscribers[domain]; ok {
			if scopeSubs, ok := domainSubs[normalized]; ok {
				if current, exists := scopeSubs[id]; exists && current == sub {
					delete(scopeSubs, id)
					if len(scopeSubs) == 0 {
						delete(domainSubs, normalized)
						m.clearScopeStateLocked(domain, normalized)
					}
					sub.close(DropReasonClosed)
				}
			}
			if len(domainSubs) == 0 {
				delete(m.subscribers, domain)
			}
		}
	}

	return &Subscription{
		Domain:  domain,
		Scope:   normalized,
		Updates: sub.ch,
		Drops:   sub.drops,
		Cancel:  cancel,
	}, nil
}

// Resume returns buffered updates after the provided sequence token.
func (m *Manager) Resume(domain, scope string, since uint64) ([]Update, bool) {
	if m == nil || since == 0 {
		return nil, false
	}
	key := bufferKey(domain, scope)
	m.mu.RLock()
	buffer := m.buffers[key]
	if buffer == nil {
		m.mu.RUnlock()
		return nil, false
	}
	updates, ok := buffer.since(since)
	m.mu.RUnlock()
	if !ok {
		return nil, false
	}
	results := make([]Update, 0, len(updates))
	for _, item := range updates {
		results = append(results, item.update)
	}
	return results, true
}

func (m *Manager) handlePod(obj interface{}, updateType MessageType) {
	pod := podFromObject(obj)
	if pod == nil {
		return
	}

	podUsage := m.podMetricsSnapshot()
	summary := snapshot.BuildPodSummary(m.clusterMeta, pod, podUsage, m.rsLister)
	update := Update{
		Type:            updateType,
		Domain:          domainPods,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: pod.ResourceVersion,
		UID:             string(pod.UID),
		Name:            pod.Name,
		Namespace:       pod.Namespace,
		Kind:            "Pod",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainPods, scopesForPod(summary), update)

	m.handleWorkloadFromPod(pod, updateType, podUsage)
	m.handleNodeFromPod(pod)
}

func (m *Manager) handleConfigMap(obj interface{}, updateType MessageType) {
	cm := configMapFromObject(obj)
	if cm == nil {
		return
	}

	summary := snapshot.BuildConfigMapSummary(m.clusterMeta, cm)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceConfig,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: cm.ResourceVersion,
		UID:             string(cm.UID),
		Name:            cm.Name,
		Namespace:       cm.Namespace,
		Kind:            "ConfigMap",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNamespaceConfig, scopesForNamespace(cm.Namespace), update)
	m.maybeBroadcastHelmRefreshFromConfigMap(cm, updateType)
}

func (m *Manager) handleSecret(obj interface{}, updateType MessageType) {
	secret := secretFromObject(obj)
	if secret == nil {
		return
	}

	summary := snapshot.BuildSecretSummary(m.clusterMeta, secret)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceConfig,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: secret.ResourceVersion,
		UID:             string(secret.UID),
		Name:            secret.Name,
		Namespace:       secret.Namespace,
		Kind:            "Secret",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNamespaceConfig, scopesForNamespace(secret.Namespace), update)
	m.maybeBroadcastHelmRefresh(secret, updateType)
}

// Helm release updates are streamed as COMPLETE signals to trigger a snapshot resync.
func (m *Manager) maybeBroadcastHelmRefresh(secret *corev1.Secret, updateType MessageType) {
	if !isHelmReleaseObject(secret.Name, secret.Labels, string(secret.Type)) {
		return
	}
	m.broadcastHelmRefresh(secret.Name, secret.Namespace, secret.ResourceVersion, updateType)
}

func (m *Manager) maybeBroadcastHelmRefreshFromConfigMap(cm *corev1.ConfigMap, updateType MessageType) {
	if cm == nil {
		return
	}
	if !isHelmReleaseObject(cm.Name, cm.Labels, "") {
		return
	}
	m.broadcastHelmRefresh(cm.Name, cm.Namespace, cm.ResourceVersion, updateType)
}

func (m *Manager) broadcastHelmRefresh(name, namespace, resourceVersion string, updateType MessageType) {
	reason := "helm release changed"
	switch updateType {
	case MessageTypeAdded:
		reason = "helm release added"
	case MessageTypeDeleted:
		reason = "helm release deleted"
	case MessageTypeModified:
		reason = "helm release updated"
	}

	releaseName := helmReleaseName(name)
	update := Update{
		Type:            MessageTypeComplete,
		Domain:          domainNamespaceHelm,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: resourceVersion,
		Name:            releaseName,
		Namespace:       namespace,
		Kind:            "HelmRelease",
		Error:           reason,
	}
	m.broadcast(domainNamespaceHelm, scopesForNamespace(namespace), update)
}

func (m *Manager) handleRole(obj interface{}, updateType MessageType) {
	role := roleFromObject(obj)
	if role == nil {
		return
	}

	summary := snapshot.BuildRoleSummary(m.clusterMeta, role)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceRBAC,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: role.ResourceVersion,
		UID:             string(role.UID),
		Name:            role.Name,
		Namespace:       role.Namespace,
		Kind:            "Role",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNamespaceRBAC, scopesForNamespace(role.Namespace), update)
}

func (m *Manager) handleRoleBinding(obj interface{}, updateType MessageType) {
	binding := roleBindingFromObject(obj)
	if binding == nil {
		return
	}

	summary := snapshot.BuildRoleBindingSummary(m.clusterMeta, binding)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceRBAC,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: binding.ResourceVersion,
		UID:             string(binding.UID),
		Name:            binding.Name,
		Namespace:       binding.Namespace,
		Kind:            "RoleBinding",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNamespaceRBAC, scopesForNamespace(binding.Namespace), update)
}

func (m *Manager) handleServiceAccount(obj interface{}, updateType MessageType) {
	serviceAccount := serviceAccountFromObject(obj)
	if serviceAccount == nil {
		return
	}

	summary := snapshot.BuildServiceAccountSummary(m.clusterMeta, serviceAccount)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceRBAC,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: serviceAccount.ResourceVersion,
		UID:             string(serviceAccount.UID),
		Name:            serviceAccount.Name,
		Namespace:       serviceAccount.Namespace,
		Kind:            "ServiceAccount",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNamespaceRBAC, scopesForNamespace(serviceAccount.Namespace), update)
}

// Cluster RBAC updates target the cluster scope only.
func (m *Manager) handleClusterRole(obj interface{}, updateType MessageType) {
	role := clusterRoleFromObject(obj)
	if role == nil {
		return
	}

	summary := snapshot.BuildClusterRoleSummary(m.clusterMeta, role)
	update := Update{
		Type:            updateType,
		Domain:          domainClusterRBAC,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: role.ResourceVersion,
		UID:             string(role.UID),
		Name:            role.Name,
		Namespace:       role.Namespace,
		Kind:            "ClusterRole",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainClusterRBAC, scopesForCluster(), update)
}

func (m *Manager) handleClusterRoleBinding(obj interface{}, updateType MessageType) {
	binding := clusterRoleBindingFromObject(obj)
	if binding == nil {
		return
	}

	summary := snapshot.BuildClusterRoleBindingSummary(m.clusterMeta, binding)
	update := Update{
		Type:            updateType,
		Domain:          domainClusterRBAC,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: binding.ResourceVersion,
		UID:             string(binding.UID),
		Name:            binding.Name,
		Namespace:       binding.Namespace,
		Kind:            "ClusterRoleBinding",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainClusterRBAC, scopesForCluster(), update)
}

func (m *Manager) handleService(obj interface{}, updateType MessageType) {
	service := serviceFromObject(obj)
	if service == nil {
		return
	}

	slices, err := m.listEndpointSlicesForService(service.Namespace, service.Name)
	if err != nil {
		m.logger.Warn(
			fmt.Sprintf("resource stream: list endpoint slices for service %s/%s failed: %v", service.Namespace, service.Name, err),
			"ResourceStream",
		)
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceNetwork,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: service.ResourceVersion,
		UID:             string(service.UID),
		Name:            service.Name,
		Namespace:       service.Namespace,
		Kind:            "Service",
	}
	if updateType != MessageTypeDeleted {
		update.Row = snapshot.BuildServiceNetworkSummary(m.clusterMeta, service, slices)
	}

	m.broadcast(domainNamespaceNetwork, scopesForNamespace(service.Namespace), update)
}

func (m *Manager) handleEndpointSlice(obj interface{}, updateType MessageType) {
	slice := endpointSliceFromObject(obj)
	if slice == nil {
		return
	}
	serviceName := ""
	if slice.Labels != nil {
		serviceName = strings.TrimSpace(slice.Labels[discoveryv1.LabelServiceName])
	}
	if serviceName == "" {
		return
	}

	slices, err := m.listEndpointSlicesForService(slice.Namespace, serviceName)
	if err != nil {
		m.logger.Warn(
			fmt.Sprintf("resource stream: list endpoint slices for service %s/%s failed: %v", slice.Namespace, serviceName, err),
			"ResourceStream",
		)
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	if len(slices) == 0 {
		update := Update{
			Type:            MessageTypeDeleted,
			Domain:          domainNamespaceNetwork,
			ClusterID:       m.clusterMeta.ClusterID,
			ClusterName:     m.clusterMeta.ClusterName,
			ResourceVersion: slice.ResourceVersion,
			UID:             string(slice.UID),
			Name:            serviceName,
			Namespace:       slice.Namespace,
			Kind:            "EndpointSlice",
		}
		m.broadcast(domainNamespaceNetwork, scopesForNamespace(slice.Namespace), update)
	} else {
		summary := snapshot.BuildEndpointSliceSummary(m.clusterMeta, slice.Namespace, serviceName, slices)
		eventType := updateType
		if eventType == MessageTypeDeleted {
			eventType = MessageTypeModified
		}
		update := Update{
			Type:            eventType,
			Domain:          domainNamespaceNetwork,
			ClusterID:       m.clusterMeta.ClusterID,
			ClusterName:     m.clusterMeta.ClusterName,
			ResourceVersion: slice.ResourceVersion,
			UID:             string(slice.UID),
			Name:            serviceName,
			Namespace:       slice.Namespace,
			Kind:            "EndpointSlice",
			Row:             summary,
		}
		m.broadcast(domainNamespaceNetwork, scopesForNamespace(slice.Namespace), update)
	}

	if m.serviceLister == nil {
		return
	}
	service, err := m.serviceLister.Services(slice.Namespace).Get(serviceName)
	if err != nil || service == nil {
		return
	}
	serviceSummary := snapshot.BuildServiceNetworkSummary(m.clusterMeta, service, slices)
	serviceUpdate := Update{
		Type:            MessageTypeModified,
		Domain:          domainNamespaceNetwork,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: slice.ResourceVersion,
		UID:             string(service.UID),
		Name:            service.Name,
		Namespace:       service.Namespace,
		Kind:            "Service",
		Row:             serviceSummary,
	}
	m.broadcast(domainNamespaceNetwork, scopesForNamespace(service.Namespace), serviceUpdate)
}

func (m *Manager) handleIngress(obj interface{}, updateType MessageType) {
	ingress := ingressFromObject(obj)
	if ingress == nil {
		return
	}

	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceNetwork,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: ingress.ResourceVersion,
		UID:             string(ingress.UID),
		Name:            ingress.Name,
		Namespace:       ingress.Namespace,
		Kind:            "Ingress",
	}
	if updateType != MessageTypeDeleted {
		update.Row = snapshot.BuildIngressNetworkSummary(m.clusterMeta, ingress)
	}

	m.broadcast(domainNamespaceNetwork, scopesForNamespace(ingress.Namespace), update)
}

func (m *Manager) handleNetworkPolicy(obj interface{}, updateType MessageType) {
	policy := networkPolicyFromObject(obj)
	if policy == nil {
		return
	}

	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceNetwork,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: policy.ResourceVersion,
		UID:             string(policy.UID),
		Name:            policy.Name,
		Namespace:       policy.Namespace,
		Kind:            "NetworkPolicy",
	}
	if updateType != MessageTypeDeleted {
		update.Row = snapshot.BuildNetworkPolicySummary(m.clusterMeta, policy)
	}

	m.broadcast(domainNamespaceNetwork, scopesForNamespace(policy.Namespace), update)
}

// Cluster configuration updates stream shared cluster resources.
func (m *Manager) handleStorageClass(obj interface{}, updateType MessageType) {
	storageClass := storageClassFromObject(obj)
	if storageClass == nil {
		return
	}

	summary := snapshot.BuildClusterStorageClassSummary(m.clusterMeta, storageClass)
	update := Update{
		Type:            updateType,
		Domain:          domainClusterConfig,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: storageClass.ResourceVersion,
		UID:             string(storageClass.UID),
		Name:            storageClass.Name,
		Namespace:       storageClass.Namespace,
		Kind:            "StorageClass",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handleIngressClass(obj interface{}, updateType MessageType) {
	ingressClass := ingressClassFromObject(obj)
	if ingressClass == nil {
		return
	}

	summary := snapshot.BuildClusterIngressClassSummary(m.clusterMeta, ingressClass)
	update := Update{
		Type:            updateType,
		Domain:          domainClusterConfig,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: ingressClass.ResourceVersion,
		UID:             string(ingressClass.UID),
		Name:            ingressClass.Name,
		Namespace:       ingressClass.Namespace,
		Kind:            "IngressClass",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handleValidatingWebhook(obj interface{}, updateType MessageType) {
	webhook := validatingWebhookFromObject(obj)
	if webhook == nil {
		return
	}

	summary := snapshot.BuildClusterValidatingWebhookSummary(m.clusterMeta, webhook)
	update := Update{
		Type:            updateType,
		Domain:          domainClusterConfig,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: webhook.ResourceVersion,
		UID:             string(webhook.UID),
		Name:            webhook.Name,
		Namespace:       webhook.Namespace,
		Kind:            "ValidatingWebhookConfiguration",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handleMutatingWebhook(obj interface{}, updateType MessageType) {
	webhook := mutatingWebhookFromObject(obj)
	if webhook == nil {
		return
	}

	summary := snapshot.BuildClusterMutatingWebhookSummary(m.clusterMeta, webhook)
	update := Update{
		Type:            updateType,
		Domain:          domainClusterConfig,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: webhook.ResourceVersion,
		UID:             string(webhook.UID),
		Name:            webhook.Name,
		Namespace:       webhook.Namespace,
		Kind:            "MutatingWebhookConfiguration",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handlePersistentVolumeClaim(obj interface{}, updateType MessageType) {
	pvc := persistentVolumeClaimFromObject(obj)
	if pvc == nil {
		return
	}

	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceStorage,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: pvc.ResourceVersion,
		UID:             string(pvc.UID),
		Name:            pvc.Name,
		Namespace:       pvc.Namespace,
		Kind:            "PersistentVolumeClaim",
	}
	if updateType != MessageTypeDeleted {
		update.Row = snapshot.BuildPVCStorageSummary(m.clusterMeta, pvc)
	}

	m.broadcast(domainNamespaceStorage, scopesForNamespace(pvc.Namespace), update)
}

// Persistent volumes belong to the cluster storage domain.
func (m *Manager) handlePersistentVolume(obj interface{}, updateType MessageType) {
	pv := persistentVolumeFromObject(obj)
	if pv == nil {
		return
	}

	summary := snapshot.BuildClusterStorageSummary(m.clusterMeta, pv)
	update := Update{
		Type:            updateType,
		Domain:          domainClusterStorage,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: pv.ResourceVersion,
		UID:             string(pv.UID),
		Name:            pv.Name,
		Namespace:       pv.Namespace,
		Kind:            "PersistentVolume",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainClusterStorage, scopesForCluster(), update)
}

func (m *Manager) handleHPA(obj interface{}, updateType MessageType) {
	hpa := hpaFromObject(obj)
	if hpa == nil {
		return
	}

	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceAutoscaling,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: hpa.ResourceVersion,
		UID:             string(hpa.UID),
		Name:            hpa.Name,
		Namespace:       hpa.Namespace,
		Kind:            "HorizontalPodAutoscaler",
	}
	if updateType != MessageTypeDeleted {
		update.Row = snapshot.BuildHPASummary(m.clusterMeta, hpa)
	}

	m.broadcast(domainNamespaceAutoscaling, scopesForNamespace(hpa.Namespace), update)
}

func (m *Manager) handleResourceQuota(obj interface{}, updateType MessageType) {
	quota := resourceQuotaFromObject(obj)
	if quota == nil {
		return
	}

	summary := snapshot.BuildResourceQuotaSummary(m.clusterMeta, quota)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceQuotas,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: quota.ResourceVersion,
		UID:             string(quota.UID),
		Name:            quota.Name,
		Namespace:       quota.Namespace,
		Kind:            "ResourceQuota",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNamespaceQuotas, scopesForNamespace(quota.Namespace), update)
}

func (m *Manager) handleLimitRange(obj interface{}, updateType MessageType) {
	limit := limitRangeFromObject(obj)
	if limit == nil {
		return
	}

	summary := snapshot.BuildLimitRangeSummary(m.clusterMeta, limit)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceQuotas,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: limit.ResourceVersion,
		UID:             string(limit.UID),
		Name:            limit.Name,
		Namespace:       limit.Namespace,
		Kind:            "LimitRange",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNamespaceQuotas, scopesForNamespace(limit.Namespace), update)
}

func (m *Manager) handlePodDisruptionBudget(obj interface{}, updateType MessageType) {
	pdb := podDisruptionBudgetFromObject(obj)
	if pdb == nil {
		return
	}

	summary := snapshot.BuildPodDisruptionBudgetSummary(m.clusterMeta, pdb)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceQuotas,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: pdb.ResourceVersion,
		UID:             string(pdb.UID),
		Name:            pdb.Name,
		Namespace:       pdb.Namespace,
		Kind:            "PodDisruptionBudget",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNamespaceQuotas, scopesForNamespace(pdb.Namespace), update)
}

func (m *Manager) handleNode(obj interface{}, updateType MessageType) {
	node := nodeFromObject(obj)
	if node == nil {
		return
	}
	pods, err := m.podsForNode(node.Name)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("resource stream: list pods for node %s failed: %v", node.Name, err), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	summary, err := snapshot.BuildNodeSummary(m.clusterMeta, node, pods, m.metrics)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("resource stream: build node summary for %s failed: %v", node.Name, err), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	update := Update{
		Type:            updateType,
		Domain:          domainNodes,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: node.ResourceVersion,
		UID:             string(node.UID),
		Name:            node.Name,
		Namespace:       node.Namespace,
		Kind:            "Node",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainNodes, []string{""}, update)
}

func (m *Manager) handleWorkload(obj interface{}, updateType MessageType) {
	workload, kind := workloadFromObject(obj)
	if workload == nil {
		return
	}

	namespace := workload.GetNamespace()
	ownerKey := snapshot.WorkloadOwnerKey(kind, namespace, workload.GetName())
	pods, err := m.podsForWorkload(namespace, ownerKey)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("resource stream: list pods for workload %s failed: %v", ownerKey, err), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	podUsage := m.podMetricsSnapshot()
	summary, err := snapshot.BuildWorkloadSummary(m.clusterMeta, workload, pods, podUsage)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("resource stream: build workload summary for %s failed: %v", ownerKey, err), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	update := Update{
		Type:            updateType,
		Domain:          domainWorkloads,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: workload.GetResourceVersion(),
		UID:             string(workload.GetUID()),
		Name:            workload.GetName(),
		Namespace:       namespace,
		Kind:            kind,
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) handleWorkloadFromPod(pod *corev1.Pod, updateType MessageType, usage map[string]metrics.PodUsage) {
	if pod == nil {
		return
	}
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		return
	}

	// Refresh workload rows when a pod change affects derived readiness or restart counts.
	ownerKey := snapshot.WorkloadOwnerKeyForPod(pod)
	if ownerKey == "" {
		m.handleStandalonePodWorkload(pod, updateType, usage)
		return
	}

	namespace, kind, name, ok := parseWorkloadOwnerKey(ownerKey)
	if !ok {
		m.handleStandalonePodWorkload(pod, updateType, usage)
		return
	}

	workload, err := m.lookupWorkload(kind, namespace, name)
	if err != nil || workload == nil {
		m.handleStandalonePodWorkload(pod, updateType, usage)
		return
	}

	pods, err := m.podsForWorkload(namespace, ownerKey)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("resource stream: list pods for workload %s failed: %v", ownerKey, err), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	summary, err := snapshot.BuildWorkloadSummary(m.clusterMeta, workload, pods, usage)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("resource stream: build workload summary for %s failed: %v", ownerKey, err), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	update := Update{
		Type:            MessageTypeModified,
		Domain:          domainWorkloads,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: pod.ResourceVersion,
		UID:             string(workload.GetUID()),
		Name:            workload.GetName(),
		Namespace:       namespace,
		Kind:            kind,
		Row:             summary,
	}
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) handleStandalonePodWorkload(pod *corev1.Pod, updateType MessageType, usage map[string]metrics.PodUsage) {
	if pod == nil {
		return
	}
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		return
	}

	summary := snapshot.BuildStandalonePodWorkloadSummary(m.clusterMeta, pod, usage)
	update := Update{
		Type:            updateType,
		Domain:          domainWorkloads,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: pod.ResourceVersion,
		UID:             string(pod.UID),
		Name:            pod.Name,
		Namespace:       pod.Namespace,
		Kind:            "Pod",
	}
	if updateType != MessageTypeDeleted {
		update.Row = summary
	}

	m.broadcast(domainWorkloads, scopesForNamespace(pod.Namespace), update)
}

func (m *Manager) handleNodeFromPod(pod *corev1.Pod) {
	if pod == nil || pod.Spec.NodeName == "" {
		return
	}
	if m.nodeLister == nil {
		return
	}

	node, err := m.nodeLister.Get(pod.Spec.NodeName)
	if err != nil || node == nil {
		if err != nil {
			m.logger.Warn(fmt.Sprintf("resource stream: resolve node %s failed: %v", pod.Spec.NodeName, err), "ResourceStream")
			if m.telemetry != nil {
				m.telemetry.RecordStreamError(telemetry.StreamResources, err)
			}
		}
		return
	}

	// Pod changes affect node summaries (pod counts, restarts, and metrics usage).
	pods, err := m.podsForNode(node.Name)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("resource stream: list pods for node %s failed: %v", node.Name, err), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}
	summary, err := snapshot.BuildNodeSummary(m.clusterMeta, node, pods, m.metrics)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("resource stream: build node summary for %s failed: %v", node.Name, err), "ResourceStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	update := Update{
		Type:            MessageTypeModified,
		Domain:          domainNodes,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: node.ResourceVersion,
		UID:             string(node.UID),
		Name:            node.Name,
		Namespace:       node.Namespace,
		Kind:            "Node",
		Row:             summary,
	}
	m.broadcast(domainNodes, []string{""}, update)
}

func (m *Manager) podMetricsSnapshot() map[string]metrics.PodUsage {
	if m.metrics == nil {
		return map[string]metrics.PodUsage{}
	}
	return m.metrics.LatestPodUsage()
}

func (m *Manager) broadcast(domain string, scopes []string, update Update) {
	if len(scopes) == 0 {
		return
	}

	// Fan-out updates per scope and trigger a RESET when subscribers fall behind.
	for _, scope := range uniqueScopes(scopes) {
		delivered := 0
		backpressureResets := 0
		backpressureDrops := 0
		closedCount := 0

		scopedUpdate, items := m.prepareBroadcast(domain, scope, update)
		for _, item := range items {
			if item.sub.isResyncing() {
				continue
			}
			sent, closed, reset := m.trySend(item.sub, scopedUpdate)
			if closed {
				closedCount++
				go m.dropSubscriber(domain, scope, item.id, item.sub, DropReasonClosed)
				continue
			}
			if reset {
				backpressureResets++
				continue
			}
			if sent {
				delivered++
				continue
			}
			backpressureDrops++
			go m.dropSubscriber(domain, scope, item.id, item.sub, DropReasonBackpressure)
		}

		if m.telemetry != nil {
			backpressureEvents := backpressureResets + backpressureDrops
			m.telemetry.RecordStreamDelivery(telemetry.StreamResources, delivered, backpressureEvents)
			if backpressureEvents > 0 {
				m.telemetry.RecordStreamError(
					telemetry.StreamResources,
					fmt.Errorf(
						"resource stream backlog reset %d subscriber(s) and dropped %d subscriber(s) for %s/%s",
						backpressureResets,
						backpressureDrops,
						domain,
						scope,
					),
				)
			}
		}
		if closedCount > 0 {
			m.logger.Info(fmt.Sprintf("resource stream: cleaned up %d closed subscribers for %s/%s", closedCount, domain, scope), "ResourceStream")
		}
	}
}

func (m *Manager) prepareBroadcast(domain, scope string, update Update) (Update, []struct {
	id  uint64
	sub *subscription
}) {
	m.mu.Lock()
	defer m.mu.Unlock()

	scopedUpdate := update
	scopedUpdate.Scope = scope

	scopeSubs := m.subscribers[domain][scope]
	key := bufferKey(domain, scope)
	_, bufferExists := m.buffers[key]
	if len(scopeSubs) > 0 || bufferExists {
		// Buffer updates only when there are active or recent subscribers for this scope.
		sequence := m.nextSequenceLocked(domain, scope)
		scopedUpdate.Sequence = strconv.FormatUint(sequence, 10)
		buffer := m.bufferLocked(domain, scope)
		buffer.add(bufferedUpdate{sequence: sequence, update: scopedUpdate})
	}
	if len(scopeSubs) == 0 {
		return scopedUpdate, nil
	}
	items := make([]struct {
		id  uint64
		sub *subscription
	}, 0, len(scopeSubs))
	for id, sub := range scopeSubs {
		items = append(items, struct {
			id  uint64
			sub *subscription
		}{id: id, sub: sub})
	}
	return scopedUpdate, items
}

func (m *Manager) nextSequenceLocked(domain, scope string) uint64 {
	key := bufferKey(domain, scope)
	if m.sequences == nil {
		m.sequences = make(map[string]uint64)
	}
	next := m.sequences[key] + 1
	m.sequences[key] = next
	return next
}

func (m *Manager) bufferLocked(domain, scope string) *updateBuffer {
	key := bufferKey(domain, scope)
	if m.buffers == nil {
		m.buffers = make(map[string]*updateBuffer)
	}
	buffer := m.buffers[key]
	if buffer == nil {
		buffer = newUpdateBuffer(config.ResourceStreamResumeBufferSize)
		m.buffers[key] = buffer
	}
	return buffer
}

// clearScopeStateLocked removes resume state for scopes without subscribers.
func (m *Manager) clearScopeStateLocked(domain, scope string) {
	key := bufferKey(domain, scope)
	if m.buffers != nil {
		delete(m.buffers, key)
	}
	if m.sequences != nil {
		delete(m.sequences, key)
	}
}

func (m *Manager) dropSubscriber(domain, scope string, id uint64, sub *subscription, reason DropReason) {
	m.mu.Lock()
	defer m.mu.Unlock()

	scopeSubs := m.subscribers[domain][scope]
	current, exists := scopeSubs[id]
	if !exists || current != sub {
		return
	}
	delete(scopeSubs, id)
	if len(scopeSubs) == 0 {
		delete(m.subscribers[domain], scope)
		m.clearScopeStateLocked(domain, scope)
	}
	if len(m.subscribers[domain]) == 0 {
		delete(m.subscribers, domain)
	}
	sub.close(reason)
}

func (m *Manager) trySend(sub *subscription, update Update) (sent bool, closed bool, reset bool) {
	defer func() {
		if r := recover(); r != nil {
			closed = true
			sent = false
			reset = false
		}
	}()
	select {
	case sub.ch <- update:
		return true, false, false
	default:
		if m.triggerResync(sub, update) {
			return false, false, true
		}
		return false, false, false
	}
}

func (m *Manager) triggerResync(sub *subscription, update Update) bool {
	if sub == nil {
		return false
	}
	reset := Update{
		Type:        MessageTypeReset,
		ClusterID:   update.ClusterID,
		ClusterName: update.ClusterName,
		Domain:      update.Domain,
		Scope:       update.Scope,
	}
	// Drop the oldest update to make room for the RESET signal.
	select {
	case <-sub.ch:
	default:
	}
	select {
	case sub.ch <- reset:
		return sub.markResyncing()
	default:
		return false
	}
}

func (m *Manager) podsForNode(node string) ([]*corev1.Pod, error) {
	if node == "" {
		return nil, nil
	}

	if m.podIndexer != nil {
		items, err := m.podIndexer.ByIndex(podNodeIndexName, node)
		if err == nil {
			return convertPodIndexerItems(items), nil
		}
	}

	pods, err := m.listPods("")
	if err != nil {
		return nil, err
	}
	filtered := make([]*corev1.Pod, 0, len(pods))
	for _, pod := range pods {
		if pod != nil && pod.Spec.NodeName == node {
			filtered = append(filtered, pod)
		}
	}
	return filtered, nil
}

func (m *Manager) podsForWorkload(namespace, ownerKey string) ([]*corev1.Pod, error) {
	if ownerKey == "" {
		return nil, nil
	}
	pods, err := m.listPods(namespace)
	if err != nil {
		return nil, err
	}
	filtered := make([]*corev1.Pod, 0, len(pods))
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if snapshot.WorkloadOwnerKeyForPod(pod) == ownerKey {
			filtered = append(filtered, pod)
		}
	}
	return filtered, nil
}

func (m *Manager) listPods(namespace string) ([]*corev1.Pod, error) {
	if m.podLister == nil {
		return nil, errors.New("pod lister unavailable")
	}
	if namespace == "" {
		return m.podLister.List(labels.Everything())
	}
	return m.podLister.Pods(namespace).List(labels.Everything())
}

func (m *Manager) listEndpointSlicesForService(namespace, service string) ([]*discoveryv1.EndpointSlice, error) {
	if m.sliceLister == nil {
		return []*discoveryv1.EndpointSlice{}, nil
	}
	selector := labels.SelectorFromSet(map[string]string{
		discoveryv1.LabelServiceName: service,
	})
	if namespace == "" {
		return m.sliceLister.List(selector)
	}
	return m.sliceLister.EndpointSlices(namespace).List(selector)
}

func (m *Manager) lookupWorkload(kind, namespace, name string) (metav1.Object, error) {
	switch strings.ToLower(kind) {
	case "deployment":
		if m.deploymentLister == nil {
			return nil, errors.New("deployment lister unavailable")
		}
		return m.deploymentLister.Deployments(namespace).Get(name)
	case "statefulset":
		if m.statefulLister == nil {
			return nil, errors.New("statefulset lister unavailable")
		}
		return m.statefulLister.StatefulSets(namespace).Get(name)
	case "daemonset":
		if m.daemonLister == nil {
			return nil, errors.New("daemonset lister unavailable")
		}
		return m.daemonLister.DaemonSets(namespace).Get(name)
	case "job":
		if m.jobLister == nil {
			return nil, errors.New("job lister unavailable")
		}
		return m.jobLister.Jobs(namespace).Get(name)
	case "cronjob":
		if m.cronJobLister == nil {
			return nil, errors.New("cronjob lister unavailable")
		}
		return m.cronJobLister.CronJobs(namespace).Get(name)
	default:
		return nil, fmt.Errorf("unsupported workload kind %q", kind)
	}
}

func workloadFromObject(obj interface{}) (metav1.Object, string) {
	switch typed := obj.(type) {
	case *appsv1.Deployment:
		return typed, "Deployment"
	case *appsv1.StatefulSet:
		return typed, "StatefulSet"
	case *appsv1.DaemonSet:
		return typed, "DaemonSet"
	case *batchv1.Job:
		return typed, "Job"
	case *batchv1.CronJob:
		return typed, "CronJob"
	case cache.DeletedFinalStateUnknown:
		return workloadFromObject(typed.Obj)
	default:
		return nil, ""
	}
}

func customResourceDefinitionFromObject(obj interface{}) *apiextensionsv1.CustomResourceDefinition {
	switch typed := obj.(type) {
	case *apiextensionsv1.CustomResourceDefinition:
		return typed
	case cache.DeletedFinalStateUnknown:
		return customResourceDefinitionFromObject(typed.Obj)
	default:
		return nil
	}
}

func customResourceFromObject(obj interface{}) *unstructured.Unstructured {
	switch typed := obj.(type) {
	case *unstructured.Unstructured:
		return typed
	case cache.DeletedFinalStateUnknown:
		return customResourceFromObject(typed.Obj)
	default:
		return nil
	}
}

func podFromObject(obj interface{}) *corev1.Pod {
	switch typed := obj.(type) {
	case *corev1.Pod:
		return typed
	case cache.DeletedFinalStateUnknown:
		return podFromObject(typed.Obj)
	default:
		return nil
	}
}

func nodeFromObject(obj interface{}) *corev1.Node {
	switch typed := obj.(type) {
	case *corev1.Node:
		return typed
	case cache.DeletedFinalStateUnknown:
		return nodeFromObject(typed.Obj)
	default:
		return nil
	}
}

func configMapFromObject(obj interface{}) *corev1.ConfigMap {
	switch typed := obj.(type) {
	case *corev1.ConfigMap:
		return typed
	case cache.DeletedFinalStateUnknown:
		return configMapFromObject(typed.Obj)
	default:
		return nil
	}
}

func secretFromObject(obj interface{}) *corev1.Secret {
	switch typed := obj.(type) {
	case *corev1.Secret:
		return typed
	case cache.DeletedFinalStateUnknown:
		return secretFromObject(typed.Obj)
	default:
		return nil
	}
}

func roleFromObject(obj interface{}) *rbacv1.Role {
	switch typed := obj.(type) {
	case *rbacv1.Role:
		return typed
	case cache.DeletedFinalStateUnknown:
		return roleFromObject(typed.Obj)
	default:
		return nil
	}
}

func roleBindingFromObject(obj interface{}) *rbacv1.RoleBinding {
	switch typed := obj.(type) {
	case *rbacv1.RoleBinding:
		return typed
	case cache.DeletedFinalStateUnknown:
		return roleBindingFromObject(typed.Obj)
	default:
		return nil
	}
}

func clusterRoleFromObject(obj interface{}) *rbacv1.ClusterRole {
	switch typed := obj.(type) {
	case *rbacv1.ClusterRole:
		return typed
	case cache.DeletedFinalStateUnknown:
		return clusterRoleFromObject(typed.Obj)
	default:
		return nil
	}
}

func clusterRoleBindingFromObject(obj interface{}) *rbacv1.ClusterRoleBinding {
	switch typed := obj.(type) {
	case *rbacv1.ClusterRoleBinding:
		return typed
	case cache.DeletedFinalStateUnknown:
		return clusterRoleBindingFromObject(typed.Obj)
	default:
		return nil
	}
}

func serviceAccountFromObject(obj interface{}) *corev1.ServiceAccount {
	switch typed := obj.(type) {
	case *corev1.ServiceAccount:
		return typed
	case cache.DeletedFinalStateUnknown:
		return serviceAccountFromObject(typed.Obj)
	default:
		return nil
	}
}

func serviceFromObject(obj interface{}) *corev1.Service {
	switch typed := obj.(type) {
	case *corev1.Service:
		return typed
	case cache.DeletedFinalStateUnknown:
		return serviceFromObject(typed.Obj)
	default:
		return nil
	}
}

func endpointSliceFromObject(obj interface{}) *discoveryv1.EndpointSlice {
	switch typed := obj.(type) {
	case *discoveryv1.EndpointSlice:
		return typed
	case cache.DeletedFinalStateUnknown:
		return endpointSliceFromObject(typed.Obj)
	default:
		return nil
	}
}

func ingressFromObject(obj interface{}) *networkingv1.Ingress {
	switch typed := obj.(type) {
	case *networkingv1.Ingress:
		return typed
	case cache.DeletedFinalStateUnknown:
		return ingressFromObject(typed.Obj)
	default:
		return nil
	}
}

func ingressClassFromObject(obj interface{}) *networkingv1.IngressClass {
	switch typed := obj.(type) {
	case *networkingv1.IngressClass:
		return typed
	case cache.DeletedFinalStateUnknown:
		return ingressClassFromObject(typed.Obj)
	default:
		return nil
	}
}

func networkPolicyFromObject(obj interface{}) *networkingv1.NetworkPolicy {
	switch typed := obj.(type) {
	case *networkingv1.NetworkPolicy:
		return typed
	case cache.DeletedFinalStateUnknown:
		return networkPolicyFromObject(typed.Obj)
	default:
		return nil
	}
}

func storageClassFromObject(obj interface{}) *storagev1.StorageClass {
	switch typed := obj.(type) {
	case *storagev1.StorageClass:
		return typed
	case cache.DeletedFinalStateUnknown:
		return storageClassFromObject(typed.Obj)
	default:
		return nil
	}
}

func validatingWebhookFromObject(obj interface{}) *admissionregistrationv1.ValidatingWebhookConfiguration {
	switch typed := obj.(type) {
	case *admissionregistrationv1.ValidatingWebhookConfiguration:
		return typed
	case cache.DeletedFinalStateUnknown:
		return validatingWebhookFromObject(typed.Obj)
	default:
		return nil
	}
}

func mutatingWebhookFromObject(obj interface{}) *admissionregistrationv1.MutatingWebhookConfiguration {
	switch typed := obj.(type) {
	case *admissionregistrationv1.MutatingWebhookConfiguration:
		return typed
	case cache.DeletedFinalStateUnknown:
		return mutatingWebhookFromObject(typed.Obj)
	default:
		return nil
	}
}

func persistentVolumeClaimFromObject(obj interface{}) *corev1.PersistentVolumeClaim {
	switch typed := obj.(type) {
	case *corev1.PersistentVolumeClaim:
		return typed
	case cache.DeletedFinalStateUnknown:
		return persistentVolumeClaimFromObject(typed.Obj)
	default:
		return nil
	}
}

func persistentVolumeFromObject(obj interface{}) *corev1.PersistentVolume {
	switch typed := obj.(type) {
	case *corev1.PersistentVolume:
		return typed
	case cache.DeletedFinalStateUnknown:
		return persistentVolumeFromObject(typed.Obj)
	default:
		return nil
	}
}

func hpaFromObject(obj interface{}) *autoscalingv1.HorizontalPodAutoscaler {
	switch typed := obj.(type) {
	case *autoscalingv1.HorizontalPodAutoscaler:
		return typed
	case cache.DeletedFinalStateUnknown:
		return hpaFromObject(typed.Obj)
	default:
		return nil
	}
}

func resourceQuotaFromObject(obj interface{}) *corev1.ResourceQuota {
	switch typed := obj.(type) {
	case *corev1.ResourceQuota:
		return typed
	case cache.DeletedFinalStateUnknown:
		return resourceQuotaFromObject(typed.Obj)
	default:
		return nil
	}
}

func limitRangeFromObject(obj interface{}) *corev1.LimitRange {
	switch typed := obj.(type) {
	case *corev1.LimitRange:
		return typed
	case cache.DeletedFinalStateUnknown:
		return limitRangeFromObject(typed.Obj)
	default:
		return nil
	}
}

func podDisruptionBudgetFromObject(obj interface{}) *policyv1.PodDisruptionBudget {
	switch typed := obj.(type) {
	case *policyv1.PodDisruptionBudget:
		return typed
	case cache.DeletedFinalStateUnknown:
		return podDisruptionBudgetFromObject(typed.Obj)
	default:
		return nil
	}
}

func parseWorkloadOwnerKey(key string) (namespace, kind, name string, ok bool) {
	parts := strings.Split(key, "/")
	if len(parts) != 3 {
		return "", "", "", false
	}
	namespace = strings.TrimSpace(parts[0])
	kind = strings.TrimSpace(parts[1])
	name = strings.TrimSpace(parts[2])
	if namespace == "" || kind == "" || name == "" {
		return "", "", "", false
	}
	return namespace, kind, name, true
}

func scopesForPod(summary snapshot.PodSummary) []string {
	scopes := make([]string, 0, 4)
	if summary.Namespace != "" {
		scopes = append(scopes, fmt.Sprintf("namespace:%s", summary.Namespace), "namespace:all")
	}
	if summary.Node != "" {
		scopes = append(scopes, fmt.Sprintf("node:%s", summary.Node))
	}
	if summary.OwnerKind != "" && summary.OwnerKind != "None" && summary.OwnerName != "" && summary.OwnerName != "None" {
		scopes = append(scopes, fmt.Sprintf("workload:%s:%s:%s", summary.Namespace, summary.OwnerKind, summary.OwnerName))
	}
	return scopes
}

// Cluster-scoped domains always use the empty scope key.
func scopesForCluster() []string {
	return []string{""}
}

func scopesForNamespace(namespace string) []string {
	if strings.TrimSpace(namespace) == "" {
		return []string{"namespace:all"}
	}
	return []string{fmt.Sprintf("namespace:%s", namespace), "namespace:all"}
}

func uniqueScopes(scopes []string) []string {
	seen := make(map[string]struct{}, len(scopes))
	uniq := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		key := strings.TrimSpace(scope)
		if key == "" {
			key = ""
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		uniq = append(uniq, key)
	}
	return uniq
}

func bufferKey(domain, scope string) string {
	return strings.TrimSpace(domain) + "|" + strings.TrimSpace(scope)
}

func isHelmReleaseObject(name string, labels map[string]string, secretType string) bool {
	if secretType == helmReleaseSecretType {
		return true
	}
	if labels != nil {
		if strings.EqualFold(labels[helmReleaseOwnerLabel], helmReleaseOwnerValue) {
			return true
		}
		if strings.EqualFold(labels[strings.ToUpper(helmReleaseOwnerLabel)], helmReleaseOwnerValue) {
			return true
		}
	}
	return strings.HasPrefix(name, helmReleaseNamePrefix)
}

func helmReleaseName(name string) string {
	if !strings.HasPrefix(name, helmReleaseNamePrefix) {
		return name
	}
	trimmed := strings.TrimPrefix(name, helmReleaseNamePrefix)
	index := strings.LastIndex(trimmed, ".v")
	if index <= 0 {
		return trimmed
	}
	return trimmed[:index]
}

func convertPodIndexerItems(items []interface{}) []*corev1.Pod {
	if len(items) == 0 {
		return []*corev1.Pod{}
	}
	out := make([]*corev1.Pod, 0, len(items))
	for _, item := range items {
		if pod, ok := item.(*corev1.Pod); ok && pod != nil {
			out = append(out, pod)
		}
	}
	return out
}
