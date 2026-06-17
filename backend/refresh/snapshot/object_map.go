// Package snapshot builds refresh-domain payloads, including the object-map
// relationship graph.
package snapshot

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	gatewaypkg "github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/replicaset"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	appslisters "k8s.io/client-go/listers/apps/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	discoverylisters "k8s.io/client-go/listers/discovery/v1"
	networklisters "k8s.io/client-go/listers/networking/v1"
	policylisters "k8s.io/client-go/listers/policy/v1"
	rbaclisters "k8s.io/client-go/listers/rbac/v1"
	storagelisters "k8s.io/client-go/listers/storage/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
)

const (
	objectMapDomain       = "object-map"
	defaultObjectMapDepth = 4
	defaultObjectMapNodes = 250
	maxObjectMapDepth     = 12
	maxObjectMapNodes     = 1000
)

// ObjectMapReference is the canonical identity for a graph node.
type ObjectMapReference struct {
	ClusterID   string `json:"clusterId"`
	ClusterName string `json:"clusterName,omitempty"`
	Group       string `json:"group"`
	Version     string `json:"version"`
	Kind        string `json:"kind"`
	Resource    string `json:"resource,omitempty"`
	Namespace   string `json:"namespace,omitempty"`
	Name        string `json:"name"`
	UID         string `json:"uid,omitempty"`
}

// ObjectMapNode is one Kubernetes object in the relationship graph.
type ObjectMapNode struct {
	ID                string                `json:"id"`
	Depth             int                   `json:"depth"`
	Ref               ObjectMapReference    `json:"ref"`
	CreationTimestamp string                `json:"creationTimestamp,omitempty"`
	Status            *ObjectMapStatus      `json:"status,omitempty"`
	ActionFacts       *ObjectMapActionFacts `json:"actionFacts,omitempty"`
}

// ObjectMapActionFacts carries the state needed to present context-menu
// actions without deriving meaning from missing graph edges.
type ObjectMapActionFacts struct {
	Status               string `json:"status,omitempty"`
	Unschedulable        *bool  `json:"unschedulable,omitempty"`
	PortForwardAvailable *bool  `json:"portForwardAvailable,omitempty"`
	HPAManaged           *bool  `json:"hpaManaged,omitempty"`
	DesiredReplicas      *int32 `json:"desiredReplicas,omitempty"`
}

// ObjectMapStatus is a compact card-level status indicator. State is the source
// status value selected by the resource-specific status builder. Presentation is
// the backend-selected rendering token for migrated resources that need one.
// ObjectMapStatus aliases the neutral objectmap.Status so per-kind packages can
// produce it without importing snapshot.
type ObjectMapStatus = objectmap.Status

// ObjectMapEdge captures a directed relationship between two graph nodes.
type ObjectMapEdge struct {
	ID       string `json:"id"`
	Source   string `json:"source"`
	Target   string `json:"target"`
	Type     string `json:"type"`
	Label    string `json:"label"`
	TracedBy string `json:"tracedBy,omitempty"`
}

// ObjectMapSnapshotPayload is returned by the object-map refresh domain.
type ObjectMapSnapshotPayload struct {
	ClusterMeta
	Seed      ObjectMapReference `json:"seed"`
	Nodes     []ObjectMapNode    `json:"nodes"`
	Edges     []ObjectMapEdge    `json:"edges"`
	MaxDepth  int                `json:"maxDepth"`
	MaxNodes  int                `json:"maxNodes"`
	Truncated bool               `json:"truncated"`
	Warnings  []string           `json:"warnings,omitempty"`
}

// objectMapPermissionChecker reports whether the current cluster credentials may
// list+watch a resource. *informer.Factory satisfies it. object-map uses it to
// skip resources the user cannot see (matching the old live-list Forbidden skip)
// and to avoid lazily registering an unstarted informer for a denied
// cluster-scoped type.
type objectMapPermissionChecker interface {
	CanListWatch(group, resource string) bool
}

type objectMapBuilder struct {
	client          kubernetes.Interface
	gatewayClient   gatewayversioned.Interface
	gatewayPresence objectMapGatewayPresence
	catalogService  func() *objectcatalog.Service
	// shared supplies typed listers backed by the factory's already-synced
	// informer caches, so the graph is assembled from memory instead of ~21 live
	// cluster-wide LIST calls per refresh.
	shared      informers.SharedInformerFactory
	permissions objectMapPermissionChecker
}

// objectMapTypedSource carries everything collectTyped needs for one build: the
// informer-backed listers, the permission gate, and (for the autoscaling/v2 HPA
// path, which has no matching v2 informer) the live client.
type objectMapTypedSource struct {
	ctx         context.Context
	client      kubernetes.Interface
	shared      informers.SharedInformerFactory
	permissions objectMapPermissionChecker
}

func (s objectMapTypedSource) allowed(group, resource string) bool {
	return s.permissions == nil || s.permissions.CanListWatch(group, resource)
}

type objectMapGatewayPresence interface {
	Has(kind string) bool
}

type objectMapScopeKind int

const (
	objectMapScopeObject objectMapScopeKind = iota
	objectMapScopeNamespace
)

type objectMapOptions struct {
	scopeKind objectMapScopeKind
	identity  scopeObjectIdentity
	namespace string
	maxDepth  int
	maxNodes  int
}

type objectMapRecord struct {
	ref               ObjectMapReference
	obj               metav1.Object
	creationTimestamp string
	status            *ObjectMapStatus
	actionFacts       *ObjectMapActionFacts
	owners            []metav1.OwnerReference
	labels            map[string]string
	pod               *corev1.Pod
	service           *corev1.Service
	slice             *discoveryv1.EndpointSlice
	pvc               *corev1.PersistentVolumeClaim
	pv                *corev1.PersistentVolume
	storage           *storagev1.StorageClass
	ingress           *networkingv1.Ingress
	ingClass          *networkingv1.IngressClass
	pdb               *policyv1.PodDisruptionBudget
	networkPolicy     *networkingv1.NetworkPolicy
	clusterRole       *rbacv1.ClusterRole
	template          *corev1.PodTemplateSpec
	cronJobTpl        *corev1.PodTemplateSpec
}

type objectMapIndex struct {
	meta       ClusterMeta
	records    map[string]*objectMapRecord
	byUID      map[string]*objectMapRecord
	byIdent    map[string]*objectMapRecord
	warnings   []string
	listErrors []string
	hpaListed  bool
}

type objectMapGraph struct {
	nodes     map[string]ObjectMapNode
	edges     map[string]ObjectMapEdge
	adjacency map[string][]objectMapTraversalEdge
	truncated bool
}

type objectMapTraversalEdge struct {
	edgeID  string
	reverse bool
}

type objectMapTraversalDirection int

const (
	objectMapTraversalForward objectMapTraversalDirection = iota
	objectMapTraversalBackward
)

// RegisterObjectMapDomain wires the backend relationship graph domain into the registry.
func RegisterObjectMapDomain(
	reg *domain.Registry,
	client kubernetes.Interface,
	shared informers.SharedInformerFactory,
	permissions objectMapPermissionChecker,
	gatewayClient gatewayversioned.Interface,
	gatewayPresence objectMapGatewayPresence,
	catalogService func() *objectcatalog.Service,
) error {
	if client == nil {
		return fmt.Errorf("kubernetes client is required for object map domain")
	}
	if shared == nil {
		return fmt.Errorf("shared informer factory is required for object map domain")
	}
	builder := &objectMapBuilder{
		client:          client,
		gatewayClient:   gatewayClient,
		gatewayPresence: gatewayPresence,
		catalogService:  catalogService,
		shared:          shared,
		permissions:     permissions,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          objectMapDomain,
		BuildSnapshot: builder.Build,
	})
}

func (b *objectMapBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	opts, err := parseObjectMapScope(scope)
	if err != nil {
		return nil, err
	}
	if opts.scopeKind == objectMapScopeNamespace {
		return b.buildNamespace(ctx, scope, opts)
	}
	if opts.identity.GVK.Group == "" && opts.identity.GVK.Version == "" {
		return nil, fmt.Errorf("object-map scope for %s/%s is missing group/version", opts.identity.GVK.Kind, opts.identity.Name)
	}

	assembler, err := b.newObjectMapAssembler(ctx)
	if err != nil {
		return nil, err
	}
	return assembler.buildObjectSnapshot(scope, opts)
}

func (b *objectMapBuilder) buildNamespace(ctx context.Context, scope string, opts objectMapOptions) (*refresh.Snapshot, error) {
	assembler, err := b.newObjectMapAssembler(ctx)
	if err != nil {
		return nil, err
	}
	return assembler.buildNamespaceSnapshot(scope, opts)
}

func (b *objectMapBuilder) catalog() *objectcatalog.Service {
	if b == nil || b.catalogService == nil {
		return nil
	}
	return b.catalogService()
}

