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

	clusterrolepkg "github.com/luxury-yacht/app/backend/resources/clusterrole"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	podres "github.com/luxury-yacht/app/backend/resources/pods"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
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

// ObjectMapActionFacts carries the state needed to present context-menu actions
// without deriving meaning from missing graph edges. It aliases the neutral
// objectmap.ActionFacts so per-kind collector declarations can produce it without
// importing snapshot.
type ObjectMapActionFacts = objectmap.ActionFacts

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

// objectMapIngestSource supplies the projected object-map nodes for ingest-owned
// (cut) kinds, whose objects are no longer cached by the shared informer factory.
// *ingest.IngestManager satisfies it. The object map reads cut kinds' nodes from
// here and uncut kinds from the shared informer listers.
type objectMapIngestSource interface {
	ObjectMapRows(gvr schema.GroupVersionResource) []interface{}
}

type objectMapBuilder struct {
	gatewayShared   gatewayinformers.SharedInformerFactory
	gatewayPresence objectMapGatewayPresence
	catalogService  func() *objectcatalog.Service
	// shared supplies typed listers backed by the factory's already-synced
	// informer caches, so the graph is assembled from memory instead of ~21 live
	// cluster-wide LIST calls per refresh.
	shared      informers.SharedInformerFactory
	permissions objectMapPermissionChecker
	// ingest supplies projected object-map nodes for ingest-owned (cut) kinds. nil
	// when no kind in the build is ingest-owned (e.g. a unit test with no cut kinds).
	ingest objectMapIngestSource
	// allowedNamespaces is the cluster's namespace scope. Informer-backed
	// collectors filter their cluster-wide caches to this set.
	allowedNamespaces []string
}

// objectMapTypedSource carries everything collectTyped needs for one build.
type objectMapTypedSource struct {
	shared      informers.SharedInformerFactory
	permissions objectMapPermissionChecker
	// ingest supplies projected nodes for ingest-owned kinds; nil when none.
	ingest objectMapIngestSource
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
	// ingestEdges holds the kind's already-resolved relationship edges for an
	// ingest-owned (cut) record, whose source object was dropped at intake. The edge
	// builder uses these instead of re-deriving from obj (which is nil here). nil for
	// uncut records, which derive edges from obj via objectMapEdgeBuilders.
	ingestEdges []objectmapspec.Edge
	// presented marks a record the object map presents as a node even though its
	// source object is absent (an ingest-owned record). Uncut records carry obj and
	// are presented via that; this flag is the equivalent presence signal for cut
	// records in the namespace-map node filter.
	presented bool
}

