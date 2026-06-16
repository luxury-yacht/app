/*
 * backend/refresh/resourcestream/manager.go
 *
 * Wires Kubernetes informer events into resource-stream row updates. This file
 * owns the domain-specific translation from Kubernetes objects into refresh
 * updates, while subscription fan-out lives in stream_hub.go.
 */

package resourcestream

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynamicinformer "k8s.io/client-go/dynamic/dynamicinformer"
	appslisters "k8s.io/client-go/listers/apps/v1"
	autoscalinglisters "k8s.io/client-go/listers/autoscaling/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	discoverylisters "k8s.io/client-go/listers/discovery/v1"
	networklisters "k8s.io/client-go/listers/networking/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/ringbuffer"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/admission"
	apiextensionspkg "github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	rolepkg "github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	servicepkg "github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
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

// updateBuffer is the per-domain/scope resume buffer; the ring + replay logic is
// shared via ringbuffer.Buffer.
type updateBuffer = ringbuffer.Buffer[bufferedUpdate]

// newUpdateBuffer allocates a resume buffer capped at the requested size.
func newUpdateBuffer(max int) *updateBuffer {
	return ringbuffer.New(max, func(u bufferedUpdate) uint64 { return u.sequence })
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
	logger      containerlogsstream.Logger
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
	hpaLister        autoscalinglisters.HorizontalPodAutoscalerLister
	ingressLister    networklisters.IngressLister
	policyLister     networklisters.NetworkPolicyLister

	customInformerMu sync.Mutex
	customInformers  map[string]*customResourceInformer
	// stopped is set once Stop() runs. It is terminal: a torn-down manager is
	// discarded and replaced by a fresh one. It gates ensureCustomInformer so a
	// CRD event arriving after teardown (the shared CRD informer can still fire,
	// including its resync, until the factory is shut down) cannot resurrect a
	// custom informer whose stopCh nothing would ever close. Guarded by
	// customInformerMu.
	stopped bool
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
	logger containerlogsstream.Logger,
	recorder *telemetry.Recorder,
	meta snapshot.ClusterMeta,
	dynamicClient dynamic.Interface,
) *Manager {
	if logger == nil {
		logger = applog.Noop
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
	if mgr.canListWatch("autoscaling", "horizontalpodautoscalers") {
		mgr.hpaLister = shared.Autoscaling().V1().HorizontalPodAutoscalers().Lister()
	}

	mgr.registerPodStreams(factory)
	mgr.registerConfigStreams(factory)
	mgr.registerNetworkStreams(factory)
	mgr.registerSharedStreams(factory)
	mgr.registerAutoscalingStreams(factory)
	mgr.registerNodeStreams(factory)
	mgr.registerWorkloadStreams(factory)
	mgr.registerClusterConfigStreams(factory)

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
	m.stopped = true
	for key, informer := range m.customInformers {
		informer.stop()
		delete(m.customInformers, key)
	}
}

func (m *Manager) logWarn(message string) {
	if m == nil {
		return
	}
	applog.Warn(m.logger, message, logsources.ResourceStream, m.clusterMeta.ClusterID, m.clusterMeta.ClusterName)
}

func (m *Manager) logInfo(message string) {
	if m == nil {
		return
	}
	applog.Info(m.logger, message, logsources.ResourceStream, m.clusterMeta.ClusterID, m.clusterMeta.ClusterName)
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
		AddFunc: func(obj interface{}) { m.handleCustomResourceDefinitionEvent(nil, obj, MessageTypeAdded) },
		UpdateFunc: func(oldObj, newObj interface{}) {
			m.handleCustomResourceDefinitionEvent(oldObj, newObj, MessageTypeModified)
		},
		DeleteFunc: func(obj interface{}) { m.handleCustomResourceDefinitionEvent(obj, nil, MessageTypeDeleted) },
	})
}