func parseObjectMapScope(scope string) (objectMapOptions, error) {
	objectScope, rawQuery, hasQuery := strings.Cut(scope, "?")
	opts := objectMapOptions{
		scopeKind: objectMapScopeObject,
		maxDepth:  defaultObjectMapDepth,
		maxNodes:  defaultObjectMapNodes,
	}
	_, trimmedScope := refresh.SplitClusterScope(objectScope)
	if namespace, ok := parseObjectMapNamespaceScope(trimmedScope); ok {
		opts.scopeKind = objectMapScopeNamespace
		opts.namespace = namespace
	} else {
		identity, err := parseObjectScope(objectScope)
		if err != nil {
			return objectMapOptions{}, err
		}
		opts.identity = identity
	}
	if !hasQuery {
		return opts, nil
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return objectMapOptions{}, err
	}
	opts.maxDepth = parseBoundedInt(values.Get("maxDepth"), defaultObjectMapDepth, 0, maxObjectMapDepth)
	opts.maxNodes = parseBoundedInt(values.Get("maxNodes"), defaultObjectMapNodes, 1, maxObjectMapNodes)
	return opts, nil
}

func parseObjectMapNamespaceScope(scope string) (string, bool) {
	trimmed := strings.TrimSpace(scope)
	prefix := "namespace:"
	if !strings.HasPrefix(strings.ToLower(trimmed), prefix) {
		return "", false
	}
	namespace := strings.TrimSpace(trimmed[len(prefix):])
	if namespace == "" {
		return "", false
	}
	return namespace, true
}

func parseBoundedInt(raw string, fallback, minValue, maxValue int) int {
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	if parsed < minValue {
		return minValue
	}
	if parsed > maxValue {
		return maxValue
	}
	return parsed
}

func newObjectMapIndex(meta ClusterMeta) *objectMapIndex {
	return &objectMapIndex{
		meta:    meta,
		records: make(map[string]*objectMapRecord),
		byUID:   make(map[string]*objectMapRecord),
		byIdent: make(map[string]*objectMapRecord),
	}
}

func (idx *objectMapIndex) addCatalog(svc *objectcatalog.Service) {
	if idx == nil || svc == nil {
		return
	}
	for _, item := range svc.Snapshot() {
		idx.addRecord(&objectMapRecord{
			ref:               refFromCatalog(item),
			creationTimestamp: item.CreationTimestamp,
		})
	}
}

func (idx *objectMapIndex) collectTyped(src objectMapTypedSource) {
	if idx == nil || src.shared == nil {
		return
	}
	// Each collector reads from the factory's already-synced informer cache. The
	// permission gate skips resources the user cannot list+watch — preserving the
	// old live-list Forbidden skip and, for cluster-scoped types, avoiding a blind
	// .Lister() that would lazily register an unstarted informer. HPA has no
	// matching v2 informer, so it stays a live LIST via src.client.
	collectors := []struct {
		group, resource string
		collect         func()
	}{
		{"", "pods", func() { idx.collectPods(src.shared.Core().V1().Pods().Lister()) }},
		{"", "services", func() { idx.collectServices(src.shared.Core().V1().Services().Lister()) }},
		{"discovery.k8s.io", "endpointslices", func() { idx.collectEndpointSlices(src.shared.Discovery().V1().EndpointSlices().Lister()) }},
		{"", "persistentvolumeclaims", func() { idx.collectPVCs(src.shared.Core().V1().PersistentVolumeClaims().Lister()) }},
		{"", "persistentvolumes", func() { idx.collectPVs(src.shared.Core().V1().PersistentVolumes().Lister()) }},
		{"storage.k8s.io", "storageclasses", func() { idx.collectStorageClasses(src.shared.Storage().V1().StorageClasses().Lister()) }},
		{"", "configmaps", func() { idx.collectConfigMaps(src.shared.Core().V1().ConfigMaps().Lister()) }},
		{"", "secrets", func() { idx.collectSecrets(src.shared.Core().V1().Secrets().Lister()) }},
		{"", "serviceaccounts", func() { idx.collectServiceAccounts(src.shared.Core().V1().ServiceAccounts().Lister()) }},
		{"", "nodes", func() { idx.collectNodes(src.shared.Core().V1().Nodes().Lister()) }},
		{"apps", "deployments", func() { idx.collectDeployments(src.shared.Apps().V1().Deployments().Lister()) }},
		{"apps", "replicasets", func() { idx.collectReplicaSets(src.shared.Apps().V1().ReplicaSets().Lister()) }},
		{"apps", "statefulsets", func() { idx.collectStatefulSets(src.shared.Apps().V1().StatefulSets().Lister()) }},
		{"apps", "daemonsets", func() { idx.collectDaemonSets(src.shared.Apps().V1().DaemonSets().Lister()) }},
		{"batch", "jobs", func() { idx.collectJobs(src.shared.Batch().V1().Jobs().Lister()) }},
		{"batch", "cronjobs", func() { idx.collectCronJobs(src.shared.Batch().V1().CronJobs().Lister()) }},
		{"autoscaling", "horizontalpodautoscalers", func() { idx.collectHPAs(src.ctx, src.client) }},
		{"policy", "poddisruptionbudgets", func() { idx.collectPodDisruptionBudgets(src.shared.Policy().V1().PodDisruptionBudgets().Lister()) }},
		{"networking.k8s.io", "networkpolicies", func() { idx.collectNetworkPolicies(src.shared.Networking().V1().NetworkPolicies().Lister()) }},
		{"networking.k8s.io", "ingresses", func() { idx.collectIngresses(src.shared.Networking().V1().Ingresses().Lister()) }},
		{"networking.k8s.io", "ingressclasses", func() { idx.collectIngressClasses(src.shared.Networking().V1().IngressClasses().Lister()) }},
		{"rbac.authorization.k8s.io", "clusterroles", func() { idx.collectClusterRoles(src.shared.Rbac().V1().ClusterRoles().Lister()) }},
		{"rbac.authorization.k8s.io", "clusterrolebindings", func() { idx.collectClusterRoleBindings(src.shared.Rbac().V1().ClusterRoleBindings().Lister()) }},
	}
	for _, c := range collectors {
		if !src.allowed(c.group, c.resource) {
			idx.warnSkippedPermission(c.resource)
			continue
		}
		c.collect()
		if idx.hasListError() {
			return
		}
	}
}

func (idx *objectMapIndex) warnSkippedPermission(resource string) {
	idx.warnings = append(idx.warnings, fmt.Sprintf("skipped %s: insufficient permissions", resource))
}

func (idx *objectMapIndex) collectGatewayTyped(ctx context.Context, client gatewayversioned.Interface, presence objectMapGatewayPresence) {
	if idx == nil || client == nil {
		return
	}
	if gatewayKindPresent(presence, "GatewayClass") {
		idx.collectGatewayClasses(ctx, client)
	}
	if idx.hasListError() {
		return
	}
	if gatewayKindPresent(presence, "Gateway") {
		idx.collectGateways(ctx, client)
	}
	if idx.hasListError() {
		return
	}
	if gatewayKindPresent(presence, "HTTPRoute") {
		idx.collectHTTPRoutes(ctx, client)
	}
	if idx.hasListError() {
		return
	}
	if gatewayKindPresent(presence, "GRPCRoute") {
		idx.collectGRPCRoutes(ctx, client)
	}
	if idx.hasListError() {
		return
	}
	if gatewayKindPresent(presence, "TLSRoute") {
		idx.collectTLSRoutes(ctx, client)
	}
	if idx.hasListError() {
		return
	}
	if gatewayKindPresent(presence, "ListenerSet") {
		idx.collectListenerSets(ctx, client)
	}
	if idx.hasListError() {
		return
	}
	if gatewayKindPresent(presence, "ReferenceGrant") {
		idx.collectReferenceGrants(ctx, client)
	}
	if idx.hasListError() {
		return
	}
	if gatewayKindPresent(presence, "BackendTLSPolicy") {
		idx.collectBackendTLSPolicies(ctx, client)
	}
}

func gatewayKindPresent(presence objectMapGatewayPresence, kind string) bool {
	return presence == nil || presence.Has(kind)
}

// collectKind is the shared body for the typed object-map collectors. It lists, applies
// the list-error/permission skip, and builds the record fields every kind has in common
// (ref, creation timestamp, owners, labels). The per-kind fill closure sets only what
// genuinely differs — the status projection, optional action facts, and the typed record
// field the relationship resolver reads. group/version/kind/resource give record identity.
func collectKind[T metav1.Object](
	idx *objectMapIndex,
	group, version, kind, resource string,
	list func() ([]T, error),
	fill func(T, *objectMapRecord),
) {
	items, err := list()
	if idx.skipListError(resource, err) {
		return
	}
	for _, item := range items {
		rec := &objectMapRecord{
			ref:               refFromObject(item, group, version, kind, resource, item.GetNamespace()),
			obj:               item,
			creationTimestamp: objectCreationTimestamp(item),
			owners:            item.GetOwnerReferences(),
			labels:            cloneStringMap(item.GetLabels()),
		}
		fill(item, rec)
		idx.addRecord(rec)
	}
}

