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
	autoscalinglisters "k8s.io/client-go/listers/autoscaling/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	discoverylisters "k8s.io/client-go/listers/discovery/v1"
	networklisters "k8s.io/client-go/listers/networking/v1"
	"k8s.io/client-go/tools/cache"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
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
	if mgr.canListWatch("autoscaling", "horizontalpodautoscalers") {
		mgr.hpaLister = shared.Autoscaling().V1().HorizontalPodAutoscalers().Lister()
	}

	mgr.registerPodStreams(factory)
	mgr.registerConfigStreams(factory)
	mgr.registerNetworkStreams(factory)
	mgr.registerStorageStreams(factory)
	mgr.registerAutoscalingStreams(factory)
	mgr.registerNodeStreams(factory)
	mgr.registerWorkloadStreams(factory)
	mgr.registerRBACStreams(factory)
	mgr.registerQuotaStreams(factory)
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
	for key, informer := range m.customInformers {
		informer.stop()
		delete(m.customInformers, key)
	}
}

func (m *Manager) logWarn(message string) {
	if m == nil || m.logger == nil {
		return
	}
	m.logger.Warn(message, logsources.ResourceStream, m.clusterMeta.ClusterID, m.clusterMeta.ClusterName)
}

func (m *Manager) logInfo(message string) {
	if m == nil || m.logger == nil {
		return
	}
	m.logger.Info(message, logsources.ResourceStream, m.clusterMeta.ClusterID, m.clusterMeta.ClusterName)
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
			row = snapshot.BuildClusterCustomSummary(m.clusterMeta, resource, info.gvr.Group, info.gvr.Version, info.kind, crdName)
		} else {
			// The streaming path has no parent scope concept — fall back
			// to the resource's own namespace (which is almost always
			// set for anything that reaches an informer).
			row = snapshot.BuildNamespaceCustomSummary(m.clusterMeta, resource, info.gvr.Group, info.gvr.Version, info.kind, crdName, resource.GetNamespace())
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
	update := m.newObjectRowUpdate(updateType, domainClusterCRDs, crd, ref, snapshot.BuildClusterCRDSummary(m.clusterMeta, crd))

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
	if m == nil {
		return nil, errors.New("resource stream not initialised")
	}
	if selector.ClusterID != "" && selector.ClusterID != m.clusterMeta.ClusterID {
		return nil, errors.New("cluster mismatch")
	}
	domain := selector.Domain
	normalized := selector.CanonicalScope()
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
		m.logWarn(err.Error())
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

// ResumeSelector returns buffered updates after the provided sequence token.
func (m *Manager) ResumeSelector(selector StreamSelector, since uint64) ([]Update, bool) {
	if m == nil || since == 0 {
		return nil, false
	}
	if selector.ClusterID != "" && selector.ClusterID != m.clusterMeta.ClusterID {
		return nil, false
	}
	key := bufferKey(selector.Domain, selector.CanonicalScope())
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
	m.broadcastPodRow(pod, updateType, nil, podUsage)

	m.handleWorkloadFromPod(pod, updateType, podUsage)
	m.handleNodeFromPod(pod)
}

func (m *Manager) broadcastPodRow(
	pod *corev1.Pod,
	updateType MessageType,
	scopes []string,
	podUsage map[string]metrics.PodUsage,
) {
	if pod == nil {
		return
	}
	summary := snapshot.BuildPodSummary(m.clusterMeta, pod, podUsage, m.rsLister)
	ref := m.resourceRefForObject(pod, "", "v1", "Pod", "pods")
	update := m.newObjectRowUpdate(updateType, domainPods, pod, ref, summary)
	if len(scopes) == 0 {
		scopes = scopesForPod(summary)
	}

	m.broadcast(domainPods, scopes, update)
}

func (m *Manager) handlePodEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded:
		m.handlePod(newObj, updateType)
	case MessageTypeDeleted:
		m.handlePod(oldObj, updateType)
	case MessageTypeModified:
		m.handlePod(newObj, updateType)
		oldPod := podFromObject(oldObj)
		newPod := podFromObject(newObj)
		if oldPod == nil || newPod == nil {
			return
		}
		podUsage := m.podMetricsSnapshot()
		oldSummary := snapshot.BuildPodSummary(m.clusterMeta, oldPod, podUsage, m.rsLister)
		newSummary := snapshot.BuildPodSummary(m.clusterMeta, newPod, podUsage, m.rsLister)
		if staleScopes := stalePodScopes(oldSummary, newSummary); len(staleScopes) > 0 {
			m.broadcastPodRow(oldPod, MessageTypeDeleted, staleScopes, podUsage)
		}
		if snapshot.WorkloadOwnerKeyForPod(oldPod) != snapshot.WorkloadOwnerKeyForPod(newPod) {
			m.handleWorkloadFromPod(oldPod, MessageTypeModified, podUsage)
		}
		if oldPod.Spec.NodeName != "" && oldPod.Spec.NodeName != newPod.Spec.NodeName {
			m.handleNodeFromPod(oldPod)
		}
	}
}