func (m *Manager) handleCustomResourceDefinitionEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded:
		newCRD := customResourceDefinitionFromObject(newObj)
		m.handleCustomResourceDefinition(newObj, updateType)
		m.broadcastCustomDomainCompletes(nil, newCRD)
	case MessageTypeDeleted:
		oldCRD := customResourceDefinitionFromObject(oldObj)
		m.handleCustomResourceDefinition(oldObj, updateType)
		m.broadcastCustomDomainCompletes(oldCRD, nil)
	case MessageTypeModified:
		oldCRD := customResourceDefinitionFromObject(oldObj)
		newCRD := customResourceDefinitionFromObject(newObj)
		m.handleCustomResourceDefinition(newObj, updateType)
		if customCRDStreamSignature(oldCRD) != customCRDStreamSignature(newCRD) {
			m.broadcastCustomDomainCompletes(oldCRD, newCRD)
		}
	}
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
	if snapshot.IsFirstClassCustomResourceDefinition(crd) {
		m.removeCustomInformer(crd.Name)
		return
	}
	m.ensureCustomInformer(crd)
}

func (m *Manager) broadcastCustomDomainCompletes(oldCRD *apiextensionsv1.CustomResourceDefinition, newCRD *apiextensionsv1.CustomResourceDefinition) {
	type completeTarget struct {
		resourceVersion string
		ref             *resourcemodel.ResourceRef
	}
	targets := make(map[string]completeTarget, 2)
	for _, crd := range []*apiextensionsv1.CustomResourceDefinition{oldCRD, newCRD} {
		domain := customCRDDomain(crd)
		if domain == "" {
			continue
		}
		ref := m.resourceRefForObject(crd, "apiextensions.k8s.io", "v1", "CustomResourceDefinition", "customresourcedefinitions")
		targets[domain] = completeTarget{resourceVersion: crd.ResourceVersion, ref: &ref}
	}
	for domain, target := range targets {
		m.broadcastCustomDomainComplete(domain, target.resourceVersion, target.ref)
	}
}

func (m *Manager) broadcastCustomDomainComplete(domain, resourceVersion string, ref *resourcemodel.ResourceRef) {
	scopes := m.activeScopesForDomain(domain)
	if len(scopes) == 0 {
		switch domain {
		case domainClusterCustom:
			scopes = scopesForCluster()
		case domainNamespaceCustom:
			scopes = []string{"namespace:all"}
		default:
			return
		}
	}
	// COMPLETE is scope-level resync. Ref is carried as diagnostic context
	// so listeners and tooling can identify which CRD triggered the resync.
	update := Update{
		Type:            MessageTypeComplete,
		Domain:          domain,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: resourceVersion,
		Ref:             ref,
	}
	m.broadcast(domain, scopes, update)
}

