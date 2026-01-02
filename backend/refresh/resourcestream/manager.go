package resourcestream

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	appslisters "k8s.io/client-go/listers/apps/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	maxSubscribersPerScope = 100
	subscriberBufferSize   = 256
	podNodeIndexName       = "pods:node"
)

const (
	domainPods            = "pods"
	domainWorkloads       = "namespace-workloads"
	domainNamespaceConfig = "namespace-config"
	domainNamespaceRBAC   = "namespace-rbac"
	domainNamespaceQuotas = "namespace-quotas"
	domainNodes           = "nodes"
)

type subscription struct {
	ch      chan Update
	drops   chan DropReason
	created time.Time
	once    sync.Once
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

type permissionChecker interface {
	CanListResource(group, resource string) (bool, error)
	CanWatchResource(group, resource string) (bool, error)
}

// Manager fan-outs informer updates to websocket subscribers.
type Manager struct {
	clusterMeta snapshot.ClusterMeta
	metrics     metrics.Provider
	logger      logstream.Logger
	telemetry   *telemetry.Recorder
	permissions permissionChecker

	podLister        corelisters.PodLister
	podIndexer       cache.Indexer
	nodeLister       corelisters.NodeLister
	rsLister         appslisters.ReplicaSetLister
	deploymentLister appslisters.DeploymentLister
	statefulLister   appslisters.StatefulSetLister
	daemonLister     appslisters.DaemonSetLister
	jobLister        batchlisters.JobLister
	cronJobLister    batchlisters.CronJobLister

	mu          sync.RWMutex
	subscribers map[string]map[string]map[uint64]*subscription
	nextID      uint64
}

// NewManager wires informer handlers into a resource stream manager.
func NewManager(factory *informer.Factory, provider metrics.Provider, logger logstream.Logger, recorder *telemetry.Recorder, meta snapshot.ClusterMeta) *Manager {
	if logger == nil {
		logger = noopLogger{}
	}
	mgr := &Manager{
		clusterMeta: meta,
		metrics:     provider,
		logger:      logger,
		telemetry:   recorder,
		permissions: factory,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	if factory == nil {
		return mgr
	}

	shared := factory.SharedInformerFactory()
	if shared == nil {
		return mgr
	}

	podInformer := shared.Core().V1().Pods()
	mgr.podLister = podInformer.Lister()
	mgr.podIndexer = podInformer.Informer().GetIndexer()
	podInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handlePod(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handlePod(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handlePod(obj, MessageTypeDeleted) },
	})

	configMapInformer := shared.Core().V1().ConfigMaps()
	configMapInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleConfigMap(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleConfigMap(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleConfigMap(obj, MessageTypeDeleted) },
	})

	secretInformer := shared.Core().V1().Secrets()
	secretInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleSecret(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleSecret(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleSecret(obj, MessageTypeDeleted) },
	})

	nodeInformer := shared.Core().V1().Nodes()
	mgr.nodeLister = nodeInformer.Lister()
	nodeInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleNode(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleNode(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleNode(obj, MessageTypeDeleted) },
	})

	rsInformer := shared.Apps().V1().ReplicaSets()
	mgr.rsLister = rsInformer.Lister()

	deploymentInformer := shared.Apps().V1().Deployments()
	mgr.deploymentLister = deploymentInformer.Lister()
	deploymentInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
	})

	statefulInformer := shared.Apps().V1().StatefulSets()
	mgr.statefulLister = statefulInformer.Lister()
	statefulInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
	})

	daemonInformer := shared.Apps().V1().DaemonSets()
	mgr.daemonLister = daemonInformer.Lister()
	daemonInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
	})

	jobInformer := shared.Batch().V1().Jobs()
	mgr.jobLister = jobInformer.Lister()
	jobInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
	})

	cronInformer := shared.Batch().V1().CronJobs()
	mgr.cronJobLister = cronInformer.Lister()
	cronInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleWorkload(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleWorkload(obj, MessageTypeDeleted) },
	})

	roleInformer := shared.Rbac().V1().Roles()
	roleInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleRole(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleRole(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleRole(obj, MessageTypeDeleted) },
	})

	bindingInformer := shared.Rbac().V1().RoleBindings()
	bindingInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleRoleBinding(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleRoleBinding(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleRoleBinding(obj, MessageTypeDeleted) },
	})

	serviceAccountInformer := shared.Core().V1().ServiceAccounts()
	serviceAccountInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleServiceAccount(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleServiceAccount(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleServiceAccount(obj, MessageTypeDeleted) },
	})

	resourceQuotaInformer := shared.Core().V1().ResourceQuotas()
	resourceQuotaInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleResourceQuota(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleResourceQuota(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleResourceQuota(obj, MessageTypeDeleted) },
	})

	limitRangeInformer := shared.Core().V1().LimitRanges()
	limitRangeInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handleLimitRange(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handleLimitRange(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handleLimitRange(obj, MessageTypeDeleted) },
	})

	pdbInformer := shared.Policy().V1().PodDisruptionBudgets()
	pdbInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { mgr.handlePodDisruptionBudget(obj, MessageTypeAdded) },
		UpdateFunc: func(_, newObj interface{}) { mgr.handlePodDisruptionBudget(newObj, MessageTypeModified) },
		DeleteFunc: func(obj interface{}) { mgr.handlePodDisruptionBudget(obj, MessageTypeDeleted) },
	})

	return mgr
}

