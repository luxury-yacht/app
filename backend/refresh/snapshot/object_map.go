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
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
)

const (
	objectMapDomain       = "object-map"
	defaultObjectMapDepth = 4
	defaultObjectMapNodes = 250
	maxObjectMapDepth     = 12
	maxObjectMapNodes     = 1000
)

const (
	objectMapEdgeOwner         = "owner"
	objectMapEdgeSelector      = "selector"
	objectMapEdgeEndpoint      = "endpoint"
	objectMapEdgeRoutes        = "routes"
	objectMapEdgeScales        = "scales"
	objectMapEdgeGrants        = "grants"
	objectMapEdgeBinds         = "binds"
	objectMapEdgeAggregates    = "aggregates"
	objectMapEdgeUses          = "uses"
	objectMapEdgeMounts        = "mounts"
	objectMapEdgeSchedules     = "schedules"
	objectMapEdgeVolumeBinding = "volume-binding"
	objectMapEdgeStorageClass  = "storage-class"
)

type objectMapReverseTraversalPolicy int

const (
	objectMapReverseNever objectMapReverseTraversalPolicy = iota
	objectMapReverseAnyDepth
	objectMapReverseSeedOnly
	objectMapReverseDepthOne
)

type objectMapRelationship struct {
	typ             string
	label           string
	reversePolicy   objectMapReverseTraversalPolicy
	defaultTracedBy string
}