func (m *Manager) activeScopesForDomain(domain string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	domainSubs := m.subscribers[domain]
	scopes := make([]string, 0, len(domainSubs))
	for scope := range domainSubs {
		scopes = append(scopes, scope)
	}
	return scopes
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
	// Once stopped, never resurrect an informer; the check-and-insert below must
	// stay atomic with Stop()'s drain, so both gate on stopped under this lock.
	if m.stopped {
		m.customInformerMu.Unlock()
		return
	}
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

	ref := m.resourceRefForObject(resource, info.gvr.Group, info.gvr.Version, kind, info.gvr.Resource)
	var row interface{}
	if updateType != MessageTypeDeleted {
		// The CRD name is the canonical Kubernetes form `<plural>.<group>`,
		// computable from the GVR we're already watching. Same derivation
		// for both the cluster-scoped and namespace-scoped paths.
		crdName := info.gvr.Resource + "." + info.gvr.Group
		if domain == domainClusterCustom {
			row = customresource.BuildClusterStreamSummary(m.clusterMeta, resource, info.gvr.Group, info.gvr.Version, info.kind, crdName)
		} else {
			// The streaming path has no parent scope concept — fall back
			// to the resource's own namespace (which is almost always
			// set for anything that reaches an informer).
			row = customresource.BuildNamespaceStreamSummary(m.clusterMeta, resource, info.gvr.Group, info.gvr.Version, info.kind, crdName, resource.GetNamespace())
		}
	}
	update := m.newObjectRowUpdate(updateType, domain, resource, ref, row)

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

	ref := m.resourceRefForObject(crd, "apiextensions.k8s.io", "v1", "CustomResourceDefinition", "customresourcedefinitions")
	update := m.newObjectRowUpdate(updateType, domainClusterCRDs, crd, ref, apiextensionspkg.BuildStreamSummary(m.clusterMeta, crd))

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

func customCRDStreamSignature(crd *apiextensionsv1.CustomResourceDefinition) string {
	if crd == nil {
		return ""
	}
	return strings.Join([]string{
		customCRDDomain(crd),
		crd.Spec.Group,
		preferredCustomCRDVersion(crd),
		crd.Spec.Names.Plural,
		crd.Spec.Names.Kind,
	}, "/")
}

func customCRDDomain(crd *apiextensionsv1.CustomResourceDefinition) string {
	if crd == nil || snapshot.IsFirstClassCustomResourceDefinition(crd) {
		return ""
	}
	switch crd.Spec.Scope {
	case apiextensionsv1.NamespaceScoped:
		return domainNamespaceCustom
	case apiextensionsv1.ClusterScoped:
		return domainClusterCustom
	default:
		return ""
	}
}

// SubscribeSelector registers a new subscriber for the supplied typed selector.
func (m *Manager) SubscribeSelector(selector StreamSelector) (*Subscription, error) {
	return m.streamHub().subscribe(selector)
}

// ResumeSelector returns buffered updates after the provided sequence token.
func (m *Manager) ResumeSelector(selector StreamSelector, since uint64) ([]Update, bool) {
	return m.streamHub().resume(selector, since)
}

func (m *Manager) handleConfigMap(obj interface{}, updateType MessageType) {
	cm := configMapFromObject(obj)
	if cm == nil {
		return
	}

	summary := configmap.BuildStreamSummary(m.clusterMeta, cm)
	ref := m.resourceRefForObject(cm, "", "v1", "ConfigMap", "configmaps")
	update := m.newObjectRowUpdate(updateType, domainNamespaceConfig, cm, ref, summary)

	m.broadcast(domainNamespaceConfig, scopesForNamespace(cm.Namespace), update)
	m.maybeBroadcastHelmRefreshFromConfigMap(cm, updateType)
}

func (m *Manager) handleConfigMapEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded:
		m.handleConfigMap(newObj, updateType)
	case MessageTypeDeleted:
		m.handleConfigMap(oldObj, updateType)
	case MessageTypeModified:
		m.handleConfigMap(newObj, updateType)
		oldCM := configMapFromObject(oldObj)
		newCM := configMapFromObject(newObj)
		if oldCM == nil || newCM == nil {
			return
		}
		if helmReleaseKeyForConfigMap(oldCM) != helmReleaseKeyForConfigMap(newCM) {
			m.maybeBroadcastHelmRefreshFromConfigMap(oldCM, MessageTypeDeleted)
		}
	}
}

func (m *Manager) handleSecret(obj interface{}, updateType MessageType) {
	secret := secretFromObject(obj)
	if secret == nil {
		return
	}

	summary := secretpkg.BuildStreamSummary(m.clusterMeta, secret)
	ref := m.resourceRefForObject(secret, "", "v1", "Secret", "secrets")
	update := m.newObjectRowUpdate(updateType, domainNamespaceConfig, secret, ref, summary)

	m.broadcast(domainNamespaceConfig, scopesForNamespace(secret.Namespace), update)
	m.maybeBroadcastHelmRefresh(secret, updateType)
}

func (m *Manager) handleSecretEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded:
		m.handleSecret(newObj, updateType)
	case MessageTypeDeleted:
		m.handleSecret(oldObj, updateType)
	case MessageTypeModified:
		m.handleSecret(newObj, updateType)
		oldSecret := secretFromObject(oldObj)
		newSecret := secretFromObject(newObj)
		if oldSecret == nil || newSecret == nil {
			return
		}
		if helmReleaseKeyForSecret(oldSecret) != helmReleaseKeyForSecret(newSecret) {
			m.maybeBroadcastHelmRefresh(oldSecret, MessageTypeDeleted)
		}
	}
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

func helmReleaseKeyForConfigMap(cm *corev1.ConfigMap) string {
	if cm == nil || !isHelmReleaseObject(cm.Name, cm.Labels, "") {
		return ""
	}
	return cm.Namespace + "/" + resourcemodel.HelmReleaseName(cm.Name)
}