// ptrsOf returns pointers into items. Gateway-API collectors list value slices
// (list.Items) but the relationship resolver stores per-object pointers, so this adapts
// them for collectKind. The pointers index into items, which the caller owns.
func ptrsOf[T any](items []T) []*T {
	out := make([]*T, len(items))
	for i := range items {
		out[i] = &items[i]
	}
	return out
}

func (idx *objectMapIndex) collectPods(lister corelisters.PodLister) {
	collectKind(idx, "", "v1", "Pod", "pods",
		func() ([]*corev1.Pod, error) { return lister.List(labels.Everything()) },
		func(pod *corev1.Pod, rec *objectMapRecord) {
			rec.status = podres.ObjectMapStatus(idx.meta.ClusterID, *pod)
			rec.actionFacts = objectMapPortForwardFacts(hasForwardablePodPorts(pod))
			rec.pod = pod
		})
}

func (idx *objectMapIndex) collectServices(lister corelisters.ServiceLister) {
	collectKind(idx, "", "v1", "Service", "services",
		func() ([]*corev1.Service, error) { return lister.List(labels.Everything()) },
		func(svc *corev1.Service, rec *objectMapRecord) {
			rec.status = service.ObjectMapStatus(idx.meta.ClusterID, *svc)
			rec.actionFacts = objectMapPortForwardFacts(common.ServiceHasForwardablePorts(svc.Spec.Ports))
			rec.service = svc
		})
}

func (idx *objectMapIndex) collectEndpointSlices(lister discoverylisters.EndpointSliceLister) {
	collectKind(idx, "discovery.k8s.io", "v1", "EndpointSlice", "endpointslices",
		func() ([]*discoveryv1.EndpointSlice, error) { return lister.List(labels.Everything()) },
		func(slice *discoveryv1.EndpointSlice, rec *objectMapRecord) {
			rec.status = endpointslice.ObjectMapStatus(idx.meta.ClusterID, *slice)
			rec.slice = slice
		})
}

func (idx *objectMapIndex) collectPVCs(lister corelisters.PersistentVolumeClaimLister) {
	collectKind(idx, "", "v1", "PersistentVolumeClaim", "persistentvolumeclaims",
		func() ([]*corev1.PersistentVolumeClaim, error) { return lister.List(labels.Everything()) },
		func(pvc *corev1.PersistentVolumeClaim, rec *objectMapRecord) {
			rec.status = persistentvolumeclaim.ObjectMapStatus(idx.meta.ClusterID, *pvc)
			rec.pvc = pvc
		})
}

func (idx *objectMapIndex) collectPVs(lister corelisters.PersistentVolumeLister) {
	collectKind(idx, "", "v1", "PersistentVolume", "persistentvolumes",
		func() ([]*corev1.PersistentVolume, error) { return lister.List(labels.Everything()) },
		func(pv *corev1.PersistentVolume, rec *objectMapRecord) {
			rec.status = persistentvolume.ObjectMapStatus(idx.meta.ClusterID, *pv)
			rec.pv = pv
		})
}

func (idx *objectMapIndex) collectStorageClasses(lister storagelisters.StorageClassLister) {
	collectKind(idx, "storage.k8s.io", "v1", "StorageClass", "storageclasses",
		func() ([]*storagev1.StorageClass, error) { return lister.List(labels.Everything()) },
		func(sc *storagev1.StorageClass, rec *objectMapRecord) {
			rec.status = storageclass.ObjectMapStatus(idx.meta.ClusterID, *sc)
			rec.storage = sc
		})
}

func (idx *objectMapIndex) collectConfigMaps(lister corelisters.ConfigMapLister) {
	collectKind(idx, "", "v1", "ConfigMap", "configmaps",
		func() ([]*corev1.ConfigMap, error) { return lister.List(labels.Everything()) },
		func(cm *corev1.ConfigMap, rec *objectMapRecord) {
			rec.status = configmap.ObjectMapStatus(idx.meta.ClusterID, *cm)
		})
}

func (idx *objectMapIndex) collectSecrets(lister corelisters.SecretLister) {
	collectKind(idx, "", "v1", "Secret", "secrets",
		func() ([]*corev1.Secret, error) { return lister.List(labels.Everything()) },
		func(secret *corev1.Secret, rec *objectMapRecord) {
			rec.status = secretpkg.ObjectMapStatus(idx.meta.ClusterID, *secret)
		})
}

func (idx *objectMapIndex) collectServiceAccounts(lister corelisters.ServiceAccountLister) {
	collectKind(idx, "", "v1", "ServiceAccount", "serviceaccounts",
		func() ([]*corev1.ServiceAccount, error) { return lister.List(labels.Everything()) },
		func(sa *corev1.ServiceAccount, rec *objectMapRecord) {
			rec.status = serviceaccount.ObjectMapStatus(idx.meta.ClusterID, *sa)
		})
}

func (idx *objectMapIndex) collectNodes(lister corelisters.NodeLister) {
	collectKind(idx, "", "v1", "Node", "nodes",
		func() ([]*corev1.Node, error) { return lister.List(labels.Everything()) },
		func(node *corev1.Node, rec *objectMapRecord) {
			rec.status = nodes.ObjectMapStatus(idx.meta.ClusterID, *node)
			rec.actionFacts = objectMapNodeActionFacts(node.Spec.Unschedulable)
		})
}

func (idx *objectMapIndex) collectDeployments(lister appslisters.DeploymentLister) {
	collectKind(idx, "apps", "v1", "Deployment", "deployments",
		func() ([]*appsv1.Deployment, error) { return lister.List(labels.Everything()) },
		func(deploy *appsv1.Deployment, rec *objectMapRecord) {
			rec.status = deployment.ObjectMapStatus(idx.meta.ClusterID, *deploy)
			rec.actionFacts = objectMapScalableWorkloadFacts(deploy.Spec.Replicas, common.HasForwardableContainerPorts(deploy.Spec.Template.Spec.Containers))
			rec.template = &deploy.Spec.Template
		})
}

func (idx *objectMapIndex) collectReplicaSets(lister appslisters.ReplicaSetLister) {
	collectKind(idx, "apps", "v1", "ReplicaSet", "replicasets",
		func() ([]*appsv1.ReplicaSet, error) { return lister.List(labels.Everything()) },
		func(rs *appsv1.ReplicaSet, rec *objectMapRecord) {
			rec.status = replicaset.ObjectMapStatus(idx.meta.ClusterID, *rs)
			rec.actionFacts = objectMapScalableWorkloadFacts(rs.Spec.Replicas, common.HasForwardableContainerPorts(rs.Spec.Template.Spec.Containers))
			rec.template = &rs.Spec.Template
		})
}

func (idx *objectMapIndex) collectStatefulSets(lister appslisters.StatefulSetLister) {
	collectKind(idx, "apps", "v1", "StatefulSet", "statefulsets",
		func() ([]*appsv1.StatefulSet, error) { return lister.List(labels.Everything()) },
		func(sts *appsv1.StatefulSet, rec *objectMapRecord) {
			rec.status = statefulset.ObjectMapStatus(idx.meta.ClusterID, *sts)
			rec.actionFacts = objectMapScalableWorkloadFacts(sts.Spec.Replicas, common.HasForwardableContainerPorts(sts.Spec.Template.Spec.Containers))
			rec.template = &sts.Spec.Template
		})
}

func (idx *objectMapIndex) collectDaemonSets(lister appslisters.DaemonSetLister) {
	collectKind(idx, "apps", "v1", "DaemonSet", "daemonsets",
		func() ([]*appsv1.DaemonSet, error) { return lister.List(labels.Everything()) },
		func(ds *appsv1.DaemonSet, rec *objectMapRecord) {
			rec.status = daemonset.ObjectMapStatus(idx.meta.ClusterID, *ds)
			rec.actionFacts = objectMapPortForwardFacts(common.HasForwardableContainerPorts(ds.Spec.Template.Spec.Containers))
			rec.template = &ds.Spec.Template
		})
}

func (idx *objectMapIndex) collectJobs(lister batchlisters.JobLister) {
	collectKind(idx, "batch", "v1", "Job", "jobs",
		func() ([]*batchv1.Job, error) { return lister.List(labels.Everything()) },
		func(job *batchv1.Job, rec *objectMapRecord) {
			rec.status = jobres.ObjectMapStatus(idx.meta.ClusterID, *job)
			rec.actionFacts = objectMapPortForwardFacts(common.HasForwardableContainerPorts(job.Spec.Template.Spec.Containers))
			rec.template = job.Spec.Template.DeepCopy()
		})
}

func (idx *objectMapIndex) collectCronJobs(lister batchlisters.CronJobLister) {
	collectKind(idx, "batch", "v1", "CronJob", "cronjobs",
		func() ([]*batchv1.CronJob, error) { return lister.List(labels.Everything()) },
		func(cron *batchv1.CronJob, rec *objectMapRecord) {
			rec.status = cronjob.ObjectMapStatus(idx.meta.ClusterID, *cron)
			rec.actionFacts = objectMapCronJobActionFacts(*cron)
			rec.cronJobTpl = cron.Spec.JobTemplate.Spec.Template.DeepCopy()
		})
}