var objectMapRelationships = map[string]objectMapRelationship{
	objectMapEdgeOwner: {
		typ:           objectMapEdgeOwner,
		label:         "owns",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeSelector: {
		typ:             objectMapEdgeSelector,
		label:           "selects",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "spec.selector",
	},
	objectMapEdgeEndpoint: {
		typ:           objectMapEdgeEndpoint,
		label:         "has endpoints",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeRoutes: {
		typ:           objectMapEdgeRoutes,
		label:         "routes to",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeScales: {
		typ:             objectMapEdgeScales,
		label:           "scales",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "spec.scaleTargetRef",
	},
	objectMapEdgeGrants: {
		typ:             objectMapEdgeGrants,
		label:           "grants",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "roleRef",
	},
	objectMapEdgeBinds: {
		typ:             objectMapEdgeBinds,
		label:           "binds",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "subjects",
	},
	objectMapEdgeAggregates: {
		typ:             objectMapEdgeAggregates,
		label:           "aggregates",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "aggregationRule.clusterRoleSelectors",
	},
	objectMapEdgeUses: {
		typ:           objectMapEdgeUses,
		label:         "uses",
		reversePolicy: objectMapReverseSeedOnly,
	},
	objectMapEdgeMounts: {
		typ:             objectMapEdgeMounts,
		label:           "mounts",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "volumes",
	},
	objectMapEdgeSchedules: {
		typ:             objectMapEdgeSchedules,
		label:           "scheduled on",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "spec.nodeName",
	},
	objectMapEdgeVolumeBinding: {
		typ:             objectMapEdgeVolumeBinding,
		label:           "binds volume",
		reversePolicy:   objectMapReverseDepthOne,
		defaultTracedBy: "spec.volumeName",
	},
	objectMapEdgeStorageClass: {
		typ:             objectMapEdgeStorageClass,
		label:           "uses class",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "spec.storageClassName",
	},
}

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
	ID                string             `json:"id"`
	Depth             int                `json:"depth"`
	Ref               ObjectMapReference `json:"ref"`
	CreationTimestamp string             `json:"creationTimestamp,omitempty"`
	Status            *ObjectMapStatus   `json:"status,omitempty"`
}

// ObjectMapStatus is a compact card-level status indicator. State mirrors the
// shared frontend StatusIndicator states so object-map dots use the same visual
// vocabulary as the rest of the app.
type ObjectMapStatus struct {
	State  string `json:"state"`
	Label  string `json:"label"`
	Reason string `json:"reason,omitempty"`
}

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

type objectMapBuilder struct {
	client         kubernetes.Interface
	catalogService func() *objectcatalog.Service
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
	ref                ObjectMapReference
	creationTimestamp  string
	status             *ObjectMapStatus
	owners             []metav1.OwnerReference
	labels             map[string]string
	pod                *corev1.Pod
	service            *corev1.Service
	slice              *discoveryv1.EndpointSlice
	pvc                *corev1.PersistentVolumeClaim
	pv                 *corev1.PersistentVolume
	storage            *storagev1.StorageClass
	ingress            *networkingv1.Ingress
	ingClass           *networkingv1.IngressClass
	hpa                *autoscalingv2.HorizontalPodAutoscaler
	clusterRole        *rbacv1.ClusterRole
	clusterRoleBinding *rbacv1.ClusterRoleBinding
	template           *corev1.PodTemplateSpec
	cronJobTpl         *corev1.PodTemplateSpec
}

type objectMapIndex struct {
	meta       ClusterMeta
	records    map[string]*objectMapRecord
	byUID      map[string]*objectMapRecord
	byIdent    map[string]*objectMapRecord
	warnings   []string
	listErrors []string
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
	catalogService func() *objectcatalog.Service,
) error {
	if client == nil {
		return fmt.Errorf("kubernetes client is required for object map domain")
	}
	builder := &objectMapBuilder{client: client, catalogService: catalogService}
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

	meta := ClusterMetaFromContext(ctx)
	index := newObjectMapIndex(meta)
	index.addCatalog(b.catalog())
	index.collectTyped(ctx, b.client)
	if err := index.listError(); err != nil {
		return nil, err
	}

	seed, ok := index.findIdentity(opts.identity.Namespace, opts.identity.GVK, opts.identity.Name)
	if !ok {
		return nil, fmt.Errorf("object-map seed not found: %s/%s %s/%s", opts.identity.GVK.Group, opts.identity.GVK.Version, opts.identity.GVK.Kind, opts.identity.Name)
	}

	graph := index.buildGraph(seed, opts.maxDepth, opts.maxNodes)
	nodes := sortedObjectMapNodes(graph.nodes)
	edges := sortedObjectMapEdges(graph.edges)
	payload := ObjectMapSnapshotPayload{
		ClusterMeta: meta,
		Seed:        seed.ref,
		Nodes:       nodes,
		Edges:       edges,
		MaxDepth:    opts.maxDepth,
		MaxNodes:    opts.maxNodes,
		Truncated:   graph.truncated,
		Warnings:    index.warnings,
	}

	return &refresh.Snapshot{
		Domain:  objectMapDomain,
		Scope:   scope,
		Version: 0,
		Payload: payload,
		Stats: refresh.SnapshotStats{
			ItemCount:    len(nodes),
			TotalItems:   len(nodes),
			Truncated:    graph.truncated,
			Warnings:     index.warnings,
			IsFinalBatch: true,
			BatchSize:    len(nodes),
			TotalBatches: 1,
		},
	}, nil
}

func (b *objectMapBuilder) buildNamespace(ctx context.Context, scope string, opts objectMapOptions) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	index := newObjectMapIndex(meta)
	index.addCatalog(b.catalog())
	index.collectTyped(ctx, b.client)
	if err := index.listError(); err != nil {
		return nil, err
	}

	graph := index.buildNamespaceGraph(opts.namespace, opts.maxNodes)
	nodes := sortedObjectMapNodes(graph.nodes)
	edges := sortedObjectMapEdges(graph.edges)
	seed := ObjectMapReference{
		ClusterID:   meta.ClusterID,
		ClusterName: meta.ClusterName,
		Group:       "",
		Version:     "v1",
		Kind:        "Namespace",
		Resource:    "namespaces",
		Name:        opts.namespace,
	}
	payload := ObjectMapSnapshotPayload{
		ClusterMeta: meta,
		Seed:        seed,
		Nodes:       nodes,
		Edges:       edges,
		MaxDepth:    opts.maxDepth,
		MaxNodes:    opts.maxNodes,
		Truncated:   graph.truncated,
		Warnings:    index.warnings,
	}

	return &refresh.Snapshot{
		Domain:  objectMapDomain,
		Scope:   scope,
		Version: 0,
		Payload: payload,
		Stats: refresh.SnapshotStats{
			ItemCount:    len(nodes),
			TotalItems:   len(nodes),
			Truncated:    graph.truncated,
			Warnings:     index.warnings,
			IsFinalBatch: true,
			BatchSize:    len(nodes),
			TotalBatches: 1,
		},
	}, nil
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

func (idx *objectMapIndex) collectTyped(ctx context.Context, client kubernetes.Interface) {
	if idx == nil || client == nil {
		return
	}
	collectors := []func(context.Context, kubernetes.Interface){
		idx.collectPods,
		idx.collectServices,
		idx.collectEndpointSlices,
		idx.collectPVCs,
		idx.collectPVs,
		idx.collectStorageClasses,
		idx.collectConfigMaps,
		idx.collectSecrets,
		idx.collectServiceAccounts,
		idx.collectNodes,
		idx.collectDeployments,
		idx.collectReplicaSets,
		idx.collectStatefulSets,
		idx.collectDaemonSets,
		idx.collectJobs,
		idx.collectCronJobs,
		idx.collectHPAs,
		idx.collectIngresses,
		idx.collectIngressClasses,
		idx.collectClusterRoles,
		idx.collectClusterRoleBindings,
	}
	for _, collect := range collectors {
		collect(ctx, client)
		if idx.hasListError() {
			return
		}
	}
}

func (idx *objectMapIndex) collectPods(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("pods", err) {
		return
	}
	for i := range list.Items {
		pod := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&pod.ObjectMeta, "", "v1", "Pod", "pods", pod.Namespace),
			creationTimestamp: objectCreationTimestamp(&pod.ObjectMeta),
			status:            objectMapPodStatus(pod),
			owners:            pod.OwnerReferences,
			labels:            cloneStringMap(pod.Labels),
			pod:               &pod,
		})
	}
}