func helmReleaseKeyForSecret(secret *corev1.Secret) string {
	if secret == nil || !isHelmReleaseObject(secret.Name, secret.Labels, string(secret.Type)) {
		return ""
	}
	return secret.Namespace + "/" + resourcemodel.HelmReleaseName(secret.Name)
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

	releaseName := resourcemodel.HelmReleaseName(name)
	ref := m.helmReleaseRef(namespace, releaseName)
	// COMPLETE is scope-level resync. Ref is carried as diagnostic context
	// so debugging can see which Helm release triggered the resync.
	update := Update{
		Type:            MessageTypeComplete,
		Domain:          domainNamespaceHelm,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: resourceVersion,
		Ref:             &ref,
		Error:           reason,
	}
	m.broadcast(domainNamespaceHelm, scopesForNamespace(namespace), update)
}

func (m *Manager) handleRole(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, rolepkg.BuildStreamSummary, "rbac.authorization.k8s.io", "v1", "Role", "roles", domainNamespaceRBAC, false)
}

func (m *Manager) handleRoleBinding(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, rolebinding.BuildStreamSummary, "rbac.authorization.k8s.io", "v1", "RoleBinding", "rolebindings", domainNamespaceRBAC, false)
}

func (m *Manager) handleServiceAccount(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, serviceaccount.BuildStreamSummary, "", "v1", "ServiceAccount", "serviceaccounts", domainNamespaceRBAC, false)
}

// Cluster RBAC updates target the cluster scope only.
func (m *Manager) handleClusterRole(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, clusterrole.BuildStreamSummary, "rbac.authorization.k8s.io", "v1", "ClusterRole", "clusterroles", domainClusterRBAC, true)
}

func (m *Manager) handleClusterRoleBinding(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, clusterrolebinding.BuildStreamSummary, "rbac.authorization.k8s.io", "v1", "ClusterRoleBinding", "clusterrolebindings", domainClusterRBAC, true)
}

func (m *Manager) handleService(obj interface{}, updateType MessageType) {
	service := serviceFromObject(obj)
	if service == nil {
		return
	}

	slices, err := m.listEndpointSlicesForService(service.Namespace, service.Name)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list endpoint slices for service %s/%s failed: %v", service.Namespace, service.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.resourceRefForObject(service, "", "v1", "Service", "services")
	update := m.newObjectRowUpdate(updateType, domainNamespaceNetwork, service, ref, servicepkg.BuildStreamSummary(m.clusterMeta, service, slices))

	m.broadcast(domainNamespaceNetwork, scopesForNamespace(service.Namespace), update)
}

func (m *Manager) handleEndpointSlice(obj interface{}, updateType MessageType) {
	slice := endpointSliceFromObject(obj)
	if slice == nil {
		return
	}
	serviceName := endpointSliceServiceName(slice)

	ref := m.resourceRefForObject(slice, "discovery.k8s.io", "v1", "EndpointSlice", "endpointslices")
	update := m.newObjectRowUpdate(updateType, domainNamespaceNetwork, slice, ref, endpointslice.BuildStreamSummary(m.clusterMeta, slice))
	m.broadcast(domainNamespaceNetwork, scopesForNamespace(slice.Namespace), update)

	m.broadcastServiceFromEndpointSlice(slice, serviceName)
}

func (m *Manager) handleEndpointSliceEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded:
		m.handleEndpointSlice(newObj, updateType)
	case MessageTypeDeleted:
		m.handleEndpointSlice(oldObj, updateType)
	case MessageTypeModified:
		m.handleEndpointSlice(newObj, updateType)
		oldSlice := endpointSliceFromObject(oldObj)
		newSlice := endpointSliceFromObject(newObj)
		if oldSlice == nil || newSlice == nil {
			return
		}
		oldService := endpointSliceServiceName(oldSlice)
		if oldSlice.Namespace != newSlice.Namespace || oldService != endpointSliceServiceName(newSlice) {
			m.broadcastServiceFromEndpointSlice(oldSlice, oldService)
		}
	}
}

func endpointSliceServiceName(slice *discoveryv1.EndpointSlice) string {
	if slice == nil || slice.Labels == nil {
		return ""
	}
	return strings.TrimSpace(slice.Labels[discoveryv1.LabelServiceName])
}