type objectMapIndex struct {
	meta ClusterMeta
	// scope is the cluster's namespace scope. Informer-backed collectors filter
	// their cached namespaced objects to it. Empty means cluster-wide.
	scope      []string
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
// ingestSource supplies the projected object-map nodes for ingest-owned (cut) kinds;
// it may be nil when no kind is cut over to the ingest path.
func RegisterObjectMapDomain(
	reg *domain.Registry,
	shared informers.SharedInformerFactory,
	permissions objectMapPermissionChecker,
	gatewayShared gatewayinformers.SharedInformerFactory,
	gatewayPresence objectMapGatewayPresence,
	catalogService func() *objectcatalog.Service,
	ingestSource objectMapIngestSource,
	allowedNamespaces []string,
) error {
	if shared == nil {
		return fmt.Errorf("shared informer factory is required for object map domain")
	}
	builder := &objectMapBuilder{
		gatewayShared:     gatewayShared,
		gatewayPresence:   gatewayPresence,
		catalogService:    catalogService,
		shared:            shared,
		permissions:       permissions,
		ingest:            ingestSource,
		allowedNamespaces: append([]string(nil), allowedNamespaces...),
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

func newObjectMapIndex(meta ClusterMeta, allowedNamespaces []string) *objectMapIndex {
	return &objectMapIndex{
		meta:    meta,
		scope:   append([]string(nil), allowedNamespaces...),
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
	// Each kind declares how it is listed (from the factory's already-synced
	// informer cache) and projected, in its own package; this loops the registry
	// and names no kind. The permission gate skips resources the user cannot
	// list+watch, preserving the old live-list Forbidden skip and, for cluster-
	// scoped types, avoiding a blind .Lister() on an unstarted informer.
	clusterID := idx.meta.ClusterID
	for _, collector := range objectMapCollectors {
		if !src.allowed(collector.Identity.Group, collector.Identity.Resource) {
			idx.warnSkippedPermission(collector.Identity.Resource)
			continue
		}
		// Ingest-owned (cut) kinds are no longer cached by the shared factory; their
		// projected object-map nodes come from the ingest source instead of a lister.
		if _, cut := objectMapIngestOwnedGVRs[collector.Identity.GVR()]; cut {
			idx.collectIngestNodes(collector.Identity, src.ingest)
			continue
		}
		items, err := collector.List(src.shared)
		if idx.skipListError(collector.Identity.Resource, err) {
			if idx.hasListError() {
				return
			}
			continue
		}
		for _, obj := range items {
			rec := &objectMapRecord{
				ref:               refFromObject(obj, collector.Identity.Group, collector.Identity.Version, collector.Identity.Kind, collector.Identity.Resource, obj.GetNamespace()),
				obj:               obj,
				creationTimestamp: objectCreationTimestamp(obj),
				owners:            obj.GetOwnerReferences(),
				labels:            cloneStringMap(obj.GetLabels()),
				status:            collector.Status(clusterID, obj),
			}
			if collector.ActionFacts != nil {
				rec.actionFacts = collector.ActionFacts(obj)
			}
			idx.addRecord(rec)
		}
	}
	if src.allowed("autoscaling", "horizontalpodautoscalers") {
		idx.collectHPAs(src.shared)
	} else {
		idx.warnSkippedPermission("horizontalpodautoscalers")
	}
}

// collectIngestNodes adds an object-map record per projected node for an
// ingest-owned kind, read from the ingest source instead of a shared-informer
// lister. The projected node already carries the identity, status, action facts,
// owners, labels, and pre-resolved edges the object-map needs — all computed from
// the source object's own fields at intake — so the record is byte-equivalent to
// the lister path's record except that obj is nil (the source object was dropped).
func (idx *objectMapIndex) collectIngestNodes(identity resourcekind.Identity, source objectMapIngestSource) {
	if source == nil {
		return
	}
	for _, raw := range source.ObjectMapRows(identity.GVR()) {
		node, ok := raw.(objectmapnode.Node)
		if !ok {
			continue
		}
		idx.addRecord(&objectMapRecord{
			ref:               objectMapRefFromIngestNode(identity, node),
			creationTimestamp: node.CreationTimestamp,
			status:            node.Status,
			actionFacts:       node.ActionFacts,
			owners:            node.Owners,
			labels:            cloneStringMap(node.Labels),
			ingestEdges:       node.Edges,
			presented:         true,
		})
	}
}

// objectMapRefFromIngestNode builds the graph reference for an ingest-projected
// node, mirroring refFromObject but reading the identity from the node fields the
// projection captured (no source object is retained).
func objectMapRefFromIngestNode(identity resourcekind.Identity, node objectmapnode.Node) ObjectMapReference {
	ref := ObjectMapReference{
		Group:     identity.Group,
		Version:   identity.Version,
		Kind:      identity.Kind,
		Resource:  identity.Resource,
		Namespace: node.Namespace,
		Name:      node.Name,
		UID:       node.UID,
	}
	return ref
}

func (idx *objectMapIndex) warnSkippedPermission(resource string) {
	idx.warnings = append(idx.warnings, fmt.Sprintf("skipped %s: insufficient permissions", resource))
}

func (idx *objectMapIndex) collectGatewayTyped(
	factory gatewayinformers.SharedInformerFactory,
	presence objectMapGatewayPresence,
	permissions objectMapPermissionChecker,
) {
	if idx == nil || factory == nil {
		return
	}
	clusterID := idx.meta.ClusterID
	for _, collector := range objectMapGatewayCollectors {
		if !gatewayKindPresent(presence, collector.Identity.Kind) {
			continue
		}
		if permissions != nil && !permissions.CanListWatch(collector.Identity.Group, collector.Identity.Resource) {
			idx.warnSkippedPermission(collector.Identity.Resource)
			continue
		}
		generic, err := factory.ForResource(collector.Identity.GVR())
		if err != nil {
			if idx.skipListError(collector.Identity.Resource, err) && idx.hasListError() {
				return
			}
			continue
		}
		listed, err := generic.Lister().List(labels.Everything())
		var items []metav1.Object
		for _, raw := range listed {
			obj, accessorErr := meta.Accessor(raw)
			if accessorErr != nil {
				err = accessorErr
				break
			}
			if collector.Identity.Namespaced && !idx.namespaceAllowed(obj.GetNamespace()) {
				continue
			}
			items = append(items, obj)
		}
		if idx.skipListError(collector.Identity.Resource, err) {
			if idx.hasListError() {
				return
			}
			continue
		}
		for _, obj := range items {
			idx.addRecord(&objectMapRecord{
				ref:               refFromObject(obj, collector.Identity.Group, collector.Identity.Version, collector.Identity.Kind, collector.Identity.Resource, obj.GetNamespace()),
				obj:               obj,
				creationTimestamp: objectCreationTimestamp(obj),
				owners:            obj.GetOwnerReferences(),
				labels:            cloneStringMap(obj.GetLabels()),
				status:            collector.Status(clusterID, obj),
			})
		}
	}
}

func (idx *objectMapIndex) namespaceAllowed(namespace string) bool {
	if len(idx.scope) == 0 {
		return true
	}
	for _, allowed := range idx.scope {
		if namespace == allowed {
			return true
		}
	}
	return false
}

func gatewayKindPresent(presence objectMapGatewayPresence, kind string) bool {
	return presence == nil || presence.Has(kind)
}

func (idx *objectMapIndex) collectHPAs(shared informers.SharedInformerFactory) {
	if shared == nil {
		return
	}
	items, err := shared.Autoscaling().V2().HorizontalPodAutoscalers().Lister().List(labels.Everything())
	if idx.skipListError("horizontalpodautoscalers", err) {
		return
	}
	idx.hpaListed = true
	for _, hpa := range items {
		if !idx.namespaceAllowed(hpa.Namespace) {
			continue
		}
		idx.addRecord(&objectMapRecord{
			ref:               refFromObject(&hpa.ObjectMeta, hpapkg.Identity.Group, hpapkg.Identity.Version, hpapkg.Identity.Kind, hpapkg.Identity.Resource, hpa.Namespace),
			obj:               hpa,
			creationTimestamp: objectCreationTimestamp(&hpa.ObjectMeta),
			status:            hpapkg.ObjectMapStatus(idx.meta.ClusterID, hpa),
			owners:            hpa.OwnerReferences,
			labels:            cloneStringMap(hpa.Labels),
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
	// An ingest-owned (cut) record carries no source object; its presence and edges
	// live in these two fields instead of obj. The catalog seeds an obj-less,
	// edge-less record first, so the ingest record almost always merges INTO it —
	// propagate both, or the cut kind drops out of the namespace filter (which gates
	// on presented) and loses its relationships (recordEdges reads ingestEdges).
	if src.presented {
		dst.presented = true
	}
	if len(dst.ingestEdges) == 0 {
		dst.ingestEdges = src.ingestEdges
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

// objectMapGraphByKind is each kind's object-map graph role, keyed by Kind, from
// the single registry — so the traversal heuristics below name no kind.
var objectMapGraphByKind = func() map[string]kindspec.ObjectMapGraph {
	m := make(map[string]kindspec.ObjectMapGraph, len(kindregistry.All))
	for _, d := range kindregistry.All {
		m[d.Identity.Kind] = d.Graph
	}
	return m
}()

func isObjectMapScalableWorkload(ref ObjectMapReference) bool {
	// The apps/v1 guard preserves the historical scope (a same-named CRD is not a
	// scalable workload); the registry supplies the per-kind classification.
	return ref.Group == "apps" && ref.Version == "v1" && objectMapGraphByKind[ref.Kind].ScalableWorkload
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
	return objectMapGraphByKind[ref.Kind].DirectionalTraversal
}

// isNamespaceMapSupportedRecord reports whether a record is a node the object map
// presents. A collector-added record carries its source object; an ingest-owned
// record carries no object but is flagged presented. Either signal qualifies it.
func isNamespaceMapSupportedRecord(record *objectMapRecord) bool {
	return record != nil && (record.obj != nil || record.presented)
}

func stopsNamespaceMapReverseExpansion(ref ObjectMapReference) bool {
	return objectMapGraphByKind[ref.Kind].StopsReverseExpansion
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
		// Every kind declares its relationship edges in its own package; the
		// registry dispatches by kind and resolveEdgeTargets resolves each target.
		// An ingest-owned record carries no source object, so its edges were resolved
		// at intake and are read from ingestEdges; an uncut record derives them now
		// from its obj via the registry edge builder.
		for _, e := range idx.recordEdges(record) {
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

	result := make([]ObjectMapEdge, 0, len(edges))
	for _, edge := range edges {
		result = append(result, edge)
	}
	return result
}

// recordEdges returns a record's relationship edges: the pre-resolved ingestEdges
// for an ingest-owned (cut) record whose source object was dropped at intake, or the
// registry edge builder's output derived from the record's source object otherwise.
func (idx *objectMapIndex) recordEdges(record *objectMapRecord) []objectmapspec.Edge {
	if record.presented && record.obj == nil {
		return record.ingestEdges
	}
	if build := objectMapEdgeBuilders[record.ref.Kind]; build != nil {
		return build(idx.meta.ClusterID, record.obj)
	}
	return nil
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
		if record.ref.Kind != clusterrolepkg.Identity.Kind {
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
		if record.ref.Kind != podres.Identity.Kind || record.ref.Namespace != namespace {
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
		if record.ref.Kind != podres.Identity.Kind || record.ref.Namespace != namespace {
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
		if record.ref.Kind != endpointslice.Identity.Kind || record.ref.Namespace != namespace {
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
		return []*objectMapRecord{idx.byIdent[objectMapIdentityKey(e.CoreRef.Namespace, e.CoreRef.Group, e.CoreRef.Version, e.CoreRef.Kind, e.CoreRef.Name)]}
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
	return ref.Group == ingress.Identity.Group && ref.Version == ingress.Identity.Version && ref.Kind == ingress.Identity.Kind
}

func isIngressClassRef(ref ObjectMapReference) bool {
	return ref.Group == ingressclass.Identity.Group && ref.Version == ingressclass.Identity.Version && ref.Kind == ingressclass.Identity.Kind
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
// (from the HPA collector) and the typed objects the registry collectors list
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