func (idx *objectMapIndex) collectServices(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().Services(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("services", err) {
		return
	}
	for i := range list.Items {
		svc := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&svc.ObjectMeta, "", "v1", "Service", "services", svc.Namespace),
			creationTimestamp: objectCreationTimestamp(&svc.ObjectMeta),
			status:            objectMapServiceStatus(svc),
			owners:            svc.OwnerReferences,
			labels:            cloneStringMap(svc.Labels),
			service:           &svc,
		})
	}
}

func (idx *objectMapIndex) collectEndpointSlices(ctx context.Context, client kubernetes.Interface) {
	list, err := client.DiscoveryV1().EndpointSlices(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("endpointslices", err) {
		return
	}
	for i := range list.Items {
		slice := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&slice.ObjectMeta, "discovery.k8s.io", "v1", "EndpointSlice", "endpointslices", slice.Namespace),
			creationTimestamp: objectCreationTimestamp(&slice.ObjectMeta),
			owners:            slice.OwnerReferences,
			labels:            cloneStringMap(slice.Labels),
			slice:             &slice,
		})
	}
}

func (idx *objectMapIndex) collectPVCs(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().PersistentVolumeClaims(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("persistentvolumeclaims", err) {
		return
	}
	for i := range list.Items {
		pvc := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&pvc.ObjectMeta, "", "v1", "PersistentVolumeClaim", "persistentvolumeclaims", pvc.Namespace),
			creationTimestamp: objectCreationTimestamp(&pvc.ObjectMeta),
			status:            objectMapPVCStatus(pvc),
			owners:            pvc.OwnerReferences,
			labels:            cloneStringMap(pvc.Labels),
			pvc:               &pvc,
		})
	}
}

func (idx *objectMapIndex) collectPVs(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
	if idx.skipListError("persistentvolumes", err) {
		return
	}
	for i := range list.Items {
		pv := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&pv.ObjectMeta, "", "v1", "PersistentVolume", "persistentvolumes", ""),
			creationTimestamp: objectCreationTimestamp(&pv.ObjectMeta),
			status:            objectMapPVStatus(pv),
			owners:            pv.OwnerReferences,
			labels:            cloneStringMap(pv.Labels),
			pv:                &pv,
		})
	}
}

func (idx *objectMapIndex) collectStorageClasses(ctx context.Context, client kubernetes.Interface) {
	list, err := client.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if idx.skipListError("storageclasses", err) {
		return
	}
	for i := range list.Items {
		sc := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&sc.ObjectMeta, "storage.k8s.io", "v1", "StorageClass", "storageclasses", ""),
			creationTimestamp: objectCreationTimestamp(&sc.ObjectMeta),
			owners:            sc.OwnerReferences,
			labels:            cloneStringMap(sc.Labels),
			storage:           &sc,
		})
	}
}

func (idx *objectMapIndex) collectConfigMaps(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().ConfigMaps(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("configmaps", err) {
		return
	}
	for i := range list.Items {
		cm := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&cm.ObjectMeta, "", "v1", "ConfigMap", "configmaps", cm.Namespace),
			creationTimestamp: objectCreationTimestamp(&cm.ObjectMeta),
			owners:            cm.OwnerReferences,
			labels:            cloneStringMap(cm.Labels),
		})
	}
}

func (idx *objectMapIndex) collectSecrets(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().Secrets(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("secrets", err) {
		return
	}
	for i := range list.Items {
		secret := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&secret.ObjectMeta, "", "v1", "Secret", "secrets", secret.Namespace),
			creationTimestamp: objectCreationTimestamp(&secret.ObjectMeta),
			owners:            secret.OwnerReferences,
			labels:            cloneStringMap(secret.Labels),
		})
	}
}

func (idx *objectMapIndex) collectServiceAccounts(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().ServiceAccounts(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("serviceaccounts", err) {
		return
	}
	for i := range list.Items {
		sa := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&sa.ObjectMeta, "", "v1", "ServiceAccount", "serviceaccounts", sa.Namespace),
			creationTimestamp: objectCreationTimestamp(&sa.ObjectMeta),
			owners:            sa.OwnerReferences,
			labels:            cloneStringMap(sa.Labels),
		})
	}
}

func (idx *objectMapIndex) collectNodes(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if idx.skipListError("nodes", err) {
		return
	}
	for i := range list.Items {
		node := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&node.ObjectMeta, "", "v1", "Node", "nodes", ""),
			creationTimestamp: objectCreationTimestamp(&node.ObjectMeta),
			status:            objectMapNodeStatus(node),
			owners:            node.OwnerReferences,
			labels:            cloneStringMap(node.Labels),
		})
	}
}

func (idx *objectMapIndex) collectDeployments(ctx context.Context, client kubernetes.Interface) {
	list, err := client.AppsV1().Deployments(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("deployments", err) {
		return
	}
	for i := range list.Items {
		deploy := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&deploy.ObjectMeta, "apps", "v1", "Deployment", "deployments", deploy.Namespace),
			creationTimestamp: objectCreationTimestamp(&deploy.ObjectMeta),
			status:            objectMapDeploymentStatus(deploy),
			owners:            deploy.OwnerReferences,
			labels:            cloneStringMap(deploy.Labels),
			template:          &deploy.Spec.Template,
		})
	}
}