func (m *Manager) broadcastServiceFromEndpointSlice(slice *discoveryv1.EndpointSlice, serviceName string) {
	if m.serviceLister == nil || serviceName == "" {
		return
	}
	slices, err := m.listEndpointSlicesForService(slice.Namespace, serviceName)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list endpoint slices for service %s/%s failed: %v", slice.Namespace, serviceName, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}
	service, err := m.serviceLister.Services(slice.Namespace).Get(serviceName)
	if err != nil || service == nil {
		return
	}
	serviceSummary := servicepkg.BuildStreamSummary(m.clusterMeta, service, slices)
	ref := m.resourceRefForObject(service, "", "v1", "Service", "services")
	serviceUpdate := m.newObjectRowUpdate(MessageTypeModified, domainNamespaceNetwork, service, ref, serviceSummary)
	serviceUpdate.ResourceVersion = slice.ResourceVersion
	m.broadcast(domainNamespaceNetwork, scopesForNamespace(service.Namespace), serviceUpdate)
}

func (m *Manager) handleIngress(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, ingress.BuildStreamSummary, "networking.k8s.io", "v1", "Ingress", "ingresses", domainNamespaceNetwork, false)
}

func (m *Manager) handleNetworkPolicy(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, networkpolicy.BuildStreamSummary, "networking.k8s.io", "v1", "NetworkPolicy", "networkpolicies", domainNamespaceNetwork, false)
}

func (m *Manager) handleGateway(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, gateway.BuildStreamSummary, "gateway.networking.k8s.io", "v1", "Gateway", "gateways", domainNamespaceNetwork, false)
}

func (m *Manager) handleHTTPRoute(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, httproute.BuildStreamSummary, "gateway.networking.k8s.io", "v1", "HTTPRoute", "httproutes", domainNamespaceNetwork, false)
}

func (m *Manager) handleGRPCRoute(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, grpcroute.BuildStreamSummary, "gateway.networking.k8s.io", "v1", "GRPCRoute", "grpcroutes", domainNamespaceNetwork, false)
}

func (m *Manager) handleTLSRoute(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, tlsroute.BuildStreamSummary, "gateway.networking.k8s.io", "v1", "TLSRoute", "tlsroutes", domainNamespaceNetwork, false)
}

func (m *Manager) handleListenerSet(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, listenerset.BuildStreamSummary, "gateway.networking.k8s.io", "v1", "ListenerSet", "listenersets", domainNamespaceNetwork, false)
}

func (m *Manager) handleReferenceGrant(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, referencegrant.BuildStreamSummary, "gateway.networking.k8s.io", "v1", "ReferenceGrant", "referencegrants", domainNamespaceNetwork, false)
}

func (m *Manager) handleBackendTLSPolicy(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, backendtlspolicy.BuildStreamSummary, "gateway.networking.k8s.io", "v1", "BackendTLSPolicy", "backendtlspolicies", domainNamespaceNetwork, false)
}

// Cluster configuration updates stream shared cluster resources.
func (m *Manager) handleStorageClass(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, storageclass.BuildStreamSummary, "storage.k8s.io", "v1", "StorageClass", "storageclasses", domainClusterConfig, true)
}

func (m *Manager) handleIngressClass(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, ingressclass.BuildStreamSummary, "networking.k8s.io", "v1", "IngressClass", "ingressclasses", domainClusterConfig, true)
}

func (m *Manager) handleGatewayClass(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, gatewayclass.BuildStreamSummary, "gateway.networking.k8s.io", "v1", "GatewayClass", "gatewayclasses", domainClusterConfig, true)
}

func (m *Manager) handleValidatingWebhook(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, admission.BuildValidatingStreamSummary, "admissionregistration.k8s.io", "v1", "ValidatingWebhookConfiguration", "validatingwebhookconfigurations", domainClusterConfig, true)
}

func (m *Manager) handleMutatingWebhook(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, admission.BuildMutatingStreamSummary, "admissionregistration.k8s.io", "v1", "MutatingWebhookConfiguration", "mutatingwebhookconfigurations", domainClusterConfig, true)
}

func (m *Manager) handlePersistentVolumeClaim(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, persistentvolumeclaim.BuildStreamSummary, "", "v1", "PersistentVolumeClaim", "persistentvolumeclaims", domainNamespaceStorage, false)
}

// Persistent volumes belong to the cluster storage domain.
func (m *Manager) handlePersistentVolume(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, persistentvolume.BuildStreamSummary, "", "v1", "PersistentVolume", "persistentvolumes", domainClusterStorage, true)
}

