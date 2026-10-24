// Package snapshot builds refresh-domain payloads, including the object-map
// relationship graph.
package snapshot

import (
	"context"
	"fmt"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"

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
	podres "github.com/luxury-yacht/app/backend/resources/pods"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	objectMapDomain       = "object-map"
	defaultObjectMapNodes = 250
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
	// Missing marks a display-only node for an object a Helm release's manifest
	// names that the cluster confirms it does not have. It carries the manifest
	// identity and no live state.
	Missing bool `json:"missing,omitempty"`
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
	MaxNodes  int                `json:"maxNodes"`
	Truncated bool               `json:"truncated"`
	Warnings  []string           `json:"warnings,omitempty"`
}

// objectMapPermissionChecker reports whether the current cluster credentials may
// list+watch a resource. *permissions.Grants satisfies it. object-map uses it to
// skip, with a warning, resources the user cannot see.
type objectMapPermissionChecker interface {
	CanListWatch(group, resource string) bool
}

// objectMapRowsProvider supplies each kind's projected object-map nodes and its
// partitions' availability. *ingest.IngestManager satisfies it.
type objectMapRowsProvider interface {
	partitionReadinessReporter
	ObjectMapRows(gvr schema.GroupVersionResource) []interface{}
}

type objectMapBuilder struct {
	catalogService func() *objectcatalog.Service
	permissions    objectMapPermissionChecker
	// ingest supplies every kind's projected object-map nodes; nil in a unit test
	// with no nodes.
	ingest objectMapRowsProvider
	// allowedNamespaces is the cluster's namespace scope.
	allowedNamespaces []string
	// helmManifests reads Helm release manifests for release-scoped maps; nil
	// when the cluster has no Helm content provider.
	helmManifests HelmManifestProvider
}

// objectMapTypedSource carries everything collectTyped needs for one build.
type objectMapTypedSource struct {
	permissions objectMapPermissionChecker
	// ingest supplies projected nodes for ingest-owned kinds; nil when none.
	ingest objectMapRowsProvider
}

func (s objectMapTypedSource) allowed(group, resource string) bool {
	return s.permissions == nil || s.permissions.CanListWatch(group, resource)
}

type objectMapScopeKind int

const (
	objectMapScopeObject objectMapScopeKind = iota
	objectMapScopeNamespace
	// objectMapScopeHelmRelease maps the objects a Helm release's manifest
	// names. Its scope is the release's synthetic object identity.
	objectMapScopeHelmRelease
)

type objectMapOptions struct {
	scopeKind objectMapScopeKind
	identity  refresh.ObjectScopeIdentity
	namespace string
	maxNodes  int
}

type objectMapRecord struct {
	ref               ObjectMapReference
	creationTimestamp string
	status            *ObjectMapStatus
	actionFacts       *ObjectMapActionFacts
	owners            []metav1.OwnerReference
	labels            map[string]string
	// ingestEdges holds the record's relationship edges, resolved at intake.
	ingestEdges []objectmapspec.Edge
	// presented marks a record the object map presents as a node: one collected
	// from a reflector, as opposed to one the catalog supplied on demand.
	presented bool
}

type objectMapIndex struct {
	meta ClusterMeta
	// scope is the cluster's namespace scope. Empty means cluster-wide.
	scope    []string
	records  map[string]*objectMapRecord
	byUID    map[string]*objectMapRecord
	byIdent  map[string]*objectMapRecord
	warnings []string
	// collectedResources records every collector kind this build read without
	// skipping it, so a Helm release
	// map only calls an object missing when its kind was actually read.
	collectedResources map[schema.GroupResource]struct{}
	// selectorTargets is built by buildAllEdges once collection is complete.
	selectorTargets *objectMapSelectorTargets
	// catalog supplies objects the map does not collect itself (for example a
	// custom resource that owns a ReplicaSet), looked up on demand. nil when
	// no catalog is available.
	catalog *objectcatalog.Service
}