func (idx *objectMapIndex) collectReplicaSets(ctx context.Context, client kubernetes.Interface) {
	list, err := client.AppsV1().ReplicaSets(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("replicasets", err) {
		return
	}
	for i := range list.Items {
		rs := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&rs.ObjectMeta, "apps", "v1", "ReplicaSet", "replicasets", rs.Namespace),
			creationTimestamp: objectCreationTimestamp(&rs.ObjectMeta),
			owners:            rs.OwnerReferences,
			labels:            cloneStringMap(rs.Labels),
			template:          &rs.Spec.Template,
		})
	}
}

func (idx *objectMapIndex) collectStatefulSets(ctx context.Context, client kubernetes.Interface) {
	list, err := client.AppsV1().StatefulSets(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("statefulsets", err) {
		return
	}
	for i := range list.Items {
		sts := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&sts.ObjectMeta, "apps", "v1", "StatefulSet", "statefulsets", sts.Namespace),
			creationTimestamp: objectCreationTimestamp(&sts.ObjectMeta),
			status:            objectMapStatefulSetStatus(sts),
			owners:            sts.OwnerReferences,
			labels:            cloneStringMap(sts.Labels),
			template:          &sts.Spec.Template,
		})
	}
}

func (idx *objectMapIndex) collectDaemonSets(ctx context.Context, client kubernetes.Interface) {
	list, err := client.AppsV1().DaemonSets(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("daemonsets", err) {
		return
	}
	for i := range list.Items {
		ds := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&ds.ObjectMeta, "apps", "v1", "DaemonSet", "daemonsets", ds.Namespace),
			creationTimestamp: objectCreationTimestamp(&ds.ObjectMeta),
			status:            objectMapDaemonSetStatus(ds),
			owners:            ds.OwnerReferences,
			labels:            cloneStringMap(ds.Labels),
			template:          &ds.Spec.Template,
		})
	}
}

func (idx *objectMapIndex) collectJobs(ctx context.Context, client kubernetes.Interface) {
	list, err := client.BatchV1().Jobs(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("jobs", err) {
		return
	}
	for i := range list.Items {
		job := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&job.ObjectMeta, "batch", "v1", "Job", "jobs", job.Namespace),
			creationTimestamp: objectCreationTimestamp(&job.ObjectMeta),
			status:            objectMapJobStatus(job),
			owners:            job.OwnerReferences,
			labels:            cloneStringMap(job.Labels),
			template:          job.Spec.Template.DeepCopy(),
		})
	}
}

func (idx *objectMapIndex) collectCronJobs(ctx context.Context, client kubernetes.Interface) {
	list, err := client.BatchV1().CronJobs(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("cronjobs", err) {
		return
	}
	for i := range list.Items {
		cron := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&cron.ObjectMeta, "batch", "v1", "CronJob", "cronjobs", cron.Namespace),
			creationTimestamp: objectCreationTimestamp(&cron.ObjectMeta),
			status:            objectMapCronJobStatus(cron),
			owners:            cron.OwnerReferences,
			labels:            cloneStringMap(cron.Labels),
			cronJobTpl:        cron.Spec.JobTemplate.Spec.Template.DeepCopy(),
		})
	}
}

func (idx *objectMapIndex) collectHPAs(ctx context.Context, client kubernetes.Interface) {
	list, err := client.AutoscalingV2().HorizontalPodAutoscalers(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("horizontalpodautoscalers", err) {
		return
	}
	for i := range list.Items {
		hpa := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&hpa.ObjectMeta, "autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", hpa.Namespace),
			creationTimestamp: objectCreationTimestamp(&hpa.ObjectMeta),
			status:            objectMapHPAStatus(hpa),
			owners:            hpa.OwnerReferences,
			labels:            cloneStringMap(hpa.Labels),
			hpa:               &hpa,
		})
	}
}

func (idx *objectMapIndex) collectIngresses(ctx context.Context, client kubernetes.Interface) {
	list, err := client.NetworkingV1().Ingresses(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("ingresses", err) {
		return
	}
	for i := range list.Items {
		ing := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&ing.ObjectMeta, "networking.k8s.io", "v1", "Ingress", "ingresses", ing.Namespace),
			creationTimestamp: objectCreationTimestamp(&ing.ObjectMeta),
			status:            objectMapIngressStatus(ing),
			owners:            ing.OwnerReferences,
			labels:            cloneStringMap(ing.Labels),
			ingress:           &ing,
		})
	}
}

func (idx *objectMapIndex) collectIngressClasses(ctx context.Context, client kubernetes.Interface) {
	list, err := client.NetworkingV1().IngressClasses().List(ctx, metav1.ListOptions{})
	if idx.skipListError("ingressclasses", err) {
		return
	}
	for i := range list.Items {
		ingClass := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&ingClass.ObjectMeta, "networking.k8s.io", "v1", "IngressClass", "ingressclasses", ""),
			creationTimestamp: objectCreationTimestamp(&ingClass.ObjectMeta),
			owners:            ingClass.OwnerReferences,
			labels:            cloneStringMap(ingClass.Labels),
			ingClass:          &ingClass,
		})
	}
}