func (m *Manager) handleHPA(obj interface{}, updateType MessageType) {
	hpa := hpaFromObject(obj)
	if hpa == nil {
		return
	}

	ref := m.resourceRefForObject(hpa, "autoscaling", "v1", "HorizontalPodAutoscaler", "horizontalpodautoscalers")
	update := m.newObjectRowUpdate(updateType, domainNamespaceAutoscaling, hpa, ref, hpapkg.BuildStreamSummary(m.clusterMeta, hpa))

	m.broadcast(domainNamespaceAutoscaling, scopesForNamespace(hpa.Namespace), update)
	m.handleWorkloadFromHPA(hpa, updateType)
}

func (m *Manager) handleHPAEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded:
		m.handleHPA(newObj, updateType)
	case MessageTypeDeleted:
		m.handleHPA(oldObj, updateType)
	case MessageTypeModified:
		m.handleHPA(newObj, updateType)
		oldHPA := hpaFromObject(oldObj)
		newHPA := hpaFromObject(newObj)
		if oldHPA == nil || newHPA == nil {
			return
		}
		if hpaWorkloadKey(oldHPA) != hpaWorkloadKey(newHPA) {
			m.handleWorkloadFromHPA(oldHPA, MessageTypeDeleted)
		}
	}
}

func (m *Manager) handleWorkloadFromHPA(hpa *autoscalingv1.HorizontalPodAutoscaler, updateType MessageType) {
	namespace, kind, name, ok := hpaWorkloadTarget(hpa)
	if !ok {
		return
	}
	hpas := m.hpasForWorkloadContext(namespace, hpa, updateType)
	if kind == "Pod" {
		m.broadcastStandalonePodWorkloadRow(namespace, name, hpa.ResourceVersion, hpas)
		return
	}
	m.broadcastWorkloadRow(kind, namespace, name, hpa.ResourceVersion, hpas)
}

func hpaWorkloadTarget(hpa *autoscalingv1.HorizontalPodAutoscaler) (namespace, kind, name string, ok bool) {
	if hpa == nil {
		return "", "", "", false
	}
	ref := hpa.Spec.ScaleTargetRef
	gvk := schema.FromAPIVersionAndKind(ref.APIVersion, ref.Kind)
	if gvk.Empty() || strings.TrimSpace(ref.Name) == "" {
		return "", "", "", false
	}
	switch {
	case gvk.Group == "apps" && gvk.Version == "v1" && (gvk.Kind == "Deployment" || gvk.Kind == "StatefulSet" || gvk.Kind == "DaemonSet"):
		return hpa.Namespace, gvk.Kind, ref.Name, true
	case gvk.Group == "batch" && gvk.Version == "v1" && (gvk.Kind == "Job" || gvk.Kind == "CronJob"):
		return hpa.Namespace, gvk.Kind, ref.Name, true
	case gvk.Group == "" && gvk.Version == "v1" && gvk.Kind == "Pod":
		return hpa.Namespace, gvk.Kind, ref.Name, true
	default:
		return "", "", "", false
	}
}

func hpaWorkloadKey(hpa *autoscalingv1.HorizontalPodAutoscaler) string {
	namespace, kind, name, ok := hpaWorkloadTarget(hpa)
	if !ok {
		return ""
	}
	return snapshot.WorkloadOwnerKey(kind, namespace, name)
}

func (m *Manager) handleResourceQuota(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, resourcequota.BuildStreamSummary, "", "v1", "ResourceQuota", "resourcequotas", domainNamespaceQuotas, false)
}

func (m *Manager) handleLimitRange(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, limitrange.BuildStreamSummary, "", "v1", "LimitRange", "limitranges", domainNamespaceQuotas, false)
}

func (m *Manager) handlePodDisruptionBudget(obj interface{}, updateType MessageType) {
	streamObjectRow(m, obj, updateType, poddisruptionbudget.BuildStreamSummary, "policy", "v1", "PodDisruptionBudget", "poddisruptionbudgets", domainNamespaceQuotas, false)
}

func (m *Manager) podMetricsSnapshot() map[string]metrics.PodUsage {
	if m.metrics == nil {
		return map[string]metrics.PodUsage{}
	}
	return m.metrics.LatestPodUsage()
}