func (m *Manager) handleReplicaSetEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded:
		newRS := replicaSetFromObject(newObj)
		m.refreshPodsForReplicaSet(newRS, replicaSetStaleWorkloadScopes(nil, newRS))
	case MessageTypeDeleted:
		oldRS := replicaSetFromObject(oldObj)
		m.refreshPodsForReplicaSet(oldRS, replicaSetStaleWorkloadScopes(oldRS, nil))
	case MessageTypeModified:
		oldRS := replicaSetFromObject(oldObj)
		newRS := replicaSetFromObject(newObj)
		staleScopes := replicaSetStaleWorkloadScopes(oldRS, newRS)
		seen := make(map[string]struct{})
		m.refreshPodsForReplicaSetOnce(oldRS, staleScopes, seen)
		m.refreshPodsForReplicaSetOnce(newRS, staleScopes, seen)
	}
}

func (m *Manager) refreshPodsForReplicaSet(rs *appsv1.ReplicaSet, staleScopes []string) {
	m.refreshPodsForReplicaSetOnce(rs, staleScopes, make(map[string]struct{}))
}

func (m *Manager) refreshPodsForReplicaSetOnce(
	rs *appsv1.ReplicaSet,
	staleScopes []string,
	seen map[string]struct{},
) {
	if rs == nil || m.podLister == nil {
		return
	}
	pods, err := m.podLister.Pods(rs.Namespace).List(labels.Everything())
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for replicaset %s/%s failed: %v", rs.Namespace, rs.Name, err))
		return
	}
	podUsage := m.podMetricsSnapshot()
	for _, pod := range pods {
		if !podOwnedByReplicaSet(pod, rs) {
			continue
		}
		key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		if len(staleScopes) > 0 {
			m.broadcastPodRow(pod, MessageTypeDeleted, staleScopes, podUsage)
		}
		m.broadcastPodRow(pod, MessageTypeModified, nil, podUsage)
	}
}

func (m *Manager) handleConfigMap(obj interface{}, updateType MessageType) {
	cm := configMapFromObject(obj)
	if cm == nil {
		return
	}

	summary := snapshot.BuildConfigMapSummary(m.clusterMeta, cm)
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

	summary := snapshot.BuildSecretSummary(m.clusterMeta, secret)
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
	return cm.Namespace + "/" + helmReleaseName(cm.Name)
}

func helmReleaseKeyForSecret(secret *corev1.Secret) string {
	if secret == nil || !isHelmReleaseObject(secret.Name, secret.Labels, string(secret.Type)) {
		return ""
	}
	return secret.Namespace + "/" + helmReleaseName(secret.Name)
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
	role := roleFromObject(obj)
	if role == nil {
		return
	}

	summary := snapshot.BuildRoleSummary(m.clusterMeta, role)
	ref := m.resourceRefForObject(role, "rbac.authorization.k8s.io", "v1", "Role", "roles")
	update := m.newObjectRowUpdate(updateType, domainNamespaceRBAC, role, ref, summary)

	m.broadcast(domainNamespaceRBAC, scopesForNamespace(role.Namespace), update)
}

func (m *Manager) handleRoleBinding(obj interface{}, updateType MessageType) {
	binding := roleBindingFromObject(obj)
	if binding == nil {
		return
	}

	summary := snapshot.BuildRoleBindingSummary(m.clusterMeta, binding)
	ref := m.resourceRefForObject(binding, "rbac.authorization.k8s.io", "v1", "RoleBinding", "rolebindings")
	update := m.newObjectRowUpdate(updateType, domainNamespaceRBAC, binding, ref, summary)

	m.broadcast(domainNamespaceRBAC, scopesForNamespace(binding.Namespace), update)
}