func (idx *objectMapIndex) collectClusterRoles(ctx context.Context, client kubernetes.Interface) {
	list, err := client.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{})
	if idx.skipListError("clusterroles", err) {
		return
	}
	for i := range list.Items {
		role := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&role.ObjectMeta, "rbac.authorization.k8s.io", "v1", "ClusterRole", "clusterroles", ""),
			creationTimestamp: objectCreationTimestamp(&role.ObjectMeta),
			owners:            role.OwnerReferences,
			labels:            cloneStringMap(role.Labels),
			clusterRole:       &role,
		})
	}
}

func (idx *objectMapIndex) collectClusterRoleBindings(ctx context.Context, client kubernetes.Interface) {
	list, err := client.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if idx.skipListError("clusterrolebindings", err) {
		return
	}
	for i := range list.Items {
		binding := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:                refFromObject(&binding.ObjectMeta, "rbac.authorization.k8s.io", "v1", "ClusterRoleBinding", "clusterrolebindings", ""),
			creationTimestamp:  objectCreationTimestamp(&binding.ObjectMeta),
			owners:             binding.OwnerReferences,
			labels:             cloneStringMap(binding.Labels),
			clusterRoleBinding: &binding,
		})
	}
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
	if len(dst.owners) == 0 {
		dst.owners = src.owners
	}
	if len(dst.labels) == 0 {
		dst.labels = src.labels
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
	if src.hpa != nil {
		dst.hpa = src.hpa
	}
	if src.clusterRole != nil {
		dst.clusterRole = src.clusterRole
	}
	if src.clusterRoleBinding != nil {
		dst.clusterRoleBinding = src.clusterRoleBinding
	}
	if src.template != nil {
		dst.template = src.template
	}
	if src.cronJobTpl != nil {
		dst.cronJobTpl = src.cronJobTpl
	}
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
	}
}

func cloneObjectMapStatus(status *ObjectMapStatus) *ObjectMapStatus {
	if status == nil {
		return nil
	}
	clone := *status
	return &clone
}

func objectMapStatus(state, label string, reasons ...string) *ObjectMapStatus {
	status := &ObjectMapStatus{State: state, Label: label}
	for _, reason := range reasons {
		if strings.TrimSpace(reason) != "" {
			status.Reason = reason
			break
		}
	}
	return status
}

func objectMapReplicasStatus(ready, desired int32) *ObjectMapStatus {
	if desired == 0 {
		return objectMapStatus("inactive", "Scaled to 0")
	}
	label := fmt.Sprintf("%d/%d ready", ready, desired)
	if ready >= desired {
		return objectMapStatus("healthy", label)
	}
	if ready > 0 {
		return objectMapStatus("degraded", label)
	}
	return objectMapStatus("degraded", label)
}

func objectMapPodStatus(pod corev1.Pod) *ObjectMapStatus {
	label := objectMapPodStatusLabel(pod)
	switch {
	case label == "Running":
		ready, total := objectMapPodReadyContainers(pod)
		if total > 0 && ready == total {
			return objectMapStatus("healthy", label)
		}
		if total > 0 {
			return objectMapStatus("degraded", fmt.Sprintf("%d/%d ready", ready, total))
		}
		return objectMapStatus("degraded", label)
	case label == "Succeeded":
		return objectMapStatus("healthy", label)
	case label == "Unknown":
		return objectMapStatus("inactive", label)
	case objectMapPodDegradedStatusLabel(label):
		return objectMapStatus("degraded", label)
	default:
		return objectMapStatus("unhealthy", label)
	}
}

func objectMapPodStatusLabel(pod corev1.Pod) string {
	if pod.Status.Phase == corev1.PodFailed && pod.Status.Reason == "Evicted" {
		return "Evicted"
	}
	for _, status := range pod.Status.InitContainerStatuses {
		if status.State.Terminated != nil && status.State.Terminated.ExitCode != 0 {
			if status.State.Terminated.Reason != "" {
				return "Init:" + status.State.Terminated.Reason
			}
			return "Init:Error"
		}
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" && status.State.Waiting.Reason != "PodInitializing" {
			return "Init:" + status.State.Waiting.Reason
		}
	}
	for _, status := range pod.Status.ContainerStatuses {
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" {
			return status.State.Waiting.Reason
		}
		if status.State.Terminated != nil && status.State.Terminated.Reason != "" {
			return status.State.Terminated.Reason
		}
	}
	if pod.DeletionTimestamp != nil {
		return "Terminating"
	}
	if pod.Status.Phase != "" {
		return string(pod.Status.Phase)
	}
	return "Unknown"
}

func objectMapPodReadyContainers(pod corev1.Pod) (int, int) {
	statusByName := make(map[string]corev1.ContainerStatus, len(pod.Status.ContainerStatuses))
	for _, status := range pod.Status.ContainerStatuses {
		statusByName[status.Name] = status
	}

	if len(pod.Spec.Containers) == 0 {
		ready := 0
		for _, status := range pod.Status.ContainerStatuses {
			if status.Ready {
				ready++
			}
		}
		return ready, len(pod.Status.ContainerStatuses)
	}

	ready := 0
	for _, container := range pod.Spec.Containers {
		if status, ok := statusByName[container.Name]; ok && status.Ready {
			ready++
		}
	}
	return ready, len(pod.Spec.Containers)
}