func (m *Manager) nodeMetricsSnapshot() map[string]metrics.NodeUsage {
	if m.metrics == nil {
		return map[string]metrics.NodeUsage{}
	}
	return m.metrics.LatestNodeUsage()
}

func (m *Manager) broadcast(domain string, scopes []string, update Update) {
	m.streamHub().broadcast(domain, scopes, update)
}

func (m *Manager) prepareBroadcast(domain, scope string, update Update) (Update, []struct {
	id  uint64
	sub *subscription
}) {
	m.mu.Lock()
	defer m.mu.Unlock()

	scopedUpdate := update
	scopedUpdate.Scope = scope

	var scopeSubs map[uint64]*subscription
	if domainSubs, ok := m.subscribers[domain]; ok {
		scopeSubs = domainSubs[scope]
	}
	key := bufferKey(domain, scope)
	_, bufferExists := m.buffers[key]
	if len(scopeSubs) > 0 || bufferExists {
		// Buffer updates only when there are active or recent subscribers for this scope.
		sequence := m.nextSequenceLocked(domain, scope)
		scopedUpdate.Sequence = strconv.FormatUint(sequence, 10)
		buffer := m.bufferLocked(domain, scope)
		buffer.Add(bufferedUpdate{sequence: sequence, update: scopedUpdate})
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

	domainSubs, ok := m.subscribers[domain]
	if !ok {
		return
	}
	scopeSubs, ok := domainSubs[scope]
	if !ok {
		return
	}
	current, exists := scopeSubs[id]
	if !exists || current != sub {
		return
	}
	delete(scopeSubs, id)
	if len(scopeSubs) == 0 {
		delete(domainSubs, scope)
		m.clearScopeStateLocked(domain, scope)
	}
	if len(domainSubs) == 0 {
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

func (m *Manager) listHPAs(namespace string) ([]*autoscalingv1.HorizontalPodAutoscaler, error) {
	if m.hpaLister == nil {
		return nil, nil
	}
	if namespace == "" {
		return m.hpaLister.List(labels.Everything())
	}
	return m.hpaLister.HorizontalPodAutoscalers(namespace).List(labels.Everything())
}

func (m *Manager) hpasForWorkloadContext(
	namespace string,
	eventHPA *autoscalingv1.HorizontalPodAutoscaler,
	eventType MessageType,
) []*autoscalingv1.HorizontalPodAutoscaler {
	hpas, err := m.listHPAs(namespace)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list hpas for namespace %s failed: %v", namespace, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		hpas = nil
	}
	if eventHPA == nil {
		return hpas
	}

	filtered := make([]*autoscalingv1.HorizontalPodAutoscaler, 0, len(hpas)+1)
	found := false
	for _, hpa := range hpas {
		if hpa == nil {
			continue
		}
		same := hpa.UID == eventHPA.UID || (hpa.Namespace == eventHPA.Namespace && hpa.Name == eventHPA.Name)
		if same {
			found = true
			if eventType == MessageTypeDeleted {
				continue
			}
		}
		filtered = append(filtered, hpa)
	}
	if eventType != MessageTypeDeleted && !found {
		filtered = append(filtered, eventHPA)
	}
	return filtered
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

// The *FromObject decoders adapt the generic objectAs[T] (type assertion +
// delete-tombstone unwrap) to the ergonomic nil-returning form their call sites
// use — including dual-decode compares in the event/fanout handlers. The unwrap
// logic lives once in objectAs.
func replicaSetFromObject(obj interface{}) *appsv1.ReplicaSet {
	typed, _ := objectAs[*appsv1.ReplicaSet](obj)
	return typed
}

func customResourceDefinitionFromObject(obj interface{}) *apiextensionsv1.CustomResourceDefinition {
	typed, _ := objectAs[*apiextensionsv1.CustomResourceDefinition](obj)
	return typed
}

func customResourceFromObject(obj interface{}) *unstructured.Unstructured {
	typed, _ := objectAs[*unstructured.Unstructured](obj)
	return typed
}

func podFromObject(obj interface{}) *corev1.Pod {
	typed, _ := objectAs[*corev1.Pod](obj)
	return typed
}

func nodeFromObject(obj interface{}) *corev1.Node {
	typed, _ := objectAs[*corev1.Node](obj)
	return typed
}

func configMapFromObject(obj interface{}) *corev1.ConfigMap {
	typed, _ := objectAs[*corev1.ConfigMap](obj)
	return typed
}

func secretFromObject(obj interface{}) *corev1.Secret {
	typed, _ := objectAs[*corev1.Secret](obj)
	return typed
}

func serviceFromObject(obj interface{}) *corev1.Service {
	typed, _ := objectAs[*corev1.Service](obj)
	return typed
}

func endpointSliceFromObject(obj interface{}) *discoveryv1.EndpointSlice {
	typed, _ := objectAs[*discoveryv1.EndpointSlice](obj)
	return typed
}

func hpaFromObject(obj interface{}) *autoscalingv1.HorizontalPodAutoscaler {
	typed, _ := objectAs[*autoscalingv1.HorizontalPodAutoscaler](obj)
	return typed
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

func podOwnedByReplicaSet(pod *corev1.Pod, rs *appsv1.ReplicaSet) bool {
	if pod == nil || rs == nil || pod.Namespace != rs.Namespace || rs.Name == "" {
		return false
	}
	for _, owner := range pod.OwnerReferences {
		if owner.Controller != nil && *owner.Controller && owner.Kind == "ReplicaSet" && owner.Name == rs.Name {
			return true
		}
	}
	return false
}

func replicaSetStaleWorkloadScopes(oldRS *appsv1.ReplicaSet, newRS *appsv1.ReplicaSet) []string {
	oldScope := replicaSetWorkloadScope(oldRS)
	newScope := replicaSetWorkloadScope(newRS)
	if oldRS == nil && newRS != nil {
		oldScope = replicaSetFallbackWorkloadScope(newRS)
	}
	if oldRS != nil && newRS == nil {
		newScope = replicaSetFallbackWorkloadScope(oldRS)
	}
	if oldScope == "" || oldScope == newScope {
		return nil
	}
	return uniqueScopes([]string{oldScope})
}

func replicaSetWorkloadScope(rs *appsv1.ReplicaSet) string {
	if rs == nil {
		return ""
	}
	if ownerName := replicaSetDeploymentOwnerName(rs); ownerName != "" {
		return fmt.Sprintf("workload:%s:apps:v1:Deployment:%s", rs.Namespace, ownerName)
	}
	return replicaSetFallbackWorkloadScope(rs)
}

func replicaSetFallbackWorkloadScope(rs *appsv1.ReplicaSet) string {
	if rs == nil || rs.Name == "" {
		return ""
	}
	return fmt.Sprintf("workload:%s:apps:v1:ReplicaSet:%s", rs.Namespace, rs.Name)
}

func replicaSetDeploymentOwnerName(rs *appsv1.ReplicaSet) string {
	if rs == nil {
		return ""
	}
	for _, owner := range rs.OwnerReferences {
		if owner.Controller != nil && *owner.Controller && owner.Kind == "Deployment" && owner.Name != "" {
			return owner.Name
		}
	}
	return ""
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
		if scope := workloadScopeForOwner(summary.Namespace, summary.OwnerAPIVersion, summary.OwnerKind, summary.OwnerName); scope != "" {
			scopes = append(scopes, scope)
		}
	}
	return scopes
}

func workloadScopeForOwner(namespace, apiVersion, kind, name string) string {
	if namespace == "" || apiVersion == "" || kind == "" || name == "" {
		return ""
	}
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil || gv.Version == "" {
		return ""
	}
	return fmt.Sprintf("workload:%s:%s:%s:%s:%s", namespace, gv.Group, gv.Version, kind, name)
}

func stalePodScopes(oldSummary snapshot.PodSummary, newSummary snapshot.PodSummary) []string {
	newScopes := make(map[string]struct{})
	for _, scope := range scopesForPod(newSummary) {
		newScopes[scope] = struct{}{}
	}
	stale := make([]string, 0)
	for _, scope := range scopesForPod(oldSummary) {
		if _, ok := newScopes[scope]; !ok {
			stale = append(stale, scope)
		}
	}
	return uniqueScopes(stale)
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
	return strings.HasPrefix(name, resourcemodel.HelmReleaseNamePrefix)
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