func (m *Manager) handleServiceAccount(obj interface{}, updateType MessageType) {
	serviceAccount := serviceAccountFromObject(obj)
	if serviceAccount == nil {
		return
	}

	summary := snapshot.BuildServiceAccountSummary(m.clusterMeta, serviceAccount)
	ref := m.resourceRefForObject(serviceAccount, "", "v1", "ServiceAccount", "serviceaccounts")
	update := m.newObjectRowUpdate(updateType, domainNamespaceRBAC, serviceAccount, ref, summary)

	m.broadcast(domainNamespaceRBAC, scopesForNamespace(serviceAccount.Namespace), update)
}

// Cluster RBAC updates target the cluster scope only.
func (m *Manager) handleClusterRole(obj interface{}, updateType MessageType) {
	role := clusterRoleFromObject(obj)
	if role == nil {
		return
	}

	summary := snapshot.BuildClusterRoleSummary(m.clusterMeta, role)
	ref := m.resourceRefForObject(role, "rbac.authorization.k8s.io", "v1", "ClusterRole", "clusterroles")
	update := m.newObjectRowUpdate(updateType, domainClusterRBAC, role, ref, summary)

	m.broadcast(domainClusterRBAC, scopesForCluster(), update)
}

func (m *Manager) handleClusterRoleBinding(obj interface{}, updateType MessageType) {
	binding := clusterRoleBindingFromObject(obj)
	if binding == nil {
		return
	}

	summary := snapshot.BuildClusterRoleBindingSummary(m.clusterMeta, binding)
	ref := m.resourceRefForObject(binding, "rbac.authorization.k8s.io", "v1", "ClusterRoleBinding", "clusterrolebindings")
	update := m.newObjectRowUpdate(updateType, domainClusterRBAC, binding, ref, summary)

	m.broadcast(domainClusterRBAC, scopesForCluster(), update)
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
	update := m.newObjectRowUpdate(updateType, domainNamespaceNetwork, service, ref, snapshot.BuildServiceNetworkSummary(m.clusterMeta, service, slices))

	m.broadcast(domainNamespaceNetwork, scopesForNamespace(service.Namespace), update)
}

func (m *Manager) handleEndpointSlice(obj interface{}, updateType MessageType) {
	slice := endpointSliceFromObject(obj)
	if slice == nil {
		return
	}
	serviceName := endpointSliceServiceName(slice)

	ref := m.resourceRefForObject(slice, "discovery.k8s.io", "v1", "EndpointSlice", "endpointslices")
	update := m.newObjectRowUpdate(updateType, domainNamespaceNetwork, slice, ref, snapshot.BuildEndpointSliceSummary(m.clusterMeta, slice))
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
	serviceSummary := snapshot.BuildServiceNetworkSummary(m.clusterMeta, service, slices)
	ref := m.resourceRefForObject(service, "", "v1", "Service", "services")
	serviceUpdate := m.newObjectRowUpdate(MessageTypeModified, domainNamespaceNetwork, service, ref, serviceSummary)
	serviceUpdate.ResourceVersion = slice.ResourceVersion
	m.broadcast(domainNamespaceNetwork, scopesForNamespace(service.Namespace), serviceUpdate)
}

func (m *Manager) handleIngress(obj interface{}, updateType MessageType) {
	ingress := ingressFromObject(obj)
	if ingress == nil {
		return
	}

	ref := m.resourceRefForObject(ingress, "networking.k8s.io", "v1", "Ingress", "ingresses")
	update := m.newObjectRowUpdate(updateType, domainNamespaceNetwork, ingress, ref, snapshot.BuildIngressNetworkSummary(m.clusterMeta, ingress))

	m.broadcast(domainNamespaceNetwork, scopesForNamespace(ingress.Namespace), update)
}

func (m *Manager) handleNetworkPolicy(obj interface{}, updateType MessageType) {
	policy := networkPolicyFromObject(obj)
	if policy == nil {
		return
	}

	ref := m.resourceRefForObject(policy, "networking.k8s.io", "v1", "NetworkPolicy", "networkpolicies")
	update := m.newObjectRowUpdate(updateType, domainNamespaceNetwork, policy, ref, snapshot.BuildNetworkPolicySummary(m.clusterMeta, policy))

	m.broadcast(domainNamespaceNetwork, scopesForNamespace(policy.Namespace), update)
}