func objectMapPodDegradedStatusLabel(label string) bool {
	switch label {
	case "Pending", "Terminating", "ContainerCreating", "PodInitializing":
		return true
	default:
		return strings.HasPrefix(label, "Init:")
	}
}

func objectMapServiceStatus(service corev1.Service) *ObjectMapStatus {
	if service.Spec.Type == corev1.ServiceTypeLoadBalancer {
		if len(service.Status.LoadBalancer.Ingress) > 0 {
			return objectMapStatus("healthy", "LoadBalancer active")
		}
		return objectMapStatus("degraded", "LoadBalancer pending")
	}
	return nil
}

func objectMapPVCStatus(pvc corev1.PersistentVolumeClaim) *ObjectMapStatus {
	switch pvc.Status.Phase {
	case corev1.ClaimBound:
		return objectMapStatus("healthy", string(pvc.Status.Phase))
	case corev1.ClaimLost:
		return objectMapStatus("unhealthy", string(pvc.Status.Phase))
	case corev1.ClaimPending:
		return objectMapStatus("degraded", string(pvc.Status.Phase))
	default:
		if pvc.Status.Phase == "" {
			return nil
		}
		return objectMapStatus("inactive", string(pvc.Status.Phase))
	}
}

func objectMapPVStatus(pv corev1.PersistentVolume) *ObjectMapStatus {
	switch pv.Status.Phase {
	case corev1.VolumeBound, corev1.VolumeAvailable:
		return objectMapStatus("healthy", string(pv.Status.Phase))
	case corev1.VolumeFailed:
		return objectMapStatus("unhealthy", string(pv.Status.Phase), pv.Status.Reason)
	case corev1.VolumePending:
		return objectMapStatus("degraded", string(pv.Status.Phase))
	case corev1.VolumeReleased:
		return objectMapStatus("inactive", string(pv.Status.Phase))
	default:
		if pv.Status.Phase == "" {
			return nil
		}
		return objectMapStatus("inactive", string(pv.Status.Phase))
	}
}

func objectMapNodeStatus(node corev1.Node) *ObjectMapStatus {
	for _, condition := range node.Status.Conditions {
		if condition.Type != corev1.NodeReady {
			continue
		}
		if condition.Status == corev1.ConditionTrue {
			if objectMapNodeCordoned(node) {
				return objectMapStatus("degraded", "Ready (Cordoned)", condition.Reason)
			}
			return objectMapStatus("healthy", "Ready", condition.Reason)
		}
		if condition.Status == corev1.ConditionUnknown {
			return objectMapStatus("inactive", "Unknown", condition.Reason)
		}
		return objectMapStatus("unhealthy", "NotReady", condition.Reason)
	}
	return objectMapStatus("inactive", "Unknown")
}

func objectMapNodeCordoned(node corev1.Node) bool {
	if node.Spec.Unschedulable {
		return true
	}
	for _, taint := range node.Spec.Taints {
		if taint.Key == corev1.TaintNodeUnschedulable {
			return true
		}
	}
	return false
}

func objectMapDeploymentStatus(deploy appsv1.Deployment) *ObjectMapStatus {
	for _, condition := range deploy.Status.Conditions {
		if condition.Type == appsv1.DeploymentProgressing && condition.Reason == "ProgressDeadlineExceeded" && condition.Status == corev1.ConditionFalse {
			return objectMapStatus("unhealthy", "Progress deadline", condition.Message)
		}
	}
	desired := int32(1)
	if deploy.Spec.Replicas != nil {
		desired = *deploy.Spec.Replicas
	}
	return objectMapReplicasStatus(deploy.Status.ReadyReplicas, desired)
}

func objectMapStatefulSetStatus(sts appsv1.StatefulSet) *ObjectMapStatus {
	desired := int32(1)
	if sts.Spec.Replicas != nil {
		desired = *sts.Spec.Replicas
	}
	return objectMapReplicasStatus(sts.Status.ReadyReplicas, desired)
}

func objectMapDaemonSetStatus(ds appsv1.DaemonSet) *ObjectMapStatus {
	if ds.Status.DesiredNumberScheduled == 0 {
		return objectMapStatus("inactive", "Scaled to 0")
	}
	if ds.Status.NumberReady >= ds.Status.DesiredNumberScheduled {
		return objectMapStatus("healthy", fmt.Sprintf("%d/%d ready", ds.Status.NumberReady, ds.Status.DesiredNumberScheduled))
	}
	return objectMapStatus("degraded", fmt.Sprintf("%d/%d ready", ds.Status.NumberReady, ds.Status.DesiredNumberScheduled))
}