type objectMapGraph struct {
	nodes     map[string]ObjectMapNode
	edges     map[string]ObjectMapEdge
	adjacency *objectMapAdjacency
	truncated bool
}

type objectMapTraversalDirection int

const (
	objectMapTraversalForward objectMapTraversalDirection = iota
	objectMapTraversalBackward
)

// RegisterObjectMapDomain wires the backend relationship graph domain into the registry.
// ingestSource supplies the projected object-map nodes for ingest-owned (cut) kinds;
// it may be nil when no kind is cut over to the ingest path.
type ObjectMapDomainConfig struct {
	Permissions       objectMapPermissionChecker
	CatalogService    func() *objectcatalog.Service
	IngestSource      objectMapRowsProvider
	AllowedNamespaces []string
	// HelmManifests reads release manifests for Helm release maps; nil when
	// the cluster has no Helm content provider.
	HelmManifests HelmManifestProvider
}

func RegisterObjectMapDomain(reg *domain.Registry, config ObjectMapDomainConfig) error {
	builder := &objectMapBuilder{
		catalogService:    config.CatalogService,
		permissions:       config.Permissions,
		ingest:            config.IngestSource,
		allowedNamespaces: append([]string(nil), config.AllowedNamespaces...),
		helmManifests:     config.HelmManifests,
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
	if opts.scopeKind == objectMapScopeObject && opts.identity.GVK.Group == "" && opts.identity.GVK.Version == "" {
		return nil, fmt.Errorf("object-map scope for %s/%s is missing group/version", opts.identity.GVK.Kind, opts.identity.Name)
	}
	if opts.scopeKind == objectMapScopeHelmRelease {
		return b.buildHelmReleaseSnapshot(ctx, scope, opts)
	}

	assembler := b.newObjectMapAssembler(ctx)
	if opts.scopeKind == objectMapScopeNamespace {
		return assembler.buildNamespaceSnapshot(scope, opts)
	}
	return assembler.buildObjectSnapshot(scope, opts)
}

func (b *objectMapBuilder) catalog() *objectcatalog.Service {
	if b == nil || b.catalogService == nil {
		return nil
	}
	return b.catalogService()
}

func parseObjectMapScope(scope string) (objectMapOptions, error) {
	_, tail := refresh.SplitClusterScope(scope)
	selector, query, err := domain.ParseDomainScopeTail(objectMapDomain, tail)
	if err != nil {
		return objectMapOptions{}, err
	}
	opts := objectMapOptions{scopeKind: objectMapScopeObject, maxNodes: defaultObjectMapNodes}
	switch selector.Kind {
	case refresh.ScopeSelectorNamespace:
		opts.scopeKind = objectMapScopeNamespace
		opts.namespace = selector.Namespace
	default:
		opts.identity = selector.Object
		if resourcemodel.IsHelmReleaseGVK(selector.Object.GVK) {
			opts.scopeKind = objectMapScopeHelmRelease
		}
	}
	if query == "" {
		return opts, nil
	}
	values, err := url.ParseQuery(query)
	if err != nil {
		return objectMapOptions{}, err
	}
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

func newObjectMapIndex(meta ClusterMeta, allowedNamespaces []string) *objectMapIndex {
	return &objectMapIndex{
		meta:    meta,
		scope:   append([]string(nil), allowedNamespaces...),
		records: make(map[string]*objectMapRecord),
		byUID:   make(map[string]*objectMapRecord),
		byIdent: make(map[string]*objectMapRecord),

		collectedResources: make(map[schema.GroupResource]struct{}),
	}
}

func (idx *objectMapIndex) collectTyped(src objectMapTypedSource) {
	if idx == nil {
		return
	}
	// Each kind's nodes are projected at intake by its owned reflector; this
	// loops the registry and names no kind. The permission gate skips resources
	// the user cannot list+watch.
	for _, collector := range objectMapCollectors {
		idx.collectTypedCollector(src, collector)
	}
}

// collectTypedCollector adds one kind's projected nodes, or a warning when the
// user may not list+watch it.
func (idx *objectMapIndex) collectTypedCollector(src objectMapTypedSource, collector objectmapnode.Collector) {
	identity := collector.Identity
	if !src.allowed(identity.Group, identity.Resource) {
		idx.warnSkippedPermission(identity.Resource)
		return
	}
	if src.ingest != nil {
		idx.collectedResources[identity.GVR().GroupResource()] = struct{}{}
	}
	idx.collectIngestNodes(identity, src.ingest)
}

// collectIngestNodes adds an object-map record per projected node for an
// ingest-owned kind, read from the ingest source. The projected node already carries the identity, status, action facts,
// owners, labels, and pre-resolved edges the object-map needs — all computed from
// the source object's own fields at intake — so the record is byte-equivalent to
// the lister path's record except that obj is nil (the source object was dropped).
func (idx *objectMapIndex) collectIngestNodes(identity resourcekind.Identity, source objectMapRowsProvider) {
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
			labels:            copyStringMap(node.Labels),
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

// warnOnce adds a warning unless the build already reported it.
func (idx *objectMapIndex) warnOnce(warning string) {
	if !slices.Contains(idx.warnings, warning) {
		idx.warnings = append(idx.warnings, warning)
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

// addRecord indexes a collected record. Each collected kind lists an object
// once, so a repeated node id keeps the first record.
func (idx *objectMapIndex) addRecord(record *objectMapRecord) {
	if !idx.stampRecord(record) {
		return
	}
	id := objectMapNodeID(record.ref)
	if idx.records[id] != nil {
		return
	}
	idx.records[id] = record
	idx.byIdent[objectMapRecordIdentityKey(record.ref)] = record
	if record.ref.UID != "" {
		idx.byUID[record.ref.UID] = record
	}
}

// stampRecord fills the build's cluster identity and reports whether the
// record has the identity a graph node needs.
func (idx *objectMapIndex) stampRecord(record *objectMapRecord) bool {
	if idx == nil || record == nil || record.ref.Kind == "" || record.ref.Name == "" || record.ref.Version == "" {
		return false
	}
	if record.ref.ClusterID == "" {
		record.ref.ClusterID = idx.meta.ClusterID
	}
	if record.ref.ClusterName == "" {
		record.ref.ClusterName = idx.meta.ClusterName
	}
	return true
}

// recordByUID resolves an object UID: a collected record first, else one
// materialized from the object catalog.
func (idx *objectMapIndex) recordByUID(uid string) *objectMapRecord {
	if record := idx.byUID[uid]; record != nil {
		return record
	}
	if idx.catalog == nil {
		return nil
	}
	summary, ok := idx.catalog.FindByUID(uid)
	if !ok {
		return nil
	}
	return idx.addCatalogRecord(summary)
}

// recordByIdentity resolves a complete identity: a collected record first,
// else one materialized from the object catalog.
func (idx *objectMapIndex) recordByIdentity(namespace, group, version, kind, name string) *objectMapRecord {
	if record := idx.byIdent[objectMapIdentityKey(namespace, group, version, kind, name)]; record != nil {
		return record
	}
	if idx.catalog == nil {
		return nil
	}
	summary, ok := idx.catalog.FindExactMatch(namespace, group, version, kind, name)
	if !ok {
		return nil
	}
	return idx.addCatalogRecord(summary)
}

// addCatalogRecord materializes a catalog row that no collected record covers.
// A UID names one object whatever its served version, so a row whose UID
// already has a record resolves to that record. A materialized row never takes
// over an identity a collected record holds.
func (idx *objectMapIndex) addCatalogRecord(summary objectcatalog.Summary) *objectMapRecord {
	record := &objectMapRecord{ref: refFromCatalog(idx.meta, summary), creationTimestamp: summary.CreationTimestamp}
	if !idx.stampRecord(record) {
		return nil
	}
	if existing := idx.byUID[record.ref.UID]; record.ref.UID != "" && existing != nil {
		return existing
	}
	id := objectMapNodeID(record.ref)
	if existing := idx.records[id]; existing != nil {
		return existing
	}
	idx.records[id] = record
	if key := objectMapRecordIdentityKey(record.ref); idx.byIdent[key] == nil {
		idx.byIdent[key] = record
	}
	if record.ref.UID != "" {
		idx.byUID[record.ref.UID] = record
	}
	return record
}

func objectMapRecordIdentityKey(ref ObjectMapReference) string {
	return objectMapIdentityKey(ref.Namespace, ref.Group, ref.Version, ref.Kind, ref.Name)
}

// enrichActionFacts marks each scalable workload HPA-managed or not. "Not
// managed" is reported only where the HPA data covering the workload's
// namespace is complete; elsewhere the fact stays unknown.
func (idx *objectMapIndex) enrichActionFacts(hpaSource partitionReadinessReporter) {
	if idx == nil {
		return
	}
	if _, collected := idx.collectedResources[HPAGVR.GroupResource()]; !collected {
		return
	}
	known := func(namespace string) bool { return ingestRowsComplete(hpaSource, HPAGVR, namespace) }
	idx.applyHPAManagedActionFacts(idx.hpaManagedActionTargets(), known)
}

// hpaManagedActionTargets resolves every HPA's scale target through the HPA's
// projected "scales" edge.
func (idx *objectMapIndex) hpaManagedActionTargets() map[string]struct{} {
	managedTargets := make(map[string]struct{})
	for _, record := range idx.records {
		if record == nil || record.ref.Group != HPAGVR.Group || record.ref.Kind != hpapkg.Identity.Kind {
			continue
		}
		for _, edge := range idx.recordEdges(record) {
			if edge.Type != objectmapspec.EdgeScales {
				continue
			}
			if target := idx.recordForResourceLink(edge.Link); target != nil {
				managedTargets[objectMapActionTargetKey(target.ref)] = struct{}{}
			}
		}
	}
	return managedTargets
}

func (idx *objectMapIndex) applyHPAManagedActionFacts(managedTargets map[string]struct{}, known func(namespace string) bool) {
	for _, record := range idx.records {
		if record == nil || !isObjectMapScalableWorkload(record.ref) || !known(record.ref.Namespace) {
			continue
		}
		_, managed := managedTargets[objectMapActionTargetKey(record.ref)]
		// Intake facts may be shared by concurrent graph builds. The HPA join
		// belongs to this snapshot, including when no catalog record was merged.
		facts := cloneObjectMapActionFacts(record.actionFacts)
		if facts == nil {
			facts = &ObjectMapActionFacts{}
		}
		facts.HPAManaged = &managed
		record.actionFacts = facts
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
	record := idx.recordByIdentity(namespace, gvk.Group, gvk.Version, gvk.Kind, name)
	return record, record != nil
}

// buildGraph builds an object map by one rule: an object is on the map if and
// only if links that all point the same way connect it to the seed, either away
// from the seed (what it uses or contains) or toward it (what uses or contains
// it). Nearer objects are added first and the node cap is the only bound. Every
// link between two objects on the map is drawn.
func (idx *objectMapIndex) buildGraph(seed *objectMapRecord, maxNodes int) objectMapGraph {
	seedID := objectMapNodeID(seed.ref)
	graph := objectMapGraph{
		nodes:     map[string]ObjectMapNode{seedID: objectMapNodeFromRecord(seedID, 0, seed)},
		adjacency: newObjectMapAdjacency(idx.buildAllEdges(), nil),
	}
	idx.walkObjectMapLineage(&graph, seedID, maxNodes)
	graph.edges = graph.adjacency.edgesBetween(graph.nodes)
	return graph
}

// objectMapLineageStep is one object reached from the seed in one direction.
type objectMapLineageStep struct {
	id        string
	direction objectMapTraversalDirection
	distance  int
}

// walkObjectMapLineage adds every object connected to the seed by same-direction
// links, breadth-first in both directions at once so nearer objects win when the
// cap is reached. An object reached one way still continues the other way's
// chain when that chain reaches it too.
func (idx *objectMapIndex) walkObjectMapLineage(graph *objectMapGraph, seedID string, maxNodes int) {
	visited := map[objectMapTraversalDirection]map[string]struct{}{
		objectMapTraversalForward:  {seedID: {}},
		objectMapTraversalBackward: {seedID: {}},
	}
	queue := []objectMapLineageStep{
		{id: seedID, direction: objectMapTraversalForward},
		{id: seedID, direction: objectMapTraversalBackward},
	}
	for head := 0; head < len(queue); head++ {
		step := queue[head]
		for _, entry := range graph.adjacency.neighbors(step.id) {
			if next, ok := idx.lineageNeighbor(graph, step, entry, visited[step.direction], maxNodes); ok {
				queue = append(queue, next)
			}
		}
	}
}

// lineageNeighbor follows one edge entry when it points the step's way and leads
// to an object this direction has not visited.
func (idx *objectMapIndex) lineageNeighbor(
	graph *objectMapGraph,
	step objectMapLineageStep,
	entry objectMapTraversalEdge,
	visited map[string]struct{},
	maxNodes int,
) (objectMapLineageStep, bool) {
	if entry.reverse != (step.direction == objectMapTraversalBackward) {
		return objectMapLineageStep{}, false
	}
	neighborID := objectMapTraversalNeighbor(graph.adjacency.edge(entry), entry.reverse)
	if _, seen := visited[neighborID]; seen {
		return objectMapLineageStep{}, false
	}
	if !graph.includeLineageNode(idx.records[neighborID], neighborID, step.distance+1, maxNodes) {
		return objectMapLineageStep{}, false
	}
	visited[neighborID] = struct{}{}
	return objectMapLineageStep{id: neighborID, direction: step.direction, distance: step.distance + 1}, true
}

// includeLineageNode puts an object on the map, unless the cap stops a new one.
// An object already on the map, reached the other way, is included as it is.
func (graph *objectMapGraph) includeLineageNode(record *objectMapRecord, id string, distance, maxNodes int) bool {
	if _, exists := graph.nodes[id]; exists {
		return true
	}
	if record == nil {
		return false
	}
	if len(graph.nodes) >= maxNodes {
		graph.truncated = true
		return false
	}
	graph.nodes[id] = objectMapNodeFromRecord(id, distance, record)
	return true
}

func objectMapEdgesBetweenNodes(edges map[string]ObjectMapEdge, nodes map[string]ObjectMapNode) map[string]ObjectMapEdge {
	result := make(map[string]ObjectMapEdge)
	for _, edge := range edges {
		if _, ok := nodes[edge.Source]; !ok {
			continue
		}
		if _, ok := nodes[edge.Target]; !ok {
			continue
		}
		result[edge.ID] = edge
	}
	return result
}

func (idx *objectMapIndex) buildNamespaceGraph(namespace string, maxNodes int) objectMapGraph {
	adjacency := newObjectMapAdjacency(idx.buildAllEdges(), nil)
	// Collect every eligible object before applying the cap, so cluster-scoped
	// objects compete for slots with the namespace's own objects.
	candidates := objectMapGraph{nodes: make(map[string]ObjectMapNode), adjacency: adjacency}
	var starts []string
	for _, record := range idx.namespaceObjectMapRecords(namespace) {
		if id := candidates.addNamespaceRecord(record, 0); id != "" {
			starts = append(starts, id)
		}
	}
	idx.walkNamespaceLineage(&candidates, starts)
	return capObjectMapCandidates(candidates.nodes, adjacency.edgesBetween(candidates.nodes), maxNodes)
}

// capObjectMapCandidates keeps at most maxNodes candidates. Objects with a
// relationship to another candidate rank before isolated ones, so a cap keeps
// workload chains instead of an alphabetical prefix of kinds.
func capObjectMapCandidates(
	candidates map[string]ObjectMapNode,
	candidateEdges map[string]ObjectMapEdge,
	maxNodes int,
) objectMapGraph {
	connected := make(map[string]struct{}, len(candidates))
	for _, edge := range candidateEdges {
		connected[edge.Source] = struct{}{}
		connected[edge.Target] = struct{}{}
	}
	ranked := make([]ObjectMapNode, 0, len(candidates))
	for _, node := range candidates {
		ranked = append(ranked, node)
	}
	sort.Slice(ranked, func(i, j int) bool {
		return lessObjectMapCandidate(ranked[i], ranked[j], connected)
	})
	kept := ranked[:min(len(ranked), maxNodes)]
	graph := objectMapGraph{
		nodes:     make(map[string]ObjectMapNode, len(kept)),
		truncated: len(ranked) > len(kept),
	}
	for _, node := range kept {
		graph.nodes[node.ID] = node
	}
	graph.edges = objectMapEdgesBetweenNodes(candidateEdges, graph.nodes)
	return graph
}

func lessObjectMapCandidate(a, b ObjectMapNode, connected map[string]struct{}) bool {
	_, aConnected := connected[a.ID]
	_, bConnected := connected[b.ID]
	if aConnected != bConnected {
		return aConnected
	}
	if order := compareObjectMapRefs(a.Ref, b.Ref); order != 0 {
		return order < 0
	}
	return a.ID < b.ID
}

func (idx *objectMapIndex) namespaceObjectMapRecords(namespace string) []*objectMapRecord {
	records := make([]*objectMapRecord, 0)
	for _, record := range idx.records {
		if record.ref.Namespace == namespace {
			records = append(records, record)
		}
	}
	return records
}

// addNamespaceRecord adds a presented record and returns its node id, or ""
// when the record is not presented or is already in the graph.
func (graph *objectMapGraph) addNamespaceRecord(record *objectMapRecord, depth int) string {
	if !isNamespaceMapSupportedRecord(record) {
		return ""
	}
	id := objectMapNodeID(record.ref)
	if id == "" {
		return ""
	}
	if _, exists := graph.nodes[id]; exists {
		return ""
	}
	graph.nodes[id] = objectMapNodeFromRecord(id, depth, record)
	return id
}

// walkNamespaceLineage adds the cluster-scoped objects the one rule reaches from
// the namespace's objects: chains of same-direction links through cluster-scoped
// objects. Objects of other namespaces never join a namespace map.
func (idx *objectMapIndex) walkNamespaceLineage(graph *objectMapGraph, starts []string) {
	visited := map[objectMapTraversalDirection]map[string]struct{}{
		objectMapTraversalForward:  {},
		objectMapTraversalBackward: {},
	}
	queue := make([]objectMapLineageStep, 0, len(starts)*2)
	for _, id := range starts {
		for direction, seen := range visited {
			seen[id] = struct{}{}
			queue = append(queue, objectMapLineageStep{id: id, direction: direction})
		}
	}
	for head := 0; head < len(queue); head++ {
		step := queue[head]
		for _, entry := range graph.adjacency.byNode[step.id] {
			if next, ok := idx.namespaceLineageNeighbor(graph, step, entry, visited[step.direction]); ok {
				queue = append(queue, next)
			}
		}
	}
}

// namespaceLineageNeighbor follows one edge entry the step's way to a
// cluster-scoped object this direction has not visited.
func (idx *objectMapIndex) namespaceLineageNeighbor(
	graph *objectMapGraph,
	step objectMapLineageStep,
	entry objectMapTraversalEdge,
	visited map[string]struct{},
) (objectMapLineageStep, bool) {
	if entry.reverse != (step.direction == objectMapTraversalBackward) {
		return objectMapLineageStep{}, false
	}
	neighborID := objectMapTraversalNeighbor(graph.adjacency.edge(entry), entry.reverse)
	if _, seen := visited[neighborID]; seen {
		return objectMapLineageStep{}, false
	}
	visited[neighborID] = struct{}{}
	record := idx.records[neighborID]
	if record == nil || record.ref.Namespace != "" {
		return objectMapLineageStep{}, false
	}
	if _, included := graph.nodes[neighborID]; !included && graph.addNamespaceRecord(record, step.distance+1) == "" {
		return objectMapLineageStep{}, false
	}
	return objectMapLineageStep{id: neighborID, direction: step.direction, distance: step.distance + 1}, true
}

func objectMapTraversalNeighbor(edge ObjectMapEdge, reverse bool) string {
	if reverse {
		return edge.Source
	}
	return edge.Target
}

// isNamespaceMapSupportedRecord reports whether a record is a node the object map
// presents. A collector-added record carries its source object; an ingest-owned
// record carries no object but is flagged presented. Either signal qualifies it.
func isNamespaceMapSupportedRecord(record *objectMapRecord) bool {
	return record != nil && record.presented
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
	idx.indexSelectorTargets()
	edges := objectMapEdgeSet{}
	for _, record := range idx.records {
		idx.addObjectMapOwnerEdges(edges, record)
	}
	for _, record := range idx.records {
		idx.addObjectMapRelationshipEdges(edges, record)
	}
	result := make([]ObjectMapEdge, 0, len(edges))
	for _, edge := range edges {
		result = append(result, edge)
	}
	return result
}

type objectMapEdgeSet map[string]ObjectMapEdge

func (edges objectMapEdgeSet) add(source, target *objectMapRecord, typ, label, tracedBy string) {
	if source == nil || target == nil {
		return
	}
	sourceID := objectMapNodeID(source.ref)
	targetID := objectMapNodeID(target.ref)
	if sourceID == "" || targetID == "" || sourceID == targetID {
		return
	}
	id := strings.Join([]string{sourceID, typ, targetID, tracedBy}, "|")
	edges[id] = ObjectMapEdge{ID: id, Source: sourceID, Target: targetID, Type: typ, Label: label, TracedBy: tracedBy}
}

func (idx *objectMapIndex) addObjectMapOwnerEdges(edges objectMapEdgeSet, record *objectMapRecord) {
	for _, owner := range record.owners {
		edges.add(idx.resolveOwner(record, owner), record, objectMapEdgeOwner, objectMapRelationships[objectMapEdgeOwner].label, owner.Name)
	}
}

func (idx *objectMapIndex) addObjectMapRelationshipEdges(edges objectMapEdgeSet, record *objectMapRecord) {
	// Every kind declares its relationship edges in its own package; ingest-owned
	// records read their pre-resolved edges while retained objects derive them here.
	for _, edge := range idx.recordEdges(record) {
		label, tracedBy := objectMapEdgePresentation(edge)
		for _, target := range idx.resolveEdgeTargets(record, edge) {
			edges.add(record, target, edge.Type, label, tracedBy)
		}
	}
}

func objectMapEdgePresentation(edge objectmapspec.Edge) (string, string) {
	relationship := objectMapRelationships[edge.Type]
	label := edge.Label
	if label == "" {
		label = relationship.label
	}
	tracedBy := edge.TracedBy
	if tracedBy == "" {
		tracedBy = relationship.defaultTracedBy
	}
	return label, tracedBy
}

// recordEdges returns a record's relationship edges, resolved at intake.
func (idx *objectMapIndex) recordEdges(record *objectMapRecord) []objectmapspec.Edge {
	return record.ingestEdges
}

func (idx *objectMapIndex) resolveOwner(child *objectMapRecord, owner metav1.OwnerReference) *objectMapRecord {
	if owner.UID != "" {
		if record := idx.recordByUID(string(owner.UID)); record != nil {
			return record
		}
	}
	gv, err := schema.ParseGroupVersion(owner.APIVersion)
	if err != nil {
		return nil
	}
	return idx.recordByIdentity(child.ref.Namespace, gv.Group, gv.Version, owner.Kind, owner.Name)
}

func (idx *objectMapIndex) resolveCoreObjectRef(defaultNamespace string, ref *corev1.ObjectReference) *objectMapRecord {
	if ref == nil {
		return nil
	}
	if ref.UID != "" {
		if record := idx.recordByUID(string(ref.UID)); record != nil {
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
	return idx.recordByIdentity(namespace, group, version, ref.Kind, ref.Name)
}

func (idx *objectMapIndex) recordForResourceLink(link resourcemodel.ResourceLink) *objectMapRecord {
	if link.Ref != nil {
		return idx.recordByIdentity(link.Ref.Namespace, link.Ref.Group, link.Ref.Version, link.Ref.Kind, link.Ref.Name)
	}
	if link.Display != nil {
		return idx.recordByIdentity(link.Display.Namespace, link.Display.Group, link.Display.Version, link.Display.Kind, link.Display.Name)
	}
	return nil
}

// objectMapSelectorTargets indexes the records that selector-style edges
// resolve against, so each selector scans only its candidates instead of every
// record in the cluster.
type objectMapSelectorTargets struct {
	podsByNamespace map[string][]*objectMapRecord
	// slicesByService is keyed by namespace and the slice's service-name label.
	slicesByService map[string][]*objectMapRecord
	clusterRoles    []*objectMapRecord
}

// indexSelectorTargets builds the selector index from the final record set.
// Call it after collection, before edges resolve.
func (idx *objectMapIndex) indexSelectorTargets() {
	targets := &objectMapSelectorTargets{
		podsByNamespace: make(map[string][]*objectMapRecord),
		slicesByService: make(map[string][]*objectMapRecord),
	}
	for _, record := range idx.records {
		switch record.ref.Kind {
		case podres.Identity.Kind:
			targets.podsByNamespace[record.ref.Namespace] = append(targets.podsByNamespace[record.ref.Namespace], record)
		case endpointslice.Identity.Kind:
			key := objectMapServiceSliceKey(record.ref.Namespace, record.labels[discoveryv1.LabelServiceName])
			targets.slicesByService[key] = append(targets.slicesByService[key], record)
		case clusterrolepkg.Identity.Kind:
			targets.clusterRoles = append(targets.clusterRoles, record)
		}
	}
	idx.selectorTargets = targets
}

func objectMapServiceSliceKey(namespace, serviceName string) string {
	return namespace + "\x00" + serviceName
}

func (idx *objectMapIndex) clusterRolesMatchingSelector(selector metav1.LabelSelector) []*objectMapRecord {
	parsed, err := metav1.LabelSelectorAsSelector(&selector)
	if err != nil || parsed.Empty() {
		return nil
	}
	result := []*objectMapRecord{}
	for _, record := range idx.selectorTargets.clusterRoles {
		if parsed.Matches(labels.Set(record.labels)) {
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
	for _, record := range idx.selectorTargets.podsByNamespace[namespace] {
		if parsed.Matches(labels.Set(record.labels)) {
			result = append(result, record)
		}
	}
	return result
}

func (idx *objectMapIndex) endpointSlicesForService(namespace, serviceName string) []*objectMapRecord {
	return idx.selectorTargets.slicesByService[objectMapServiceSliceKey(namespace, serviceName)]
}

// resolveEdgeTargets resolves an Edge's target descriptor to the graph records it
// points at. Selectors and slice endpoints can resolve to several; the rest to one
// (possibly nil, which add() skips).
func (idx *objectMapIndex) resolveEdgeTargets(source *objectMapRecord, e objectmapspec.Edge) []*objectMapRecord {
	switch {
	case e.CoreRef != nil:
		return []*objectMapRecord{idx.recordByIdentity(e.CoreRef.Namespace, e.CoreRef.Group, e.CoreRef.Version, e.CoreRef.Kind, e.CoreRef.Name)}
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

func refFromCatalog(meta ClusterMeta, item objectcatalog.Summary) ObjectMapReference {
	return ObjectMapReference{
		ClusterID:   item.Ref.ClusterID,
		ClusterName: meta.ClusterName,
		Group:       item.Ref.Group,
		Version:     item.Ref.Version,
		Kind:        item.Ref.Kind,
		Resource:    item.Ref.Resource,
		Namespace:   item.Ref.Namespace,
		Name:        item.Ref.Name,
		UID:         item.Ref.UID,
	}
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