// Subscribe registers a new subscriber for the supplied domain/scope.
func (m *Manager) Subscribe(domain, scope string) (*Subscription, error) {
	if m == nil {
		return nil, errors.New("resource stream not initialised")
	}
	if err := m.checkDomainPermissions(domain); err != nil {
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return nil, err
	}

	normalized, err := normalizeScopeForDomain(domain, scope)
	if err != nil {
		return nil, err
	}

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
	if len(subs) >= maxSubscribersPerScope {
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
		ch:      make(chan Update, subscriberBufferSize),
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

	// Fan-out updates per scope and drop subscribers that fall behind to force resyncs.
	for _, scope := range uniqueScopes(scopes) {
		delivered := 0
		dropped := 0
		closedCount := 0

		items := m.snapshotSubscribers(domain, scope)
		for _, item := range items {
			update.Scope = scope
			sent, closed := m.trySend(item.sub, update)
			if closed {
				closedCount++
				go m.dropSubscriber(domain, scope, item.id, item.sub, DropReasonClosed)
				continue
			}
			if sent {
				delivered++
				continue
			}
			dropped++
			go m.dropSubscriber(domain, scope, item.id, item.sub, DropReasonBackpressure)
		}

		if m.telemetry != nil {
			m.telemetry.RecordStreamDelivery(telemetry.StreamResources, delivered, dropped)
			if dropped > 0 {
				m.telemetry.RecordStreamError(
					telemetry.StreamResources,
					fmt.Errorf("resource stream backlog dropped %d subscriber(s) for %s/%s", dropped, domain, scope),
				)
			}
		}
		if closedCount > 0 {
			m.logger.Info(fmt.Sprintf("resource stream: cleaned up %d closed subscribers for %s/%s", closedCount, domain, scope), "ResourceStream")
		}
	}
}

func (m *Manager) snapshotSubscribers(domain, scope string) []struct {
	id  uint64
	sub *subscription
} {
	m.mu.RLock()
	defer m.mu.RUnlock()
	scopeSubs := m.subscribers[domain][scope]
	if len(scopeSubs) == 0 {
		return nil
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
	return items
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
	}
	if len(m.subscribers[domain]) == 0 {
		delete(m.subscribers, domain)
	}
	sub.close(reason)
}

func (m *Manager) trySend(sub *subscription, update Update) (sent bool, closed bool) {
	defer func() {
		if r := recover(); r != nil {
			closed = true
			sent = false
		}
	}()
	select {
	case sub.ch <- update:
		return true, false
	default:
		return false, false
	}
}

func (m *Manager) checkDomainPermissions(domain string) error {
	if m.permissions == nil {
		return nil
	}

	required, ok := domainPermissions(domain)
	if !ok {
		return fmt.Errorf("unsupported resource stream domain %q", domain)
	}

	for _, perm := range required {
		if err := m.checkPermission(perm.group, perm.resource); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) checkPermission(group, resource string) error {
	listAllowed, listErr := m.permissions.CanListResource(group, resource)
	watchAllowed, watchErr := m.permissions.CanWatchResource(group, resource)
	if listErr != nil || watchErr != nil {
		return fmt.Errorf("resource stream permission check failed for %s/%s: %v %v", group, resource, listErr, watchErr)
	}
	if !listAllowed || !watchAllowed {
		return fmt.Errorf("resource stream permission denied for %s/%s", group, resource)
	}
	return nil
}

func domainPermissions(domain string) ([]permissionRequirement, bool) {
	switch domain {
	case domainPods:
		return []permissionRequirement{{group: "", resource: "pods"}}, true
	case domainNamespaceConfig:
		return []permissionRequirement{
			{group: "", resource: "configmaps"},
			{group: "", resource: "secrets"},
		}, true
	case domainNamespaceRBAC:
		return []permissionRequirement{
			{group: "rbac.authorization.k8s.io", resource: "roles"},
			{group: "rbac.authorization.k8s.io", resource: "rolebindings"},
			{group: "", resource: "serviceaccounts"},
		}, true
	case domainNamespaceQuotas:
		return []permissionRequirement{
			{group: "", resource: "resourcequotas"},
			{group: "", resource: "limitranges"},
			{group: "policy", resource: "poddisruptionbudgets"},
		}, true
	case domainNodes:
		return []permissionRequirement{{group: "", resource: "nodes"}}, true
	case domainWorkloads:
		return []permissionRequirement{
			{group: "", resource: "pods"},
			{group: "apps", resource: "deployments"},
			{group: "apps", resource: "statefulsets"},
			{group: "apps", resource: "daemonsets"},
			{group: "batch", resource: "jobs"},
			{group: "batch", resource: "cronjobs"},
		}, true
	default:
		return nil, false
	}
}

type permissionRequirement struct {
	group    string
	resource string
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