func objectMapJobStatus(job batchv1.Job) *ObjectMapStatus {
	for _, condition := range job.Status.Conditions {
		if condition.Type == batchv1.JobFailed && condition.Status == corev1.ConditionTrue {
			return objectMapStatus("unhealthy", "Failed", condition.Message)
		}
		if condition.Type == batchv1.JobComplete && condition.Status == corev1.ConditionTrue {
			return objectMapStatus("healthy", "Complete", condition.Message)
		}
	}
	if job.Spec.Suspend != nil && *job.Spec.Suspend {
		return objectMapStatus("inactive", "Suspended")
	}
	if job.Status.Active > 0 {
		return objectMapStatus("healthy", "Running")
	}
	if job.Status.Failed > 0 {
		return objectMapStatus("unhealthy", "Failed")
	}
	return objectMapStatus("degraded", "Pending")
}

func objectMapCronJobStatus(cron batchv1.CronJob) *ObjectMapStatus {
	if cron.Spec.Suspend != nil && *cron.Spec.Suspend {
		return objectMapStatus("inactive", "Suspended")
	}
	if len(cron.Status.Active) > 0 {
		return objectMapStatus("healthy", "Active")
	}
	return objectMapStatus("inactive", "Idle")
}

func objectMapHPAStatus(hpa autoscalingv2.HorizontalPodAutoscaler) *ObjectMapStatus {
	for _, condition := range hpa.Status.Conditions {
		if condition.Status != corev1.ConditionFalse {
			continue
		}
		switch condition.Type {
		case autoscalingv2.AbleToScale, autoscalingv2.ScalingActive:
			return objectMapStatus("unhealthy", string(condition.Type), condition.Message)
		}
	}
	if hpa.Status.DesiredReplicas != hpa.Status.CurrentReplicas {
		return objectMapStatus("degraded", fmt.Sprintf("%d/%d replicas", hpa.Status.CurrentReplicas, hpa.Status.DesiredReplicas))
	}
	return objectMapStatus("healthy", fmt.Sprintf("%d replicas", hpa.Status.CurrentReplicas))
}

func objectMapIngressStatus(ingress networkingv1.Ingress) *ObjectMapStatus {
	if len(ingress.Status.LoadBalancer.Ingress) > 0 {
		return objectMapStatus("healthy", "Address assigned")
	}
	return objectMapStatus("degraded", "Address pending")
}

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
		record.hpa != nil ||
		record.clusterRole != nil ||
		record.clusterRoleBinding != nil ||
		record.template != nil ||
		record.cronJobTpl != nil ||
		record.ref.Kind == "ConfigMap" ||
		record.ref.Kind == "Secret" ||
		record.ref.Kind == "ServiceAccount" ||
		record.ref.Kind == "Node"
}

