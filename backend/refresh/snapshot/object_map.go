package snapshot

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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
	ID    string             `json:"id"`
	Depth int                `json:"depth"`
	Ref   ObjectMapReference `json:"ref"`
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

type objectMapOptions struct {
	identity scopeObjectIdentity
	maxDepth int
	maxNodes int
}

type objectMapRecord struct {
	ref        ObjectMapReference
	owners     []metav1.OwnerReference
	labels     map[string]string
	pod        *corev1.Pod
	service    *corev1.Service
	slice      *discoveryv1.EndpointSlice
	pvc        *corev1.PersistentVolumeClaim
	ingress    *networkingv1.Ingress
	hpa        *autoscalingv2.HorizontalPodAutoscaler
	template   *corev1.PodTemplateSpec
	cronJobTpl *corev1.PodTemplateSpec
}

type objectMapIndex struct {
	meta     ClusterMeta
	records  map[string]*objectMapRecord
	byUID    map[string]*objectMapRecord
	byIdent  map[string]*objectMapRecord
	warnings []string
}

type objectMapGraph struct {
	nodes     map[string]ObjectMapNode
	edges     map[string]ObjectMapEdge
	adjacency map[string][]string
	truncated bool
}

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
	if opts.identity.GVK.Group == "" && opts.identity.GVK.Version == "" {
		return nil, fmt.Errorf("object-map scope for %s/%s is missing group/version", opts.identity.GVK.Kind, opts.identity.Name)
	}

	meta := ClusterMetaFromContext(ctx)
	index := newObjectMapIndex(meta)
	index.addCatalog(b.catalog())
	index.collectTyped(ctx, b.client)

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

func (b *objectMapBuilder) catalog() *objectcatalog.Service {
	if b == nil || b.catalogService == nil {
		return nil
	}
	return b.catalogService()
}

func parseObjectMapScope(scope string) (objectMapOptions, error) {
	objectScope, rawQuery, hasQuery := strings.Cut(scope, "?")
	identity, err := parseObjectScope(objectScope)
	if err != nil {
		return objectMapOptions{}, err
	}
	opts := objectMapOptions{
		identity: identity,
		maxDepth: defaultObjectMapDepth,
		maxNodes: defaultObjectMapNodes,
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
		idx.addRecord(&objectMapRecord{ref: refFromCatalog(item)})
	}
}

func (idx *objectMapIndex) collectTyped(ctx context.Context, client kubernetes.Interface) {
	if idx == nil || client == nil {
		return
	}
	idx.collectPods(ctx, client)
	idx.collectServices(ctx, client)
	idx.collectEndpointSlices(ctx, client)
	idx.collectPVCs(ctx, client)
	idx.collectPVs(ctx, client)
	idx.collectConfigMaps(ctx, client)
	idx.collectSecrets(ctx, client)
	idx.collectServiceAccounts(ctx, client)
	idx.collectNodes(ctx, client)
	idx.collectDeployments(ctx, client)
	idx.collectReplicaSets(ctx, client)
	idx.collectStatefulSets(ctx, client)
	idx.collectDaemonSets(ctx, client)
	idx.collectJobs(ctx, client)
	idx.collectCronJobs(ctx, client)
	idx.collectHPAs(ctx, client)
	idx.collectIngresses(ctx, client)
}