// collectHPAs is the one typed collector that still issues a live LIST: the shared
// factory caches autoscaling/v1, but object-map needs the v2 shape, so there is no
// matching informer to read from.
func (idx *objectMapIndex) collectHPAs(ctx context.Context, client kubernetes.Interface) {
	if client == nil {
		return
	}
	list, err := client.AutoscalingV2().HorizontalPodAutoscalers(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("horizontalpodautoscalers", err) {
		return
	}
	idx.hpaListed = true
	for i := range list.Items {
		hpa := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&hpa.ObjectMeta, "autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", hpa.Namespace),
			obj:               &hpa,
			creationTimestamp: objectCreationTimestamp(&hpa.ObjectMeta),
			status:            hpapkg.ObjectMapStatus(idx.meta.ClusterID, hpa),
			owners:            hpa.OwnerReferences,
			labels:            cloneStringMap(hpa.Labels),
		})
	}
}

func (idx *objectMapIndex) collectPodDisruptionBudgets(lister policylisters.PodDisruptionBudgetLister) {
	collectKind(idx, "policy", "v1", "PodDisruptionBudget", "poddisruptionbudgets",
		func() ([]*policyv1.PodDisruptionBudget, error) { return lister.List(labels.Everything()) },
		func(pdb *policyv1.PodDisruptionBudget, rec *objectMapRecord) {
			rec.status = poddisruptionbudget.ObjectMapStatus(idx.meta.ClusterID, *pdb)
			rec.pdb = pdb
		})
}

func (idx *objectMapIndex) collectNetworkPolicies(lister networklisters.NetworkPolicyLister) {
	collectKind(idx, "networking.k8s.io", "v1", "NetworkPolicy", "networkpolicies",
		func() ([]*networkingv1.NetworkPolicy, error) { return lister.List(labels.Everything()) },
		func(policy *networkingv1.NetworkPolicy, rec *objectMapRecord) {
			rec.status = networkpolicy.ObjectMapStatus(idx.meta.ClusterID, *policy)
			rec.networkPolicy = policy
		})
}

func (idx *objectMapIndex) collectIngresses(lister networklisters.IngressLister) {
	collectKind(idx, "networking.k8s.io", "v1", "Ingress", "ingresses",
		func() ([]*networkingv1.Ingress, error) { return lister.List(labels.Everything()) },
		func(ing *networkingv1.Ingress, rec *objectMapRecord) {
			rec.status = ingress.ObjectMapStatus(idx.meta.ClusterID, *ing)
			rec.ingress = ing
		})
}

func (idx *objectMapIndex) collectIngressClasses(lister networklisters.IngressClassLister) {
	collectKind(idx, "networking.k8s.io", "v1", "IngressClass", "ingressclasses",
		func() ([]*networkingv1.IngressClass, error) { return lister.List(labels.Everything()) },
		func(ingClass *networkingv1.IngressClass, rec *objectMapRecord) {
			rec.status = ingressclass.ObjectMapStatus(idx.meta.ClusterID, *ingClass)
			rec.ingClass = ingClass
		})
}

func (idx *objectMapIndex) collectClusterRoles(lister rbaclisters.ClusterRoleLister) {
	collectKind(idx, "rbac.authorization.k8s.io", "v1", "ClusterRole", "clusterroles",
		func() ([]*rbacv1.ClusterRole, error) { return lister.List(labels.Everything()) },
		func(role *rbacv1.ClusterRole, rec *objectMapRecord) {
			rec.status = clusterrole.ObjectMapStatus(idx.meta.ClusterID, *role)
			rec.clusterRole = role
		})
}

func (idx *objectMapIndex) collectClusterRoleBindings(lister rbaclisters.ClusterRoleBindingLister) {
	collectKind(idx, "rbac.authorization.k8s.io", "v1", "ClusterRoleBinding", "clusterrolebindings",
		func() ([]*rbacv1.ClusterRoleBinding, error) { return lister.List(labels.Everything()) },
		func(binding *rbacv1.ClusterRoleBinding, rec *objectMapRecord) {
			rec.status = clusterrolebinding.ObjectMapStatus(idx.meta.ClusterID, *binding)
		})
}