func stopsNamespaceMapReverseExpansion(ref ObjectMapReference) bool {
	switch ref.Kind {
	case "StorageClass", "IngressClass":
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
		if record.service != nil {
			for _, pod := range idx.matchingPods(record.ref.Namespace, record.service.Spec.Selector) {
				relationship := objectMapRelationships[objectMapEdgeSelector]
				add(record, pod, relationship.typ, relationship.label, relationship.defaultTracedBy)
			}
			for _, slice := range idx.endpointSlicesForService(record.ref.Namespace, record.ref.Name) {
				relationship := objectMapRelationships[objectMapEdgeEndpoint]
				add(record, slice, relationship.typ, relationship.label, discoveryv1.LabelServiceName)
			}
		}
		if record.slice != nil {
			for _, endpoint := range record.slice.Endpoints {
				if endpoint.TargetRef == nil {
					continue
				}
				target := idx.resolveCoreObjectRef(record.ref.Namespace, endpoint.TargetRef)
				add(record, target, objectMapEdgeEndpoint, "routes to", "endpoints.targetRef")
			}
		}
		if record.pod != nil {
			idx.addPodEdges(record, add)
		}
		if record.pvc != nil && record.pvc.Spec.VolumeName != "" {
			target := idx.findCore("", "v1", "PersistentVolume", record.pvc.Spec.VolumeName)
			relationship := objectMapRelationships[objectMapEdgeVolumeBinding]
			add(record, target, relationship.typ, relationship.label, relationship.defaultTracedBy)
		}
		if record.pvc != nil && record.pvc.Spec.VolumeName == "" && record.pvc.Spec.StorageClassName != nil && *record.pvc.Spec.StorageClassName != "" {
			target := idx.findStorageClass(*record.pvc.Spec.StorageClassName)
			relationship := objectMapRelationships[objectMapEdgeStorageClass]
			add(record, target, relationship.typ, relationship.label, relationship.defaultTracedBy)
		}
		if record.pv != nil && record.pv.Spec.StorageClassName != "" {
			target := idx.findStorageClass(record.pv.Spec.StorageClassName)
			relationship := objectMapRelationships[objectMapEdgeStorageClass]
			add(record, target, relationship.typ, relationship.label, relationship.defaultTracedBy)
		}
		if record.ingress != nil {
			if className, tracedBy := ingressClassName(record.ingress); className != "" {
				target := idx.findIngressClass(className)
				add(record, target, objectMapEdgeUses, "uses class", tracedBy)
			}
			for _, serviceName := range ingressBackendServices(record.ingress) {
				target := idx.findCore(record.ref.Namespace, "v1", "Service", serviceName)
				relationship := objectMapRelationships[objectMapEdgeRoutes]
				add(record, target, relationship.typ, relationship.label, "spec.backend.service")
			}
		}
		if record.hpa != nil {
			gv, err := schema.ParseGroupVersion(record.hpa.Spec.ScaleTargetRef.APIVersion)
			if err != nil {
				continue
			}
			target := idx.byIdent[objectMapIdentityKey(record.ref.Namespace, gv.Group, gv.Version, record.hpa.Spec.ScaleTargetRef.Kind, record.hpa.Spec.ScaleTargetRef.Name)]
			relationship := objectMapRelationships[objectMapEdgeScales]
			add(record, target, relationship.typ, relationship.label, relationship.defaultTracedBy)
		}
		if record.clusterRole != nil && record.clusterRole.AggregationRule != nil {
			for _, selector := range record.clusterRole.AggregationRule.ClusterRoleSelectors {
				for _, target := range idx.clusterRolesMatchingSelector(selector) {
					relationship := objectMapRelationships[objectMapEdgeAggregates]
					add(record, target, relationship.typ, relationship.label, relationship.defaultTracedBy)
				}
			}
		}
		if record.clusterRoleBinding != nil {
			target := idx.clusterRoleBindingRoleRef(record.clusterRoleBinding.RoleRef)
			relationship := objectMapRelationships[objectMapEdgeGrants]
			add(record, target, relationship.typ, relationship.label, relationship.defaultTracedBy)
			for _, subject := range record.clusterRoleBinding.Subjects {
				target := idx.clusterRoleBindingSubject(subject)
				relationship := objectMapRelationships[objectMapEdgeBinds]
				add(record, target, relationship.typ, relationship.label, relationship.defaultTracedBy)
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

func (idx *objectMapIndex) findClusterRole(name string) *objectMapRecord {
	return idx.byIdent[objectMapIdentityKey("", "rbac.authorization.k8s.io", "v1", "ClusterRole", name)]
}

func (idx *objectMapIndex) clusterRoleBindingRoleRef(ref rbacv1.RoleRef) *objectMapRecord {
	if ref.Kind != "ClusterRole" || ref.Name == "" {
		return nil
	}
	return idx.findClusterRole(ref.Name)
}

func (idx *objectMapIndex) clusterRoleBindingSubject(subject rbacv1.Subject) *objectMapRecord {
	if subject.Kind != "ServiceAccount" || subject.Name == "" || subject.Namespace == "" {
		return nil
	}
	return idx.findCore(subject.Namespace, "v1", "ServiceAccount", subject.Name)
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

func ingressClassName(ing *networkingv1.Ingress) (string, string) {
	if ing == nil {
		return "", ""
	}
	if ing.Spec.IngressClassName != nil && strings.TrimSpace(*ing.Spec.IngressClassName) != "" {
		return strings.TrimSpace(*ing.Spec.IngressClassName), "spec.ingressClassName"
	}
	if ing.Annotations != nil && strings.TrimSpace(ing.Annotations["kubernetes.io/ingress.class"]) != "" {
		return strings.TrimSpace(ing.Annotations["kubernetes.io/ingress.class"]), "metadata.annotations[kubernetes.io/ingress.class]"
	}
	return "", ""
}

func isIngressRef(ref ObjectMapReference) bool {
	return ref.Group == "networking.k8s.io" && ref.Version == "v1" && ref.Kind == "Ingress"
}

func isIngressClassRef(ref ObjectMapReference) bool {
	return ref.Group == "networking.k8s.io" && ref.Version == "v1" && ref.Kind == "IngressClass"
}

func ingressBackendServices(ing *networkingv1.Ingress) []string {
	if ing == nil {
		return nil
	}
	seen := map[string]struct{}{}
	add := func(name string) {
		if name == "" {
			return
		}
		seen[name] = struct{}{}
	}
	if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
		add(ing.Spec.DefaultBackend.Service.Name)
	}
	for _, rule := range ing.Spec.Rules {
		if rule.HTTP == nil {
			continue
		}
		for _, path := range rule.HTTP.Paths {
			if path.Backend.Service != nil {
				add(path.Backend.Service.Name)
			}
		}
	}
	result := make([]string, 0, len(seen))
	for name := range seen {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
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

func refFromObject(meta *metav1.ObjectMeta, group, version, kind, resource, namespace string) ObjectMapReference {
	ref := ObjectMapReference{
		Group:     group,
		Version:   version,
		Kind:      kind,
		Resource:  resource,
		Namespace: namespace,
	}
	if meta != nil {
		ref.Name = meta.Name
		ref.UID = string(meta.UID)
		if ref.Namespace == "" {
			ref.Namespace = meta.Namespace
		}
	}
	return ref
}

func objectCreationTimestamp(meta *metav1.ObjectMeta) string {
	if meta == nil || meta.CreationTimestamp.IsZero() {
		return ""
	}
	return meta.CreationTimestamp.UTC().Format(time.RFC3339)
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