func (m *Manager) handleGateway(obj interface{}, updateType MessageType) {
	item := gatewayFromObject(obj)
	if item == nil {
		return
	}
	m.broadcastGatewayNetworkUpdate(updateType, item, "Gateway", "gateways", snapshot.BuildGatewayNetworkSummary(m.clusterMeta, item))
}

func (m *Manager) handleHTTPRoute(obj interface{}, updateType MessageType) {
	item := httpRouteFromObject(obj)
	if item == nil {
		return
	}
	m.broadcastGatewayNetworkUpdate(updateType, item, "HTTPRoute", "httproutes", snapshot.BuildHTTPRouteNetworkSummary(m.clusterMeta, item))
}

func (m *Manager) handleGRPCRoute(obj interface{}, updateType MessageType) {
	item := grpcRouteFromObject(obj)
	if item == nil {
		return
	}
	m.broadcastGatewayNetworkUpdate(updateType, item, "GRPCRoute", "grpcroutes", snapshot.BuildGRPCRouteNetworkSummary(m.clusterMeta, item))
}

func (m *Manager) handleTLSRoute(obj interface{}, updateType MessageType) {
	item := tlsRouteFromObject(obj)
	if item == nil {
		return
	}
	m.broadcastGatewayNetworkUpdate(updateType, item, "TLSRoute", "tlsroutes", snapshot.BuildTLSRouteNetworkSummary(m.clusterMeta, item))
}

func (m *Manager) handleListenerSet(obj interface{}, updateType MessageType) {
	item := listenerSetFromObject(obj)
	if item == nil {
		return
	}
	m.broadcastGatewayNetworkUpdate(updateType, item, "ListenerSet", "listenersets", snapshot.BuildListenerSetNetworkSummary(m.clusterMeta, item))
}

func (m *Manager) handleReferenceGrant(obj interface{}, updateType MessageType) {
	item := referenceGrantFromObject(obj)
	if item == nil {
		return
	}
	m.broadcastGatewayNetworkUpdate(updateType, item, "ReferenceGrant", "referencegrants", snapshot.BuildReferenceGrantNetworkSummary(m.clusterMeta, item))
}

func (m *Manager) handleBackendTLSPolicy(obj interface{}, updateType MessageType) {
	item := backendTLSPolicyFromObject(obj)
	if item == nil {
		return
	}
	m.broadcastGatewayNetworkUpdate(updateType, item, "BackendTLSPolicy", "backendtlspolicies", snapshot.BuildBackendTLSPolicyNetworkSummary(m.clusterMeta, item))
}

func (m *Manager) broadcastGatewayNetworkUpdate(updateType MessageType, obj metav1.Object, kind, resource string, row snapshot.NetworkSummary) {
	ref := m.resourceRefForObject(obj, "gateway.networking.k8s.io", "v1", kind, resource)
	update := m.newObjectRowUpdate(updateType, domainNamespaceNetwork, obj, ref, row)
	m.broadcast(domainNamespaceNetwork, scopesForNamespace(obj.GetNamespace()), update)
}