func (idx *objectMapIndex) collectGatewayClasses(ctx context.Context, client gatewayversioned.Interface) {
	collectKind(idx, "gateway.networking.k8s.io", "v1", "GatewayClass", "gatewayclasses",
		func() ([]*gatewayv1.GatewayClass, error) {
			list, err := client.GatewayV1().GatewayClasses().List(ctx, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return ptrsOf(list.Items), nil
		},
		func(gatewayClass *gatewayv1.GatewayClass, rec *objectMapRecord) {
			rec.status = gatewayclass.ObjectMapStatus(idx.meta.ClusterID, *gatewayClass)
		})
}

func (idx *objectMapIndex) collectGateways(ctx context.Context, client gatewayversioned.Interface) {
	collectKind(idx, "gateway.networking.k8s.io", "v1", "Gateway", "gateways",
		func() ([]*gatewayv1.Gateway, error) {
			list, err := client.GatewayV1().Gateways(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return ptrsOf(list.Items), nil
		},
		func(gateway *gatewayv1.Gateway, rec *objectMapRecord) {
			rec.status = gatewaypkg.ObjectMapStatus(idx.meta.ClusterID, *gateway)
		})
}

func (idx *objectMapIndex) collectHTTPRoutes(ctx context.Context, client gatewayversioned.Interface) {
	collectKind(idx, "gateway.networking.k8s.io", "v1", "HTTPRoute", "httproutes",
		func() ([]*gatewayv1.HTTPRoute, error) {
			list, err := client.GatewayV1().HTTPRoutes(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return ptrsOf(list.Items), nil
		},
		func(route *gatewayv1.HTTPRoute, rec *objectMapRecord) {
			rec.status = httproute.ObjectMapStatus(idx.meta.ClusterID, *route)
		})
}

func (idx *objectMapIndex) collectGRPCRoutes(ctx context.Context, client gatewayversioned.Interface) {
	collectKind(idx, "gateway.networking.k8s.io", "v1", "GRPCRoute", "grpcroutes",
		func() ([]*gatewayv1.GRPCRoute, error) {
			list, err := client.GatewayV1().GRPCRoutes(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return ptrsOf(list.Items), nil
		},
		func(route *gatewayv1.GRPCRoute, rec *objectMapRecord) {
			rec.status = grpcroute.ObjectMapStatus(idx.meta.ClusterID, *route)
		})
}

func (idx *objectMapIndex) collectTLSRoutes(ctx context.Context, client gatewayversioned.Interface) {
	collectKind(idx, "gateway.networking.k8s.io", "v1", "TLSRoute", "tlsroutes",
		func() ([]*gatewayv1.TLSRoute, error) {
			list, err := client.GatewayV1().TLSRoutes(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return ptrsOf(list.Items), nil
		},
		func(route *gatewayv1.TLSRoute, rec *objectMapRecord) {
			rec.status = tlsroute.ObjectMapStatus(idx.meta.ClusterID, *route)
		})
}

func (idx *objectMapIndex) collectListenerSets(ctx context.Context, client gatewayversioned.Interface) {
	collectKind(idx, "gateway.networking.k8s.io", "v1", "ListenerSet", "listenersets",
		func() ([]*gatewayv1.ListenerSet, error) {
			list, err := client.GatewayV1().ListenerSets(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return ptrsOf(list.Items), nil
		},
		func(listenerSet *gatewayv1.ListenerSet, rec *objectMapRecord) {
			rec.status = listenerset.ObjectMapStatus(idx.meta.ClusterID, *listenerSet)
		})
}

func (idx *objectMapIndex) collectReferenceGrants(ctx context.Context, client gatewayversioned.Interface) {
	collectKind(idx, "gateway.networking.k8s.io", "v1", "ReferenceGrant", "referencegrants",
		func() ([]*gatewayv1.ReferenceGrant, error) {
			list, err := client.GatewayV1().ReferenceGrants(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return ptrsOf(list.Items), nil
		},
		func(grant *gatewayv1.ReferenceGrant, rec *objectMapRecord) {
			rec.status = referencegrant.ObjectMapStatus(idx.meta.ClusterID, *grant)
		})
}

func (idx *objectMapIndex) collectBackendTLSPolicies(ctx context.Context, client gatewayversioned.Interface) {
	collectKind(idx, "gateway.networking.k8s.io", "v1", "BackendTLSPolicy", "backendtlspolicies",
		func() ([]*gatewayv1.BackendTLSPolicy, error) {
			list, err := client.GatewayV1().BackendTLSPolicies(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return ptrsOf(list.Items), nil
		},
		func(policy *gatewayv1.BackendTLSPolicy, rec *objectMapRecord) {
			rec.status = backendtlspolicy.ObjectMapStatus(idx.meta.ClusterID, *policy)
		})
}

func (idx *objectMapIndex) skipListError(resource string, err error) bool {
	if err == nil {
		return false
	}
	if apierrors.IsForbidden(err) || apierrors.IsNotFound(err) {
		idx.warnings = append(idx.warnings, fmt.Sprintf("skipped %s: %v", resource, err))
		return true
	}
	idx.listErrors = append(idx.listErrors, fmt.Sprintf("%s: %v", resource, err))
	return true
}

func (idx *objectMapIndex) hasListError() bool {
	return idx != nil && len(idx.listErrors) > 0
}

func (idx *objectMapIndex) listError() error {
	if idx == nil || len(idx.listErrors) == 0 {
		return nil
	}
	return fmt.Errorf("object-map typed resource list failed: %s", strings.Join(idx.listErrors, "; "))
}

func (idx *objectMapIndex) addRecord(record *objectMapRecord) {
	if idx == nil || record == nil || record.ref.Kind == "" || record.ref.Name == "" || record.ref.Version == "" {
		return
	}
	if record.ref.ClusterID == "" {
		record.ref.ClusterID = idx.meta.ClusterID
	}
	if record.ref.ClusterName == "" {
		record.ref.ClusterName = idx.meta.ClusterName
	}
	id := objectMapNodeID(record.ref)
	existing := idx.records[id]
	if existing != nil {
		idx.mergeRecord(existing, record)
		record = existing
	} else {
		idx.records[id] = record
	}
	idx.byIdent[objectMapIdentityKey(record.ref.Namespace, record.ref.Group, record.ref.Version, record.ref.Kind, record.ref.Name)] = record
	if record.ref.UID != "" {
		idx.byUID[record.ref.UID] = record
	}
}

func (idx *objectMapIndex) mergeRecord(dst, src *objectMapRecord) {
	if dst.ref.Resource == "" {
		dst.ref.Resource = src.ref.Resource
	}
	if dst.ref.UID == "" {
		dst.ref.UID = src.ref.UID
	}
	if dst.creationTimestamp == "" {
		dst.creationTimestamp = src.creationTimestamp
	}
	if dst.status == nil {
		dst.status = src.status
	}
	if dst.actionFacts == nil {
		dst.actionFacts = cloneObjectMapActionFacts(src.actionFacts)
	}
	if len(dst.owners) == 0 {
		dst.owners = src.owners
	}
	if len(dst.labels) == 0 {
		dst.labels = src.labels
	}
	if src.obj != nil {
		dst.obj = src.obj
	}
	if src.pod != nil {
		dst.pod = src.pod
	}
	if src.service != nil {
		dst.service = src.service
	}
	if src.slice != nil {
		dst.slice = src.slice
	}
	if src.pvc != nil {
		dst.pvc = src.pvc
	}
	if src.pv != nil {
		dst.pv = src.pv
	}
	if src.storage != nil {
		dst.storage = src.storage
	}
	if src.ingress != nil {
		dst.ingress = src.ingress
	}
	if src.ingClass != nil {
		dst.ingClass = src.ingClass
	}
	if src.pdb != nil {
		dst.pdb = src.pdb
	}
	if src.networkPolicy != nil {
		dst.networkPolicy = src.networkPolicy
	}
	if src.clusterRole != nil {
		dst.clusterRole = src.clusterRole
	}
	if src.template != nil {
		dst.template = src.template
	}
	if src.cronJobTpl != nil {
		dst.cronJobTpl = src.cronJobTpl
	}
}

func (idx *objectMapIndex) enrichActionFacts() {
	if idx == nil || !idx.hpaListed {
		return
	}
	managedTargets := make(map[string]struct{})
	for _, record := range idx.records {
		if record == nil {
			continue
		}
		hpa, ok := record.obj.(*autoscalingv2.HorizontalPodAutoscaler)
		if !ok {
			continue
		}
		facts := hpapkg.BuildFacts(idx.meta.ClusterID, hpa)
		target := idx.recordForResourceLink(facts.ScaleTarget)
		if target == nil {
			continue
		}
		managedTargets[objectMapActionTargetKey(target.ref)] = struct{}{}
	}
	for _, record := range idx.records {
		if record == nil || !isObjectMapScalableWorkload(record.ref) {
			continue
		}
		managed := false
		if _, ok := managedTargets[objectMapActionTargetKey(record.ref)]; ok {
			managed = true
		}
		if record.actionFacts == nil {
			record.actionFacts = &ObjectMapActionFacts{}
		}
		record.actionFacts.HPAManaged = &managed
	}
}

func isObjectMapScalableWorkload(ref ObjectMapReference) bool {
	return ref.Group == "apps" &&
		ref.Version == "v1" &&
		(ref.Kind == "Deployment" || ref.Kind == "StatefulSet" || ref.Kind == "ReplicaSet")
}

func objectMapActionTargetKey(ref ObjectMapReference) string {
	return strings.Join([]string{
		strings.TrimSpace(ref.Namespace),
		strings.TrimSpace(ref.Group),
		strings.TrimSpace(ref.Version),
		strings.TrimSpace(ref.Kind),
		strings.TrimSpace(ref.Name),
	}, "\x00")
}

func objectMapNodeFromRecord(id string, depth int, record *objectMapRecord) ObjectMapNode {
	if record == nil {
		return ObjectMapNode{ID: id, Depth: depth}
	}
	return ObjectMapNode{
		ID:                id,
		Depth:             depth,
		Ref:               record.ref,
		CreationTimestamp: record.creationTimestamp,
		Status:            cloneObjectMapStatus(record.status),
		ActionFacts:       cloneObjectMapActionFacts(record.actionFacts),
	}
}

func cloneObjectMapActionFacts(facts *ObjectMapActionFacts) *ObjectMapActionFacts {
	if facts == nil {
		return nil
	}
	clone := *facts
	if facts.Unschedulable != nil {
		value := *facts.Unschedulable
		clone.Unschedulable = &value
	}
	if facts.PortForwardAvailable != nil {
		value := *facts.PortForwardAvailable
		clone.PortForwardAvailable = &value
	}
	if facts.HPAManaged != nil {
		value := *facts.HPAManaged
		clone.HPAManaged = &value
	}
	if facts.DesiredReplicas != nil {
		value := *facts.DesiredReplicas
		clone.DesiredReplicas = &value
	}
	return &clone
}

func cloneObjectMapStatus(status *ObjectMapStatus) *ObjectMapStatus {
	if status == nil {
		return nil
	}
	clone := *status
	return &clone
}

func objectMapPortForwardFacts(available bool) *ObjectMapActionFacts {
	return &ObjectMapActionFacts{PortForwardAvailable: &available}
}

func objectMapScalableWorkloadFacts(replicas *int32, portForwardAvailable bool) *ObjectMapActionFacts {
	return &ObjectMapActionFacts{
		PortForwardAvailable: &portForwardAvailable,
		DesiredReplicas:      replicas,
	}
}

func objectMapNodeActionFacts(unschedulable bool) *ObjectMapActionFacts {
	return &ObjectMapActionFacts{Unschedulable: &unschedulable}
}

func objectMapCronJobActionFacts(cron batchv1.CronJob) *ObjectMapActionFacts {
	available := common.HasForwardableContainerPorts(cron.Spec.JobTemplate.Spec.Template.Spec.Containers)
	facts := &ObjectMapActionFacts{PortForwardAvailable: &available}
	if cron.Spec.Suspend != nil && *cron.Spec.Suspend {
		facts.Status = "Suspended"
	}
	return facts
}

// Every kind's object-map status projection now lives in its kind package
// (e.g. statefulset.ObjectMapStatus, gateway.ObjectMapStatus); the collectors
// call them directly.

func (idx *objectMapIndex) findIdentity(namespace string, gvk schema.GroupVersionKind, name string) (*objectMapRecord, bool) {
	if idx == nil {
		return nil, false
	}
	record, ok := idx.byIdent[objectMapIdentityKey(namespace, gvk.Group, gvk.Version, gvk.Kind, name)]
	return record, ok
}

func (idx *objectMapIndex) buildGraph(seed *objectMapRecord, maxDepth, maxNodes int) objectMapGraph {
	allEdges := idx.buildAllEdges()
	sort.Slice(allEdges, func(i, j int) bool {
		if allEdges[i].Type != allEdges[j].Type {
			return allEdges[i].Type < allEdges[j].Type
		}
		if allEdges[i].Source != allEdges[j].Source {
			return allEdges[i].Source < allEdges[j].Source
		}
		if allEdges[i].Target != allEdges[j].Target {
			return allEdges[i].Target < allEdges[j].Target
		}
		return allEdges[i].ID < allEdges[j].ID
	})
	graph := objectMapGraph{
		nodes:     make(map[string]ObjectMapNode),
		edges:     make(map[string]ObjectMapEdge),
		adjacency: make(map[string][]objectMapTraversalEdge),
	}
	for _, edge := range allEdges {
		if !idx.canUseObjectMapEdgeForSeed(seed, edge) {
			continue
		}
		graph.adjacency[edge.Source] = append(graph.adjacency[edge.Source], objectMapTraversalEdge{edgeID: edge.ID})
		graph.adjacency[edge.Target] = append(graph.adjacency[edge.Target], objectMapTraversalEdge{edgeID: edge.ID, reverse: true})
		graph.edges[edge.ID] = edge
	}

	seedID := objectMapNodeID(seed.ref)
	graph.nodes[seedID] = objectMapNodeFromRecord(seedID, 0, seed)

	if !usesDirectionalObjectMapTraversal(seed.ref) {
		idx.traverseObjectMapMixed(&graph, seedID, maxDepth, maxNodes)
		includedEdges := make(map[string]ObjectMapEdge)
		for _, edge := range graph.edges {
			if _, ok := graph.nodes[edge.Source]; !ok {
				continue
			}
			if _, ok := graph.nodes[edge.Target]; !ok {
				continue
			}
			includedEdges[edge.ID] = edge
		}
		graph.edges = includedEdges
		return graph
	}

	includedEdges := make(map[string]ObjectMapEdge)
	idx.traverseObjectMapDirection(&graph, seedID, maxDepth, maxNodes, objectMapTraversalForward, includedEdges)
	idx.traverseObjectMapDirection(&graph, seedID, maxDepth, maxNodes, objectMapTraversalBackward, includedEdges)

	finalEdges := make(map[string]ObjectMapEdge)
	for _, edge := range includedEdges {
		if _, ok := graph.nodes[edge.Source]; !ok {
			continue
		}
		if _, ok := graph.nodes[edge.Target]; !ok {
			continue
		}
		finalEdges[edge.ID] = edge
	}
	graph.edges = finalEdges
	return graph
}

func (idx *objectMapIndex) buildNamespaceGraph(namespace string, maxNodes int) objectMapGraph {
	allEdges := idx.buildAllEdges()
	sort.Slice(allEdges, func(i, j int) bool {
		if allEdges[i].Type != allEdges[j].Type {
			return allEdges[i].Type < allEdges[j].Type
		}
		if allEdges[i].Source != allEdges[j].Source {
			return allEdges[i].Source < allEdges[j].Source
		}
		if allEdges[i].Target != allEdges[j].Target {
			return allEdges[i].Target < allEdges[j].Target
		}
		return allEdges[i].ID < allEdges[j].ID
	})

	graph := objectMapGraph{
		nodes: make(map[string]ObjectMapNode),
		edges: make(map[string]ObjectMapEdge),
	}

	addRecord := func(record *objectMapRecord, depth int) bool {
		if record == nil || !isNamespaceMapSupportedRecord(record) {
			return false
		}
		id := objectMapNodeID(record.ref)
		if id == "" {
			return false
		}
		if _, exists := graph.nodes[id]; exists {
			return false
		}
		if len(graph.nodes) >= maxNodes {
			graph.truncated = true
			return false
		}
		graph.nodes[id] = objectMapNodeFromRecord(id, depth, record)
		return true
	}

	initialRecords := make([]*objectMapRecord, 0)
	for _, record := range idx.records {
		if record.ref.Namespace == namespace {
			initialRecords = append(initialRecords, record)
		}
	}
	sort.Slice(initialRecords, func(i, j int) bool {
		return compareObjectMapRefs(initialRecords[i].ref, initialRecords[j].ref) < 0
	})
	for _, record := range initialRecords {
		addRecord(record, 0)
	}

	changed := true
	for changed && !graph.truncated {
		changed = false
		for _, edge := range allEdges {
			sourceRecord := idx.records[edge.Source]
			targetRecord := idx.records[edge.Target]
			_, sourceIncluded := graph.nodes[edge.Source]
			_, targetIncluded := graph.nodes[edge.Target]
			if sourceIncluded && targetRecord != nil && targetRecord.ref.Namespace == "" {
				if addRecord(targetRecord, 1) {
					changed = true
				}
			}
			if targetIncluded && targetRecord != nil && !stopsNamespaceMapReverseExpansion(targetRecord.ref) && sourceRecord != nil && sourceRecord.ref.Namespace == "" {
				if addRecord(sourceRecord, 1) {
					changed = true
				}
			}
		}
	}

	for _, edge := range allEdges {
		if _, ok := graph.nodes[edge.Source]; !ok {
			continue
		}
		if _, ok := graph.nodes[edge.Target]; !ok {
			continue
		}
		graph.edges[edge.ID] = edge
	}
	return graph
}

func (idx *objectMapIndex) traverseObjectMapMixed(
	graph *objectMapGraph,
	seedID string,
	maxDepth int,
	maxNodes int,
) {
	queue := []string{seedID}
	for head := 0; head < len(queue); head++ {
		currentID := queue[head]
		currentDepth := graph.nodes[currentID].Depth
		if currentDepth >= maxDepth {
			continue
		}
		for _, traversal := range graph.adjacency[currentID] {
			edge := graph.edges[traversal.edgeID]
			if traversal.reverse && !canTraverseObjectMapReverse(edge.Type, currentDepth) {
				continue
			}
			neighborID := edge.Target
			if traversal.reverse {
				neighborID = edge.Source
			}
			if _, exists := graph.nodes[neighborID]; exists {
				continue
			}
			if len(graph.nodes) >= maxNodes {
				graph.truncated = true
				continue
			}
			record, ok := idx.records[neighborID]
			if !ok {
				continue
			}
			graph.nodes[neighborID] = objectMapNodeFromRecord(neighborID, currentDepth+1, record)
			queue = append(queue, neighborID)
		}
	}
}

func (idx *objectMapIndex) traverseObjectMapDirection(
	graph *objectMapGraph,
	seedID string,
	maxDepth int,
	maxNodes int,
	direction objectMapTraversalDirection,
	includedEdges map[string]ObjectMapEdge,
) {
	type queueItem struct {
		id    string
		depth int
	}
	queue := []queueItem{{id: seedID, depth: 0}}
	visited := map[string]struct{}{seedID: {}}
	for head := 0; head < len(queue); head++ {
		currentID := queue[head].id
		currentDepth := queue[head].depth
		if currentDepth >= maxDepth {
			continue
		}
		for _, traversal := range graph.adjacency[currentID] {
			if direction == objectMapTraversalForward && traversal.reverse {
				continue
			}
			if direction == objectMapTraversalBackward && !traversal.reverse {
				continue
			}
			edge := graph.edges[traversal.edgeID]
			if traversal.reverse && !canTraverseObjectMapReverse(edge.Type, currentDepth) {
				continue
			}
			neighborID := edge.Target
			if traversal.reverse {
				neighborID = edge.Source
			}
			neighborDepth := currentDepth + 1
			if _, exists := graph.nodes[neighborID]; exists {
				includedEdges[edge.ID] = edge
				if existing := graph.nodes[neighborID]; existing.Depth > neighborDepth {
					existing.Depth = neighborDepth
					graph.nodes[neighborID] = existing
				}
				if _, seen := visited[neighborID]; !seen {
					visited[neighborID] = struct{}{}
					queue = append(queue, queueItem{id: neighborID, depth: neighborDepth})
				}
				continue
			}
			if len(graph.nodes) >= maxNodes {
				graph.truncated = true
				continue
			}
			record, ok := idx.records[neighborID]
			if !ok {
				continue
			}
			graph.nodes[neighborID] = objectMapNodeFromRecord(neighborID, neighborDepth, record)
			includedEdges[edge.ID] = edge
			if _, seen := visited[neighborID]; seen {
				continue
			}
			visited[neighborID] = struct{}{}
			queue = append(queue, queueItem{id: neighborID, depth: neighborDepth})
		}
	}
}

func (idx *objectMapIndex) canUseObjectMapEdgeForSeed(seed *objectMapRecord, edge ObjectMapEdge) bool {
	if seed == nil || !isIngressClassRef(seed.ref) {
		return true
	}
	source := idx.records[edge.Source]
	target := idx.records[edge.Target]
	return edge.Type == objectMapEdgeUses && source != nil && target != nil && isIngressRef(source.ref) && isIngressClassRef(target.ref)
}

func canTraverseObjectMapReverse(edgeType string, currentDepth int) bool {
	relationship, ok := objectMapRelationships[edgeType]
	if !ok {
		return false
	}
	switch relationship.reversePolicy {
	case objectMapReverseAnyDepth:
		return true
	case objectMapReverseDepthOne:
		return currentDepth <= 1
	case objectMapReverseSeedOnly:
		return currentDepth == 0
	default:
		return false
	}
}

func usesDirectionalObjectMapTraversal(ref ObjectMapReference) bool {
	switch ref.Kind {
	case "Pod",
		"Service",
		"EndpointSlice",
		"PersistentVolumeClaim",
		"PersistentVolume",
		"StorageClass",
		"ConfigMap",
		"Secret",
		"ServiceAccount",
		"Node",
		"PodDisruptionBudget",
		"NetworkPolicy",
		"IngressClass":
		return true
	default:
		return false
	}
}

func isNamespaceMapSupportedRecord(record *objectMapRecord) bool {
	if record == nil {
		return false
	}
	return record.pod != nil ||
		record.service != nil ||
		record.slice != nil ||
		record.pvc != nil ||
		record.pv != nil ||
		record.storage != nil ||
		record.ingress != nil ||
		record.ingClass != nil ||
		record.pdb != nil ||
		record.networkPolicy != nil ||
		record.clusterRole != nil ||
		record.template != nil ||
		record.cronJobTpl != nil ||
		objectMapEdgeBuilders[record.ref.Kind] != nil ||
		record.ref.Kind == "ConfigMap" ||
		record.ref.Kind == "Secret" ||
		record.ref.Kind == "ServiceAccount" ||
		record.ref.Kind == "Node"
}

func stopsNamespaceMapReverseExpansion(ref ObjectMapReference) bool {
	switch ref.Kind {
	case "StorageClass", "IngressClass", "GatewayClass":
		return true
	default:
		return false
	}
}

func compareObjectMapRefs(a, b ObjectMapReference) int {
	if a.Kind != b.Kind {
		return strings.Compare(a.Kind, b.Kind)
	}
	if a.Namespace != b.Namespace {
		return strings.Compare(a.Namespace, b.Namespace)
	}
	if a.Group != b.Group {
		return strings.Compare(a.Group, b.Group)
	}
	if a.Version != b.Version {
		return strings.Compare(a.Version, b.Version)
	}
	return strings.Compare(a.Name, b.Name)
}

func (idx *objectMapIndex) buildAllEdges() []ObjectMapEdge {
	edges := make(map[string]ObjectMapEdge)
	add := func(source, target *objectMapRecord, typ, label, tracedBy string) {
		if source == nil || target == nil {
			return
		}
		sourceID := objectMapNodeID(source.ref)
		targetID := objectMapNodeID(target.ref)
		if sourceID == "" || targetID == "" || sourceID == targetID {
			return
		}
		id := strings.Join([]string{sourceID, typ, targetID, tracedBy}, "|")
		edges[id] = ObjectMapEdge{
			ID:       id,
			Source:   sourceID,
			Target:   targetID,
			Type:     typ,
			Label:    label,
			TracedBy: tracedBy,
		}
	}

	for _, record := range idx.records {
		for _, owner := range record.owners {
			ownerRecord := idx.resolveOwner(record, owner)
			add(ownerRecord, record, objectMapEdgeOwner, objectMapRelationships[objectMapEdgeOwner].label, owner.Name)
		}
	}

	for _, record := range idx.records {
		if record.pod != nil {
			idx.addPodEdges(record, add)
		}
		// Kinds that declare their relationship edges in their own package; the
		// registry dispatches by kind and resolveEdgeTargets resolves each target.
		if build := objectMapEdgeBuilders[record.ref.Kind]; build != nil {
			for _, e := range build(idx.meta.ClusterID, record.obj) {
				relationship := objectMapRelationships[e.Type]
				label := e.Label
				if label == "" {
					label = relationship.label
				}
				tracedBy := e.TracedBy
				if tracedBy == "" {
					tracedBy = relationship.defaultTracedBy
				}
				for _, target := range idx.resolveEdgeTargets(record, e) {
					add(record, target, e.Type, label, tracedBy)
				}
			}
		}
		if record.template != nil {
			idx.addPodTemplateEdges(record, record.template, add)
		}
		if record.cronJobTpl != nil {
			idx.addPodTemplateEdges(record, record.cronJobTpl, add)
		}
	}

	result := make([]ObjectMapEdge, 0, len(edges))
	for _, edge := range edges {
		result = append(result, edge)
	}
	return result
}

func (idx *objectMapIndex) addPodEdges(record *objectMapRecord, add func(*objectMapRecord, *objectMapRecord, string, string, string)) {
	pod := record.pod
	if pod.Spec.NodeName != "" {
		relationship := objectMapRelationships[objectMapEdgeSchedules]
		add(record, idx.findCore("", "v1", "Node", pod.Spec.NodeName), relationship.typ, relationship.label, relationship.defaultTracedBy)
	}
	serviceAccount := pod.Spec.ServiceAccountName
	if serviceAccount == "" {
		serviceAccount = "default"
	}
	relationship := objectMapRelationships[objectMapEdgeUses]
	add(record, idx.findCore(record.ref.Namespace, "v1", "ServiceAccount", serviceAccount), relationship.typ, relationship.label, "spec.serviceAccountName")
	for _, volume := range pod.Spec.Volumes {
		idx.addVolumeEdges(record, record.ref.Namespace, volume, add)
	}
	for _, container := range append(append([]corev1.Container{}, pod.Spec.InitContainers...), pod.Spec.Containers...) {
		idx.addContainerEdges(record, record.ref.Namespace, container, add)
	}
}

func (idx *objectMapIndex) addPodTemplateEdges(record *objectMapRecord, tpl *corev1.PodTemplateSpec, add func(*objectMapRecord, *objectMapRecord, string, string, string)) {
	if tpl == nil {
		return
	}
	serviceAccount := tpl.Spec.ServiceAccountName
	if serviceAccount != "" {
		relationship := objectMapRelationships[objectMapEdgeUses]
		add(record, idx.findCore(record.ref.Namespace, "v1", "ServiceAccount", serviceAccount), relationship.typ, relationship.label, "template.spec.serviceAccountName")
	}
	for _, volume := range tpl.Spec.Volumes {
		idx.addVolumeEdges(record, record.ref.Namespace, volume, add)
	}
	for _, container := range append(append([]corev1.Container{}, tpl.Spec.InitContainers...), tpl.Spec.Containers...) {
		idx.addContainerEdges(record, record.ref.Namespace, container, add)
	}
}

func (idx *objectMapIndex) addVolumeEdges(record *objectMapRecord, namespace string, volume corev1.Volume, add func(*objectMapRecord, *objectMapRecord, string, string, string)) {
	if volume.ConfigMap != nil && volume.ConfigMap.Name != "" {
		relationship := objectMapRelationships[objectMapEdgeUses]
		add(record, idx.findCore(namespace, "v1", "ConfigMap", volume.ConfigMap.Name), relationship.typ, relationship.label, "volume.configMap")
	}
	if volume.Secret != nil && volume.Secret.SecretName != "" {
		relationship := objectMapRelationships[objectMapEdgeUses]
		add(record, idx.findCore(namespace, "v1", "Secret", volume.Secret.SecretName), relationship.typ, relationship.label, "volume.secret")
	}
	if volume.PersistentVolumeClaim != nil && volume.PersistentVolumeClaim.ClaimName != "" {
		relationship := objectMapRelationships[objectMapEdgeMounts]
		add(record, idx.findCore(namespace, "v1", "PersistentVolumeClaim", volume.PersistentVolumeClaim.ClaimName), relationship.typ, relationship.label, "volume.persistentVolumeClaim")
	}
}

func (idx *objectMapIndex) addContainerEdges(record *objectMapRecord, namespace string, container corev1.Container, add func(*objectMapRecord, *objectMapRecord, string, string, string)) {
	for _, envFrom := range container.EnvFrom {
		if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name != "" {
			relationship := objectMapRelationships[objectMapEdgeUses]
			add(record, idx.findCore(namespace, "v1", "ConfigMap", envFrom.ConfigMapRef.Name), relationship.typ, relationship.label, "envFrom.configMapRef")
		}
		if envFrom.SecretRef != nil && envFrom.SecretRef.Name != "" {
			relationship := objectMapRelationships[objectMapEdgeUses]
			add(record, idx.findCore(namespace, "v1", "Secret", envFrom.SecretRef.Name), relationship.typ, relationship.label, "envFrom.secretRef")
		}
	}
	for _, env := range container.Env {
		if env.ValueFrom == nil {
			continue
		}
		if env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name != "" {
			relationship := objectMapRelationships[objectMapEdgeUses]
			add(record, idx.findCore(namespace, "v1", "ConfigMap", env.ValueFrom.ConfigMapKeyRef.Name), relationship.typ, relationship.label, "env.configMapKeyRef")
		}
		if env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name != "" {
			relationship := objectMapRelationships[objectMapEdgeUses]
			add(record, idx.findCore(namespace, "v1", "Secret", env.ValueFrom.SecretKeyRef.Name), relationship.typ, relationship.label, "env.secretKeyRef")
		}
	}
}

func (idx *objectMapIndex) resolveOwner(child *objectMapRecord, owner metav1.OwnerReference) *objectMapRecord {
	if owner.UID != "" {
		if record := idx.byUID[string(owner.UID)]; record != nil {
			return record
		}
	}
	gv, err := schema.ParseGroupVersion(owner.APIVersion)
	if err != nil {
		return nil
	}
	return idx.byIdent[objectMapIdentityKey(child.ref.Namespace, gv.Group, gv.Version, owner.Kind, owner.Name)]
}

func (idx *objectMapIndex) resolveCoreObjectRef(defaultNamespace string, ref *corev1.ObjectReference) *objectMapRecord {
	if ref == nil {
		return nil
	}
	if ref.UID != "" {
		if record := idx.byUID[string(ref.UID)]; record != nil {
			return record
		}
	}
	namespace := ref.Namespace
	if namespace == "" {
		namespace = defaultNamespace
	}
	group := ""
	version := ref.APIVersion
	if strings.Contains(ref.APIVersion, "/") {
		gv, err := schema.ParseGroupVersion(ref.APIVersion)
		if err != nil {
			return nil
		}
		group = gv.Group
		version = gv.Version
	}
	return idx.byIdent[objectMapIdentityKey(namespace, group, version, ref.Kind, ref.Name)]
}

func (idx *objectMapIndex) findCore(namespace, version, kind, name string) *objectMapRecord {
	return idx.byIdent[objectMapIdentityKey(namespace, "", version, kind, name)]
}

func (idx *objectMapIndex) findStorageClass(name string) *objectMapRecord {
	return idx.byIdent[objectMapIdentityKey("", "storage.k8s.io", "v1", "StorageClass", name)]
}

func (idx *objectMapIndex) findIngressClass(name string) *objectMapRecord {
	return idx.byIdent[objectMapIdentityKey("", "networking.k8s.io", "v1", "IngressClass", name)]
}

func (idx *objectMapIndex) recordForResourceLink(link resourcemodel.ResourceLink) *objectMapRecord {
	if link.Ref != nil {
		return idx.byIdent[objectMapIdentityKey(link.Ref.Namespace, link.Ref.Group, link.Ref.Version, link.Ref.Kind, link.Ref.Name)]
	}
	if link.Display != nil {
		return idx.byIdent[objectMapIdentityKey(link.Display.Namespace, link.Display.Group, link.Display.Version, link.Display.Kind, link.Display.Name)]
	}
	return nil
}

func (idx *objectMapIndex) clusterRolesMatchingSelector(selector metav1.LabelSelector) []*objectMapRecord {
	parsed, err := metav1.LabelSelectorAsSelector(&selector)
	if err != nil || parsed.Empty() {
		return nil
	}
	result := []*objectMapRecord{}
	for _, record := range idx.records {
		if record.clusterRole == nil {
			continue
		}
		if parsed.Matches(labels.Set(record.labels)) {
			result = append(result, record)
		}
	}
	return result
}

func (idx *objectMapIndex) matchingPods(namespace string, selector map[string]string) []*objectMapRecord {
	if len(selector) == 0 {
		return nil
	}
	result := []*objectMapRecord{}
	for _, record := range idx.records {
		if record.pod == nil || record.ref.Namespace != namespace {
			continue
		}
		if labelsMatch(selector, record.labels) {
			result = append(result, record)
		}
	}
	return result
}

func (idx *objectMapIndex) matchingPodsByLabelSelector(namespace string, selector *metav1.LabelSelector) []*objectMapRecord {
	if selector == nil {
		return nil
	}
	parsed, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return nil
	}
	result := []*objectMapRecord{}
	for _, record := range idx.records {
		if record.pod == nil || record.ref.Namespace != namespace {
			continue
		}
		if parsed.Matches(labels.Set(record.labels)) {
			result = append(result, record)
		}
	}
	return result
}

func (idx *objectMapIndex) endpointSlicesForService(namespace, serviceName string) []*objectMapRecord {
	result := []*objectMapRecord{}
	for _, record := range idx.records {
		if record.slice == nil || record.ref.Namespace != namespace {
			continue
		}
		if record.labels[discoveryv1.LabelServiceName] == serviceName {
			result = append(result, record)
		}
	}
	return result
}

func labelsMatch(selector, labels map[string]string) bool {
	for key, expected := range selector {
		if labels[key] != expected {
			return false
		}
	}
	return true
}

// resolveEdgeTargets resolves an Edge's target descriptor to the graph records it
// points at. Selectors and slice endpoints can resolve to several; the rest to one
// (possibly nil, which add() skips).
func (idx *objectMapIndex) resolveEdgeTargets(source *objectMapRecord, e objectmapspec.Edge) []*objectMapRecord {
	switch {
	case e.CoreRef != nil:
		return []*objectMapRecord{idx.findCore(e.CoreRef.Namespace, e.CoreRef.Version, e.CoreRef.Kind, e.CoreRef.Name)}
	case e.StorageClass != "":
		return []*objectMapRecord{idx.findStorageClass(e.StorageClass)}
	case e.IngressClass != "":
		return []*objectMapRecord{idx.findIngressClass(e.IngressClass)}
	case e.PodsSelector != nil:
		return idx.matchingPods(source.ref.Namespace, e.PodsSelector)
	case e.PodsLabelSelector != nil:
		return idx.matchingPodsByLabelSelector(source.ref.Namespace, e.PodsLabelSelector)
	case e.ServiceSlices:
		return idx.endpointSlicesForService(source.ref.Namespace, source.ref.Name)
	case e.CoreObjectRef != nil:
		return []*objectMapRecord{idx.resolveCoreObjectRef(source.ref.Namespace, e.CoreObjectRef)}
	case e.ClusterRoleSelector != nil:
		return idx.clusterRolesMatchingSelector(*e.ClusterRoleSelector)
	default:
		return []*objectMapRecord{idx.recordForResourceLink(e.Link)}
	}
}

func isIngressRef(ref ObjectMapReference) bool {
	return ref.Group == "networking.k8s.io" && ref.Version == "v1" && ref.Kind == "Ingress"
}

func isIngressClassRef(ref ObjectMapReference) bool {
	return ref.Group == "networking.k8s.io" && ref.Version == "v1" && ref.Kind == "IngressClass"
}

func refFromCatalog(item objectcatalog.Summary) ObjectMapReference {
	return ObjectMapReference{
		ClusterID:   item.ClusterID,
		ClusterName: item.ClusterName,
		Group:       item.Group,
		Version:     item.Version,
		Kind:        item.Kind,
		Resource:    item.Resource,
		Namespace:   item.Namespace,
		Name:        item.Name,
		UID:         item.UID,
	}
}

// refFromObject builds an object-map reference from any Kubernetes object's metadata.
// It takes the metav1.Object accessor interface so both concrete *metav1.ObjectMeta
// (from the per-kind collectors) and typed objects (from the generic collectKind)
// satisfy it.
func refFromObject(meta metav1.Object, group, version, kind, resource, namespace string) ObjectMapReference {
	ref := ObjectMapReference{
		Group:     group,
		Version:   version,
		Kind:      kind,
		Resource:  resource,
		Namespace: namespace,
	}
	if meta != nil {
		ref.Name = meta.GetName()
		ref.UID = string(meta.GetUID())
		if ref.Namespace == "" {
			ref.Namespace = meta.GetNamespace()
		}
	}
	return ref
}

func objectCreationTimestamp(meta metav1.Object) string {
	if meta == nil {
		return ""
	}
	created := meta.GetCreationTimestamp()
	if created.IsZero() {
		return ""
	}
	return created.UTC().Format(time.RFC3339)
}

func objectMapNodeID(ref ObjectMapReference) string {
	clusterID := strings.TrimSpace(ref.ClusterID)
	uid := strings.TrimSpace(ref.UID)
	if uid != "" {
		return clusterID + "|uid:" + uid
	}
	return clusterID + "|" + objectMapIdentityKey(ref.Namespace, ref.Group, ref.Version, ref.Kind, ref.Name)
}

func objectMapIdentityKey(namespace, group, version, kind, name string) string {
	ns := strings.TrimSpace(namespace)
	if ns == refresh.ObjectClusterScopeToken {
		ns = ""
	}
	return strings.Join([]string{
		ns,
		strings.TrimSpace(group),
		strings.TrimSpace(version),
		strings.TrimSpace(kind),
		strings.TrimSpace(name),
	}, "\x00")
}

func sortedObjectMapNodes(nodes map[string]ObjectMapNode) []ObjectMapNode {
	result := make([]ObjectMapNode, 0, len(nodes))
	for _, node := range nodes {
		result = append(result, node)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Depth != result[j].Depth {
			return result[i].Depth < result[j].Depth
		}
		if result[i].Ref.Kind != result[j].Ref.Kind {
			return result[i].Ref.Kind < result[j].Ref.Kind
		}
		if result[i].Ref.Namespace != result[j].Ref.Namespace {
			return result[i].Ref.Namespace < result[j].Ref.Namespace
		}
		return result[i].Ref.Name < result[j].Ref.Name
	})
	return result
}

func sortedObjectMapEdges(edges map[string]ObjectMapEdge) []ObjectMapEdge {
	result := make([]ObjectMapEdge, 0, len(edges))
	for _, edge := range edges {
		result = append(result, edge)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Type != result[j].Type {
			return result[i].Type < result[j].Type
		}
		if result[i].Source != result[j].Source {
			return result[i].Source < result[j].Source
		}
		return result[i].Target < result[j].Target
	})
	return result
}

func cloneStringMap(src map[string]string) map[string]string {
	if len(src) == 0 {
		return nil
	}
	dst := make(map[string]string, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}