func (idx *objectMapIndex) collectPods(ctx context.Context, client kubernetes.Interface) {
	list, err := client.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if idx.skipListError("pods", err) {
		return
	}
	for i := range list.Items {
		pod := list.Items[i]
		idx.addRecord(&objectMapRecord{
			ref:    refFromObject(&pod.ObjectMeta, "", "v1", "Pod", "pods", pod.Namespace),
			owners: pod.OwnerReferences,
			labels: cloneStringMap(pod.Labels),
			pod:    &pod,
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
			ref:     refFromObject(&svc.ObjectMeta, "", "v1", "Service", "services", svc.Namespace),
			owners:  svc.OwnerReferences,
			labels:  cloneStringMap(svc.Labels),
			service: &svc,
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
			ref:    refFromObject(&slice.ObjectMeta, "discovery.k8s.io", "v1", "EndpointSlice", "endpointslices", slice.Namespace),
			owners: slice.OwnerReferences,
			labels: cloneStringMap(slice.Labels),
			slice:  &slice,
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
			ref:    refFromObject(&pvc.ObjectMeta, "", "v1", "PersistentVolumeClaim", "persistentvolumeclaims", pvc.Namespace),
			owners: pvc.OwnerReferences,
			labels: cloneStringMap(pvc.Labels),
			pvc:    &pvc,
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
			ref:    refFromObject(&pv.ObjectMeta, "", "v1", "PersistentVolume", "persistentvolumes", ""),
			owners: pv.OwnerReferences,
			labels: cloneStringMap(pv.Labels),
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
			ref:    refFromObject(&cm.ObjectMeta, "", "v1", "ConfigMap", "configmaps", cm.Namespace),
			owners: cm.OwnerReferences,
			labels: cloneStringMap(cm.Labels),
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
			ref:    refFromObject(&secret.ObjectMeta, "", "v1", "Secret", "secrets", secret.Namespace),
			owners: secret.OwnerReferences,
			labels: cloneStringMap(secret.Labels),
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
			ref:    refFromObject(&sa.ObjectMeta, "", "v1", "ServiceAccount", "serviceaccounts", sa.Namespace),
			owners: sa.OwnerReferences,
			labels: cloneStringMap(sa.Labels),
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
			ref:    refFromObject(&node.ObjectMeta, "", "v1", "Node", "nodes", ""),
			owners: node.OwnerReferences,
			labels: cloneStringMap(node.Labels),
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
			ref:      refFromObject(&deploy.ObjectMeta, "apps", "v1", "Deployment", "deployments", deploy.Namespace),
			owners:   deploy.OwnerReferences,
			labels:   cloneStringMap(deploy.Labels),
			template: &deploy.Spec.Template,
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
			ref:      refFromObject(&rs.ObjectMeta, "apps", "v1", "ReplicaSet", "replicasets", rs.Namespace),
			owners:   rs.OwnerReferences,
			labels:   cloneStringMap(rs.Labels),
			template: &rs.Spec.Template,
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
			ref:      refFromObject(&sts.ObjectMeta, "apps", "v1", "StatefulSet", "statefulsets", sts.Namespace),
			owners:   sts.OwnerReferences,
			labels:   cloneStringMap(sts.Labels),
			template: &sts.Spec.Template,
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
			ref:      refFromObject(&ds.ObjectMeta, "apps", "v1", "DaemonSet", "daemonsets", ds.Namespace),
			owners:   ds.OwnerReferences,
			labels:   cloneStringMap(ds.Labels),
			template: &ds.Spec.Template,
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
			ref:      refFromObject(&job.ObjectMeta, "batch", "v1", "Job", "jobs", job.Namespace),
			owners:   job.OwnerReferences,
			labels:   cloneStringMap(job.Labels),
			template: job.Spec.Template.DeepCopy(),
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
			ref:        refFromObject(&cron.ObjectMeta, "batch", "v1", "CronJob", "cronjobs", cron.Namespace),
			owners:     cron.OwnerReferences,
			labels:     cloneStringMap(cron.Labels),
			cronJobTpl: cron.Spec.JobTemplate.Spec.Template.DeepCopy(),
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
			ref:    refFromObject(&hpa.ObjectMeta, "autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", hpa.Namespace),
			owners: hpa.OwnerReferences,
			labels: cloneStringMap(hpa.Labels),
			hpa:    &hpa,
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
			ref:     refFromObject(&ing.ObjectMeta, "networking.k8s.io", "v1", "Ingress", "ingresses", ing.Namespace),
			owners:  ing.OwnerReferences,
			labels:  cloneStringMap(ing.Labels),
			ingress: &ing,
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
	idx.warnings = append(idx.warnings, fmt.Sprintf("skipped %s: %v", resource, err))
	return true
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
	if src.ingress != nil {
		dst.ingress = src.ingress
	}
	if src.hpa != nil {
		dst.hpa = src.hpa
	}
	if src.template != nil {
		dst.template = src.template
	}
	if src.cronJobTpl != nil {
		dst.cronJobTpl = src.cronJobTpl
	}
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
	graph := objectMapGraph{
		nodes:     make(map[string]ObjectMapNode),
		edges:     make(map[string]ObjectMapEdge),
		adjacency: make(map[string][]string),
	}
	for _, edge := range allEdges {
		graph.adjacency[edge.Source] = append(graph.adjacency[edge.Source], edge.ID)
		graph.adjacency[edge.Target] = append(graph.adjacency[edge.Target], edge.ID)
		graph.edges[edge.ID] = edge
	}

	seedID := objectMapNodeID(seed.ref)
	graph.nodes[seedID] = ObjectMapNode{ID: seedID, Depth: 0, Ref: seed.ref}
	queue := []string{seedID}

	for len(queue) > 0 {
		currentID := queue[0]
		queue = queue[1:]
		currentDepth := graph.nodes[currentID].Depth
		if currentDepth >= maxDepth {
			continue
		}
		for _, edgeID := range graph.adjacency[currentID] {
			edge := graph.edges[edgeID]
			neighborID := edge.Source
			if neighborID == currentID {
				neighborID = edge.Target
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
			graph.nodes[neighborID] = ObjectMapNode{ID: neighborID, Depth: currentDepth + 1, Ref: record.ref}
			queue = append(queue, neighborID)
		}
	}

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
			add(ownerRecord, record, "owner", "owns", owner.Name)
		}
	}

	for _, record := range idx.records {
		if record.service != nil {
			for _, pod := range idx.matchingPods(record.ref.Namespace, record.service.Spec.Selector) {
				add(record, pod, "selector", "selects", "spec.selector")
			}
			for _, slice := range idx.endpointSlicesForService(record.ref.Namespace, record.ref.Name) {
				add(record, slice, "endpoint", "has endpoints", discoveryv1.LabelServiceName)
			}
		}
		if record.slice != nil {
			for _, endpoint := range record.slice.Endpoints {
				if endpoint.TargetRef == nil {
					continue
				}
				target := idx.resolveCoreObjectRef(record.ref.Namespace, endpoint.TargetRef)
				add(record, target, "endpoint", "routes to", "endpoints.targetRef")
			}
		}
		if record.pod != nil {
			idx.addPodEdges(record, add)
		}
		if record.pvc != nil && record.pvc.Spec.VolumeName != "" {
			target := idx.findCore("", "v1", "PersistentVolume", record.pvc.Spec.VolumeName)
			add(record, target, "storage", "binds", "spec.volumeName")
		}
		if record.ingress != nil {
			for _, serviceName := range ingressBackendServices(record.ingress) {
				target := idx.findCore(record.ref.Namespace, "v1", "Service", serviceName)
				add(record, target, "routes", "routes to", "spec.backend.service")
			}
		}
		if record.hpa != nil {
			gv, err := schema.ParseGroupVersion(record.hpa.Spec.ScaleTargetRef.APIVersion)
			if err != nil {
				continue
			}
			target := idx.byIdent[objectMapIdentityKey(record.ref.Namespace, gv.Group, gv.Version, record.hpa.Spec.ScaleTargetRef.Kind, record.hpa.Spec.ScaleTargetRef.Name)]
			add(record, target, "scales", "scales", "spec.scaleTargetRef")
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
		add(record, idx.findCore("", "v1", "Node", pod.Spec.NodeName), "schedules", "scheduled on", "spec.nodeName")
	}
	serviceAccount := pod.Spec.ServiceAccountName
	if serviceAccount == "" {
		serviceAccount = "default"
	}
	add(record, idx.findCore(record.ref.Namespace, "v1", "ServiceAccount", serviceAccount), "uses", "uses", "spec.serviceAccountName")
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
		add(record, idx.findCore(record.ref.Namespace, "v1", "ServiceAccount", serviceAccount), "uses", "uses", "template.spec.serviceAccountName")
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
		add(record, idx.findCore(namespace, "v1", "ConfigMap", volume.ConfigMap.Name), "uses", "uses", "volume.configMap")
	}
	if volume.Secret != nil && volume.Secret.SecretName != "" {
		add(record, idx.findCore(namespace, "v1", "Secret", volume.Secret.SecretName), "uses", "uses", "volume.secret")
	}
	if volume.PersistentVolumeClaim != nil && volume.PersistentVolumeClaim.ClaimName != "" {
		add(record, idx.findCore(namespace, "v1", "PersistentVolumeClaim", volume.PersistentVolumeClaim.ClaimName), "mounts", "mounts", "volume.persistentVolumeClaim")
	}
}

func (idx *objectMapIndex) addContainerEdges(record *objectMapRecord, namespace string, container corev1.Container, add func(*objectMapRecord, *objectMapRecord, string, string, string)) {
	for _, envFrom := range container.EnvFrom {
		if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name != "" {
			add(record, idx.findCore(namespace, "v1", "ConfigMap", envFrom.ConfigMapRef.Name), "uses", "uses", "envFrom.configMapRef")
		}
		if envFrom.SecretRef != nil && envFrom.SecretRef.Name != "" {
			add(record, idx.findCore(namespace, "v1", "Secret", envFrom.SecretRef.Name), "uses", "uses", "envFrom.secretRef")
		}
	}
	for _, env := range container.Env {
		if env.ValueFrom == nil {
			continue
		}
		if env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name != "" {
			add(record, idx.findCore(namespace, "v1", "ConfigMap", env.ValueFrom.ConfigMapKeyRef.Name), "uses", "uses", "env.configMapKeyRef")
		}
		if env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name != "" {
			add(record, idx.findCore(namespace, "v1", "Secret", env.ValueFrom.SecretKeyRef.Name), "uses", "uses", "env.secretKeyRef")
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