// Cluster configuration updates stream shared cluster resources.
func (m *Manager) handleStorageClass(obj interface{}, updateType MessageType) {
	storageClass := storageClassFromObject(obj)
	if storageClass == nil {
		return
	}

	summary := snapshot.BuildClusterStorageClassSummary(m.clusterMeta, storageClass)
	ref := m.resourceRefForObject(storageClass, "storage.k8s.io", "v1", "StorageClass", "storageclasses")
	update := m.newObjectRowUpdate(updateType, domainClusterConfig, storageClass, ref, summary)

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handleIngressClass(obj interface{}, updateType MessageType) {
	ingressClass := ingressClassFromObject(obj)
	if ingressClass == nil {
		return
	}

	summary := snapshot.BuildClusterIngressClassSummary(m.clusterMeta, ingressClass)
	ref := m.resourceRefForObject(ingressClass, "networking.k8s.io", "v1", "IngressClass", "ingressclasses")
	update := m.newObjectRowUpdate(updateType, domainClusterConfig, ingressClass, ref, summary)

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handleGatewayClass(obj interface{}, updateType MessageType) {
	gatewayClass := gatewayClassFromObject(obj)
	if gatewayClass == nil {
		return
	}

	summary := snapshot.BuildClusterGatewayClassSummary(m.clusterMeta, gatewayClass)
	ref := m.resourceRefForObject(gatewayClass, "gateway.networking.k8s.io", "v1", "GatewayClass", "gatewayclasses")
	update := m.newObjectRowUpdate(updateType, domainClusterConfig, gatewayClass, ref, summary)

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handleValidatingWebhook(obj interface{}, updateType MessageType) {
	webhook := validatingWebhookFromObject(obj)
	if webhook == nil {
		return
	}

	summary := snapshot.BuildClusterValidatingWebhookSummary(m.clusterMeta, webhook)
	ref := m.resourceRefForObject(webhook, "admissionregistration.k8s.io", "v1", "ValidatingWebhookConfiguration", "validatingwebhookconfigurations")
	update := m.newObjectRowUpdate(updateType, domainClusterConfig, webhook, ref, summary)

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handleMutatingWebhook(obj interface{}, updateType MessageType) {
	webhook := mutatingWebhookFromObject(obj)
	if webhook == nil {
		return
	}

	summary := snapshot.BuildClusterMutatingWebhookSummary(m.clusterMeta, webhook)
	ref := m.resourceRefForObject(webhook, "admissionregistration.k8s.io", "v1", "MutatingWebhookConfiguration", "mutatingwebhookconfigurations")
	update := m.newObjectRowUpdate(updateType, domainClusterConfig, webhook, ref, summary)

	m.broadcast(domainClusterConfig, scopesForCluster(), update)
}

func (m *Manager) handlePersistentVolumeClaim(obj interface{}, updateType MessageType) {
	pvc := persistentVolumeClaimFromObject(obj)
	if pvc == nil {
		return
	}

	ref := m.resourceRefForObject(pvc, "", "v1", "PersistentVolumeClaim", "persistentvolumeclaims")
	update := m.newObjectRowUpdate(updateType, domainNamespaceStorage, pvc, ref, snapshot.BuildPVCStorageSummary(m.clusterMeta, pvc))

	m.broadcast(domainNamespaceStorage, scopesForNamespace(pvc.Namespace), update)
}

// Persistent volumes belong to the cluster storage domain.
func (m *Manager) handlePersistentVolume(obj interface{}, updateType MessageType) {
	pv := persistentVolumeFromObject(obj)
	if pv == nil {
		return
	}

	summary := snapshot.BuildClusterStorageSummary(m.clusterMeta, pv)
	ref := m.resourceRefForObject(pv, "", "v1", "PersistentVolume", "persistentvolumes")
	update := m.newObjectRowUpdate(updateType, domainClusterStorage, pv, ref, summary)

	m.broadcast(domainClusterStorage, scopesForCluster(), update)
}

func (m *Manager) handleHPA(obj interface{}, updateType MessageType) {
	hpa := hpaFromObject(obj)
	if hpa == nil {
		return
	}

	ref := m.resourceRefForObject(hpa, "autoscaling", "v1", "HorizontalPodAutoscaler", "horizontalpodautoscalers")
	update := m.newObjectRowUpdate(updateType, domainNamespaceAutoscaling, hpa, ref, snapshot.BuildHPASummary(m.clusterMeta, hpa))

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
	quota := resourceQuotaFromObject(obj)
	if quota == nil {
		return
	}

	summary := snapshot.BuildResourceQuotaSummary(m.clusterMeta, quota)
	ref := m.resourceRefForObject(quota, "", "v1", "ResourceQuota", "resourcequotas")
	update := m.newObjectRowUpdate(updateType, domainNamespaceQuotas, quota, ref, summary)

	m.broadcast(domainNamespaceQuotas, scopesForNamespace(quota.Namespace), update)
}

func (m *Manager) handleLimitRange(obj interface{}, updateType MessageType) {
	limit := limitRangeFromObject(obj)
	if limit == nil {
		return
	}

	summary := snapshot.BuildLimitRangeSummary(m.clusterMeta, limit)
	ref := m.resourceRefForObject(limit, "", "v1", "LimitRange", "limitranges")
	update := m.newObjectRowUpdate(updateType, domainNamespaceQuotas, limit, ref, summary)

	m.broadcast(domainNamespaceQuotas, scopesForNamespace(limit.Namespace), update)
}

func (m *Manager) handlePodDisruptionBudget(obj interface{}, updateType MessageType) {
	pdb := podDisruptionBudgetFromObject(obj)
	if pdb == nil {
		return
	}

	summary := snapshot.BuildPodDisruptionBudgetSummary(m.clusterMeta, pdb)
	ref := m.resourceRefForObject(pdb, "policy", "v1", "PodDisruptionBudget", "poddisruptionbudgets")
	update := m.newObjectRowUpdate(updateType, domainNamespaceQuotas, pdb, ref, summary)

	m.broadcast(domainNamespaceQuotas, scopesForNamespace(pdb.Namespace), update)
}

func (m *Manager) handleNode(obj interface{}, updateType MessageType) {
	node := nodeFromObject(obj)
	if node == nil {
		return
	}
	pods, err := m.podsForNode(node.Name)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for node %s failed: %v", node.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	summary, err := snapshot.BuildNodeSummary(m.clusterMeta, node, pods, m.nodeMetricsSnapshot(), m.podMetricsSnapshot())
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build node summary for %s failed: %v", node.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.resourceRefForObject(node, "", "v1", "Node", "nodes")
	update := m.newObjectRowUpdate(updateType, domainNodes, node, ref, summary)

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
		m.logWarn(fmt.Sprintf("resource stream: list pods for workload %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	podUsage := m.podMetricsSnapshot()
	hpas := m.hpasForWorkloadContext(namespace, nil, updateType)
	summary, err := snapshot.BuildWorkloadSummary(m.clusterMeta, workload, pods, podUsage, hpas...)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build workload summary for %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.workloadRef(workload, kind)
	update := m.newObjectRowUpdate(updateType, domainWorkloads, workload, ref, summary)

	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) workloadRef(workload metav1.Object, kind string) resourcemodel.ResourceRef {
	switch workload.(type) {
	case *appsv1.Deployment:
		return m.resourceRefForObject(workload, "apps", "v1", "Deployment", "deployments")
	case *appsv1.StatefulSet:
		return m.resourceRefForObject(workload, "apps", "v1", "StatefulSet", "statefulsets")
	case *appsv1.DaemonSet:
		return m.resourceRefForObject(workload, "apps", "v1", "DaemonSet", "daemonsets")
	case *batchv1.Job:
		return m.resourceRefForObject(workload, "batch", "v1", "Job", "jobs")
	case *batchv1.CronJob:
		return m.resourceRefForObject(workload, "batch", "v1", "CronJob", "cronjobs")
	default:
		return m.resourceRefForObject(workload, "", "", kind, "")
	}
}

func (m *Manager) handleWorkloadFromPod(pod *corev1.Pod, updateType MessageType, usage map[string]metrics.PodUsage) {
	if pod == nil {
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
		m.logWarn(fmt.Sprintf("resource stream: list pods for workload %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	hpas := m.hpasForWorkloadContext(namespace, nil, updateType)
	summary, err := snapshot.BuildWorkloadSummary(m.clusterMeta, workload, pods, usage, hpas...)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build workload summary for %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.workloadRef(workload, kind)
	update := m.newObjectRowUpdate(MessageTypeModified, domainWorkloads, workload, ref, summary)
	update.ResourceVersion = pod.ResourceVersion
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) broadcastWorkloadRow(kind, namespace, name, resourceVersion string, hpas []*autoscalingv1.HorizontalPodAutoscaler) {
	workload, err := m.lookupWorkload(kind, namespace, name)
	if err != nil || workload == nil {
		return
	}
	ownerKey := snapshot.WorkloadOwnerKey(kind, namespace, name)
	pods, err := m.podsForWorkload(namespace, ownerKey)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for workload %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}
	summary, err := snapshot.BuildWorkloadSummary(m.clusterMeta, workload, pods, m.podMetricsSnapshot(), hpas...)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build workload summary for %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}
	ref := m.workloadRef(workload, kind)
	update := m.newObjectRowUpdate(MessageTypeModified, domainWorkloads, workload, ref, summary)
	update.ResourceVersion = resourceVersion
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) broadcastStandalonePodWorkloadRow(namespace, name, resourceVersion string, hpas []*autoscalingv1.HorizontalPodAutoscaler) {
	if m.podLister == nil {
		return
	}
	pod, err := m.podLister.Pods(namespace).Get(name)
	if err != nil || pod == nil {
		return
	}
	summary := snapshot.BuildStandalonePodWorkloadSummary(m.clusterMeta, pod, m.podMetricsSnapshot(), hpas...)
	ref := m.resourceRefForObject(pod, "", "v1", "Pod", "pods")
	update := m.newObjectRowUpdate(MessageTypeModified, domainWorkloads, pod, ref, summary)
	update.ResourceVersion = resourceVersion
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) handleStandalonePodWorkload(pod *corev1.Pod, updateType MessageType, usage map[string]metrics.PodUsage) {
	if pod == nil {
		return
	}
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		updateType = MessageTypeDeleted
	}

	hpas := m.hpasForWorkloadContext(pod.Namespace, nil, updateType)
	summary := snapshot.BuildStandalonePodWorkloadSummary(m.clusterMeta, pod, usage, hpas...)
	ref := m.resourceRefForObject(pod, "", "v1", "Pod", "pods")
	update := m.newObjectRowUpdate(updateType, domainWorkloads, pod, ref, summary)

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
			m.logWarn(fmt.Sprintf("resource stream: resolve node %s failed: %v", pod.Spec.NodeName, err))
			if m.telemetry != nil {
				m.telemetry.RecordStreamError(telemetry.StreamResources, err)
			}
		}
		return
	}

	// Pod changes affect node summaries (pod counts, restarts, and metrics usage).
	pods, err := m.podsForNode(node.Name)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for node %s failed: %v", node.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}
	summary, err := snapshot.BuildNodeSummary(m.clusterMeta, node, pods, m.nodeMetricsSnapshot(), m.podMetricsSnapshot())
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build node summary for %s failed: %v", node.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.resourceRefForObject(node, "", "v1", "Node", "nodes")
	update := m.newObjectRowUpdate(MessageTypeModified, domainNodes, node, ref, summary)
	m.broadcast(domainNodes, []string{""}, update)
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
			m.logInfo(fmt.Sprintf("resource stream: cleaned up %d closed subscribers for %s/%s", closedCount, domain, scope))
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

func replicaSetFromObject(obj interface{}) *appsv1.ReplicaSet {
	switch typed := obj.(type) {
	case *appsv1.ReplicaSet:
		return typed
	case cache.DeletedFinalStateUnknown:
		return replicaSetFromObject(typed.Obj)
	default:
		return nil
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

func gatewayClassFromObject(obj interface{}) *gatewayv1.GatewayClass {
	switch typed := obj.(type) {
	case *gatewayv1.GatewayClass:
		return typed
	case cache.DeletedFinalStateUnknown:
		return gatewayClassFromObject(typed.Obj)
	default:
		return nil
	}
}

func gatewayFromObject(obj interface{}) *gatewayv1.Gateway {
	switch typed := obj.(type) {
	case *gatewayv1.Gateway:
		return typed
	case cache.DeletedFinalStateUnknown:
		return gatewayFromObject(typed.Obj)
	default:
		return nil
	}
}

func httpRouteFromObject(obj interface{}) *gatewayv1.HTTPRoute {
	switch typed := obj.(type) {
	case *gatewayv1.HTTPRoute:
		return typed
	case cache.DeletedFinalStateUnknown:
		return httpRouteFromObject(typed.Obj)
	default:
		return nil
	}
}

func grpcRouteFromObject(obj interface{}) *gatewayv1.GRPCRoute {
	switch typed := obj.(type) {
	case *gatewayv1.GRPCRoute:
		return typed
	case cache.DeletedFinalStateUnknown:
		return grpcRouteFromObject(typed.Obj)
	default:
		return nil
	}
}

func tlsRouteFromObject(obj interface{}) *gatewayv1.TLSRoute {
	switch typed := obj.(type) {
	case *gatewayv1.TLSRoute:
		return typed
	case cache.DeletedFinalStateUnknown:
		return tlsRouteFromObject(typed.Obj)
	default:
		return nil
	}
}

func listenerSetFromObject(obj interface{}) *gatewayv1.ListenerSet {
	switch typed := obj.(type) {
	case *gatewayv1.ListenerSet:
		return typed
	case cache.DeletedFinalStateUnknown:
		return listenerSetFromObject(typed.Obj)
	default:
		return nil
	}
}

func referenceGrantFromObject(obj interface{}) *gatewayv1.ReferenceGrant {
	switch typed := obj.(type) {
	case *gatewayv1.ReferenceGrant:
		return typed
	case cache.DeletedFinalStateUnknown:
		return referenceGrantFromObject(typed.Obj)
	default:
		return nil
	}
}

func backendTLSPolicyFromObject(obj interface{}) *gatewayv1.BackendTLSPolicy {
	switch typed := obj.(type) {
	case *gatewayv1.BackendTLSPolicy:
		return typed
	case cache.DeletedFinalStateUnknown:
		return backendTLSPolicyFromObject(typed.Obj)
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
