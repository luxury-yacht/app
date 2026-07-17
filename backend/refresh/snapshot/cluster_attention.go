package snapshot

import (
	"container/heap"
	"context"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	eventres "github.com/luxury-yacht/app/backend/resources/events"
)

const (
	clusterAttentionDomainName = "cluster-attention"
	attentionWarningGrace      = 5 * time.Minute
	attentionEventLookback     = 24 * time.Hour
	attentionNotifyDebounce    = 500 * time.Millisecond
)

type attentionSource string

const (
	attentionSourcePod      attentionSource = "pod"
	attentionSourceWorkload attentionSource = "workload"
	attentionSourceNode     attentionSource = "node"
	attentionSourceEvent    attentionSource = "event"
)

// AttentionFinding is one Kubernetes object that currently warrants operator
// attention. Reasons combines every active finding for that source object.
type AttentionFinding struct {
	ClusterMeta
	Ref          resourcemodel.ResourceRef `json:"ref"`
	Kind         string                    `json:"kind"`
	Name         string                    `json:"name"`
	Namespace    string                    `json:"namespace,omitempty"`
	Severity     AttentionSeverity         `json:"severity"`
	Status       string                    `json:"status"`
	Reasons      []string                  `json:"reasons"`
	Age          string                    `json:"age"`
	AgeTimestamp int64                     `json:"ageTimestamp,omitempty"`
}

type ClusterAttentionSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []AttentionFinding `json:"rows"`
}

type ClusterAttentionBuilder struct {
	index   *clusterAttentionIndex
	sources []typedTableResourceSource
}

func (b *ClusterAttentionBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b == nil || b.index == nil {
		return nil, fmt.Errorf("%s index is nil", clusterAttentionDomainName)
	}
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterAttentionDomainName, "")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(baseScope) != "" {
		return nil, fmt.Errorf("%s scope must be cluster-wide", clusterAttentionDomainName)
	}
	rows := b.index.Snapshot()
	availableKinds := make(map[string]bool)
	for _, row := range rows {
		availableKinds[row.Kind] = true
	}
	windowRows := func() []AttentionFinding {
		window := append([]AttentionFinding(nil), rows...)
		sort.SliceStable(window, func(left, right int) bool {
			if window[left].Name == window[right].Name {
				return attentionRefKey(window[left].Ref) < attentionRefKey(window[right].Ref)
			}
			return strings.ToLower(window[left].Name) < strings.ToLower(window[right].Name)
		})
		return window
	}
	resolved := resolveMaintainedDirect(
		b.index.maintained.store,
		query,
		availableKinds,
		"",
		attentionTableQueryAdapter(),
		attentionQuerypageSchema(),
		clusterAttentionQueryCapabilities(),
		config.SnapshotClusterAttentionEntryLimit,
		"findings",
		func(row AttentionFinding) string { return row.Kind },
		windowRows,
		typedTableQueryResourceIssues(ctx, clusterAttentionDomainName, query, b.sources),
	)
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:  clusterAttentionDomainName,
		Scope:   snapshotScope,
		Version: b.index.Revision(),
		Payload: ClusterAttentionSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

func clusterAttentionQueryCapabilities() ResourceQueryCapabilities {
	adapter := attentionTableQueryAdapter()
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "severity", "status", "reason", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "severity", "status", "reason"},
		[]string{"Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Node", "Event"},
		typedTableFacetDescriptors(adapter.Facets)...,
	)
}

type attentionSourceRecord struct {
	Ref                resourcemodel.ResourceRef
	Source             attentionSource
	Status             string
	StatusPresentation string
	StatusReason       string
	Ready              string
	Restarts           int32
	Message            string
	AgeTimestamp       int64
}

type attentionEvaluation struct {
	Finding        *AttentionFinding
	NextEvaluation time.Time
}

type attentionSourceState struct {
	record     attentionSourceRecord
	owner      string
	generation uint64
	deadline   time.Time
}

type attentionDeadline struct {
	key        string
	generation uint64
	at         time.Time
}

type attentionDeadlineHeap []attentionDeadline

func (h attentionDeadlineHeap) Len() int           { return len(h) }
func (h attentionDeadlineHeap) Less(i, j int) bool { return h[i].at.Before(h[j].at) }
func (h attentionDeadlineHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *attentionDeadlineHeap) Push(value interface{}) {
	*h = append(*h, value.(attentionDeadline))
}
func (h *attentionDeadlineHeap) Pop() interface{} {
	old := *h
	last := old[len(old)-1]
	*h = old[:len(old)-1]
	return last
}

// clusterAttentionIndex owns source records, time-based reevaluation, and the
// maintained query rows for exactly one cluster.
type clusterAttentionIndex struct {
	meta       ClusterMeta
	maintained *typedMaintainedStore[AttentionFinding]
	now        func() time.Time

	mu                sync.Mutex
	sources           map[string]attentionSourceState
	owners            map[string]map[string]struct{}
	ownerKinds        map[string]map[string]struct{}
	unavailableOwners map[string]struct{}
	findings          map[string]AttentionFinding
	deadlines         attentionDeadlineHeap
	timer             *time.Timer
	notify            *time.Timer
	broadcast         func(version string)
	dirty             bool
	revision          uint64
	stopped           bool
	eventRows         func() []attentionSourceRecord
}

// ClusterAttentionIndex is the subsystem-owned lifecycle handle for the
// cluster Attention domain.
type ClusterAttentionIndex = clusterAttentionIndex

func newClusterAttentionIndex(meta ClusterMeta, now func() time.Time) *clusterAttentionIndex {
	if now == nil {
		now = time.Now
	}
	index := &clusterAttentionIndex{
		meta:              meta,
		now:               now,
		sources:           make(map[string]attentionSourceState),
		owners:            make(map[string]map[string]struct{}),
		ownerKinds:        make(map[string]map[string]struct{}),
		unavailableOwners: make(map[string]struct{}),
		findings:          make(map[string]AttentionFinding),
		deadlines:         attentionDeadlineHeap{},
	}
	index.maintained = newTypedMaintainedStore(meta, attentionQuerypageSchema(), attentionTableQueryAdapter())
	heap.Init(&index.deadlines)
	return index
}

func (i *clusterAttentionIndex) UpsertSource(owner string, record attentionSourceRecord) {
	if i == nil || strings.TrimSpace(owner) == "" || !completeAttentionRef(record.Ref) {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return
	}
	i.upsertSourceLocked(owner, record, i.now())
	i.armTimerLocked()
}

func (i *clusterAttentionIndex) ReplaceSource(owner string, records []attentionSourceRecord) {
	if i == nil || strings.TrimSpace(owner) == "" {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return
	}
	want := make(map[string]struct{}, len(records))
	now := i.now()
	for _, record := range records {
		if !completeAttentionRef(record.Ref) {
			continue
		}
		key := attentionRefKey(record.Ref)
		want[key] = struct{}{}
		i.upsertSourceLocked(owner, record, now)
	}
	for key := range i.owners[owner] {
		if _, keep := want[key]; keep {
			continue
		}
		i.deleteSourceLocked(owner, key)
	}
	for key, finding := range i.findings {
		if _, ownedKind := i.ownerKinds[owner][finding.Kind]; !ownedKind {
			continue
		}
		if _, keep := want[key]; keep {
			continue
		}
		i.applyFindingLocked(key, nil)
	}
	i.owners[owner] = want
	i.armTimerLocked()
}

func (i *clusterAttentionIndex) registerOwnerKind(owner, kind string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.ownerKinds[owner] == nil {
		i.ownerKinds[owner] = make(map[string]struct{})
	}
	i.ownerKinds[owner][kind] = struct{}{}
}

func (i *clusterAttentionIndex) markOwnerUnavailable(owner string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.unavailableOwners[owner] = struct{}{}
}

func (i *clusterAttentionIndex) SpillTo(path string) error {
	return i.maintained.SpillTo(path)
}

func (i *clusterAttentionIndex) RestoreFrom(path string) error {
	if err := i.maintained.RestoreFrom(path); err != nil {
		return err
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	for _, row := range i.maintained.store.Snapshot() {
		i.findings[attentionRefKey(row.Ref)] = row
	}
	i.revision++
	return nil
}

func (i *clusterAttentionIndex) SwapToMmap(path string) (func() error, error) {
	return i.maintained.SwapToMmap(path)
}

func (i *clusterAttentionIndex) Reconcile() {
	if i == nil {
		return
	}
	i.mu.Lock()
	unavailableOwners := make([]string, 0, len(i.unavailableOwners))
	for owner := range i.unavailableOwners {
		unavailableOwners = append(unavailableOwners, owner)
	}
	eventRows := i.eventRows
	i.mu.Unlock()
	for _, owner := range unavailableOwners {
		i.ReplaceSource(owner, nil)
	}
	if eventRows != nil {
		i.ReplaceSource("events", eventRows())
	}
}

func (i *clusterAttentionIndex) DeleteSource(owner string, ref resourcemodel.ResourceRef) {
	if i == nil || strings.TrimSpace(owner) == "" {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return
	}
	i.deleteSourceLocked(owner, attentionRefKey(ref))
	i.armTimerLocked()
}

func (i *clusterAttentionIndex) upsertSourceLocked(owner string, record attentionSourceRecord, now time.Time) {
	key := attentionRefKey(record.Ref)
	previous := i.sources[key]
	if previous.owner != "" && previous.owner != owner {
		delete(i.owners[previous.owner], key)
	}
	state := attentionSourceState{
		record: record, owner: owner, generation: previous.generation + 1,
	}
	evaluation := evaluateAttentionSource(record, now)
	state.deadline = evaluation.NextEvaluation
	i.sources[key] = state
	if i.owners[owner] == nil {
		i.owners[owner] = make(map[string]struct{})
	}
	i.owners[owner][key] = struct{}{}
	i.applyFindingLocked(key, evaluation.Finding)
	if !state.deadline.IsZero() {
		heap.Push(&i.deadlines, attentionDeadline{key: key, generation: state.generation, at: state.deadline})
	}
}

func (i *clusterAttentionIndex) deleteSourceLocked(owner, key string) {
	state, exists := i.sources[key]
	if !exists || state.owner != owner {
		return
	}
	delete(i.sources, key)
	delete(i.owners[owner], key)
	i.applyFindingLocked(key, nil)
}

func (i *clusterAttentionIndex) applyFindingLocked(key string, finding *AttentionFinding) {
	previous, existed := i.findings[key]
	if finding == nil {
		if !existed {
			return
		}
		delete(i.findings, key)
		i.maintained.store.Delete(key)
		i.maintained.bumpSinkVersion()
		i.revision++
		i.markDirtyLocked()
		return
	}
	row := *finding
	row.ClusterMeta = i.meta
	row.Kind = row.Ref.Kind
	row.Name = row.Ref.Name
	row.Namespace = row.Ref.Namespace
	if existed && reflect.DeepEqual(previous, row) {
		return
	}
	i.findings[key] = row
	i.maintained.store.Upsert(row)
	i.maintained.bumpSinkVersion()
	i.revision++
	i.markDirtyLocked()
}

func (i *clusterAttentionIndex) EvaluateDue(now time.Time) {
	if i == nil {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return
	}
	for {
		i.pruneDeadlinesLocked()
		if len(i.deadlines) == 0 || i.deadlines[0].at.After(now) {
			break
		}
		deadline := heap.Pop(&i.deadlines).(attentionDeadline)
		state, exists := i.sources[deadline.key]
		if !exists || state.generation != deadline.generation || !state.deadline.Equal(deadline.at) {
			continue
		}
		evaluation := evaluateAttentionSource(state.record, now)
		state.deadline = evaluation.NextEvaluation
		i.sources[deadline.key] = state
		i.applyFindingLocked(deadline.key, evaluation.Finding)
		if !state.deadline.IsZero() {
			heap.Push(&i.deadlines, attentionDeadline{key: deadline.key, generation: state.generation, at: state.deadline})
		}
	}
	i.armTimerLocked()
}

func (i *clusterAttentionIndex) Snapshot() []AttentionFinding {
	if i == nil {
		return nil
	}
	return i.maintained.store.Snapshot()
}

func (i *clusterAttentionIndex) Revision() uint64 {
	if i == nil {
		return 0
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.revision
}

func (i *clusterAttentionIndex) Stop() {
	if i == nil {
		return
	}
	i.mu.Lock()
	i.stopped = true
	timer := i.timer
	notify := i.notify
	i.timer = nil
	i.notify = nil
	i.mu.Unlock()
	if timer != nil {
		timer.Stop()
	}
	if notify != nil {
		notify.Stop()
	}
}

func (i *clusterAttentionIndex) SetBroadcast(broadcast func(version string)) {
	if i == nil {
		return
	}
	i.mu.Lock()
	i.broadcast = broadcast
	if i.dirty {
		i.armNotifyLocked()
	}
	i.mu.Unlock()
}

func (i *clusterAttentionIndex) markDirtyLocked() {
	i.dirty = true
	i.armNotifyLocked()
}

func (i *clusterAttentionIndex) armNotifyLocked() {
	if i.stopped || i.notify != nil || i.broadcast == nil {
		return
	}
	i.notify = time.AfterFunc(attentionNotifyDebounce, i.flushNotify)
}

func (i *clusterAttentionIndex) flushNotify() {
	i.mu.Lock()
	i.notify = nil
	if i.stopped || !i.dirty || i.broadcast == nil {
		i.mu.Unlock()
		return
	}
	i.dirty = false
	version := fmt.Sprintf("attention-%d", i.revision)
	broadcast := i.broadcast
	i.mu.Unlock()
	broadcast(version)
}

func (i *clusterAttentionIndex) pruneDeadlinesLocked() {
	for len(i.deadlines) > 0 {
		entry := i.deadlines[0]
		state, exists := i.sources[entry.key]
		if exists && state.generation == entry.generation && state.deadline.Equal(entry.at) {
			return
		}
		heap.Pop(&i.deadlines)
	}
}

func (i *clusterAttentionIndex) armTimerLocked() {
	if i.timer != nil {
		i.timer.Stop()
		i.timer = nil
	}
	if i.stopped {
		return
	}
	i.pruneDeadlinesLocked()
	if len(i.deadlines) == 0 {
		return
	}
	delay := i.deadlines[0].at.Sub(i.now())
	if delay < 0 {
		delay = 0
	}
	i.timer = time.AfterFunc(delay, func() { i.EvaluateDue(i.now()) })
}

func attentionRefKey(ref resourcemodel.ResourceRef) string {
	return strings.ToLower(strings.Join([]string{
		ref.ClusterID, ref.Group, ref.Version, ref.Kind, ref.Namespace, ref.Name,
	}, "\x00"))
}

func attentionQuerypageSchema() querypage.Schema[AttentionFinding] {
	return querypageSchemaFromAdapter(
		attentionTableQueryAdapter(),
		[]string{"name", "kind", "namespace", "severity", "status", "reason", "age"},
	)
}

func attentionTableQueryAdapter() typedTableQueryAdapter[AttentionFinding] {
	return typedTableQueryAdapter[AttentionFinding]{
		Key:       func(row AttentionFinding) string { return attentionRefKey(row.Ref) },
		Namespace: func(row AttentionFinding) string { return row.Namespace },
		Kind:      func(row AttentionFinding) string { return row.Kind },
		Facets: []typedTableQueryFacet[AttentionFinding]{
			{
				Descriptor: ResourceQueryFacetDescriptor{Key: "severities", Label: "Severity", Placeholder: "All severities", BulkActions: true},
				Value:      func(row AttentionFinding) string { return string(row.Severity) },
			},
		},
		SearchText: func(row AttentionFinding) []string {
			return []string{row.Kind, row.Name, row.Namespace, string(row.Severity), row.Status, strings.Join(row.Reasons, " ")}
		},
		Predicate: func(AttentionFinding, string, string) bool { return true },
		SortValue: func(row AttentionFinding, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Kind
			case "namespace":
				return row.Namespace
			case "severity":
				return string(row.Severity)
			case "status":
				return row.Status
			case "reason":
				return strings.Join(row.Reasons, ", ")
			case "age", "agetimestamp":
				return strconv.FormatInt(row.AgeTimestamp, 10)
			default:
				return row.Name
			}
		},
		NumericSort: func(row AttentionFinding, field string) (float64, bool) {
			if strings.EqualFold(field, "severity") {
				return attentionSeveritySortRank(row.Severity)
			}
			if strings.EqualFold(field, "age") || strings.EqualFold(field, "ageTimestamp") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

type ClusterAttentionPermissions struct {
	IncludePods         bool
	IncludeDeployments  bool
	IncludeStatefulSets bool
	IncludeDaemonSets   bool
	IncludeJobs         bool
	IncludeCronJobs     bool
	IncludeNodes        bool
	IncludeEvents       bool
}

func RegisterClusterAttentionDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	permissions ClusterAttentionPermissions,
	meta ClusterMeta,
	ingestManager *ingest.IngestManager,
) (*ClusterAttentionIndex, error) {
	if reg == nil {
		return nil, fmt.Errorf("%s registry is nil", clusterAttentionDomainName)
	}
	index := newClusterAttentionIndex(meta, time.Now)
	sources := []typedTableResourceSource{
		{Kind: "Pod", Group: "", Resource: "pods", Available: permissions.IncludePods},
		{Kind: "Deployment", Group: "apps", Resource: "deployments", Available: permissions.IncludeDeployments},
		{Kind: "StatefulSet", Group: "apps", Resource: "statefulsets", Available: permissions.IncludeStatefulSets},
		{Kind: "DaemonSet", Group: "apps", Resource: "daemonsets", Available: permissions.IncludeDaemonSets},
		{Kind: "Job", Group: "batch", Resource: "jobs", Available: permissions.IncludeJobs},
		{Kind: "CronJob", Group: "batch", Resource: "cronjobs", Available: permissions.IncludeCronJobs},
		{Kind: "Node", Group: "", Resource: "nodes", Available: permissions.IncludeNodes},
		{Kind: "Event", Group: "", Resource: "events", Available: permissions.IncludeEvents},
	}
	registrations := []struct {
		gvr     schema.GroupVersionResource
		source  attentionSource
		include bool
	}{
		{PodGVR, attentionSourcePod, permissions.IncludePods},
		{DeploymentGVR, attentionSourceWorkload, permissions.IncludeDeployments},
		{StatefulSetGVR, attentionSourceWorkload, permissions.IncludeStatefulSets},
		{DaemonSetGVR, attentionSourceWorkload, permissions.IncludeDaemonSets},
		{JobGVR, attentionSourceWorkload, permissions.IncludeJobs},
		{CronJobGVR, attentionSourceWorkload, permissions.IncludeCronJobs},
		{NodeGVR, attentionSourceNode, permissions.IncludeNodes},
	}
	for _, registration := range registrations {
		owner := registration.gvr.String()
		index.registerOwnerKind(owner, attentionKindForSource(registration.source, registration.gvr))
		if !registration.include || ingestManager == nil || !ingestManager.AddBundleSink(registration.gvr, attentionBundleSink{
			index: index, owner: owner, source: registration.source,
		}) {
			index.markOwnerUnavailable(owner)
		}
	}
	index.registerOwnerKind("events", "Event")
	if permissions.IncludeEvents {
		if factory == nil {
			index.Stop()
			return nil, fmt.Errorf("%s shared informer factory is nil", clusterAttentionDomainName)
		}
		events := factory.Core().V1().Events().Informer()
		index.eventRows = func() []attentionSourceRecord {
			objects := events.GetIndexer().List()
			rows := make([]attentionSourceRecord, 0, len(objects))
			for _, object := range objects {
				event, ok := object.(*corev1.Event)
				if !ok {
					continue
				}
				if record, keep := attentionRecordFromEvent(meta, event); keep {
					rows = append(rows, record)
				}
			}
			return rows
		}
		if _, err := events.AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc: func(obj interface{}) { index.upsertEvent(meta, obj) },
			UpdateFunc: func(oldObj, newObj interface{}) {
				if eventUpdateIsEcho(oldObj, newObj) {
					return
				}
				index.upsertEvent(meta, newObj)
			},
			DeleteFunc: func(obj interface{}) { index.deleteEvent(meta, obj) },
		}); err != nil {
			index.Stop()
			return nil, fmt.Errorf("%s: register events handler: %w", clusterAttentionDomainName, err)
		}
	} else {
		index.markOwnerUnavailable("events")
	}
	reg.RegisterMaintainedStore(clusterAttentionDomainName, index)
	if err := reg.Register(refresh.DomainConfig{Name: clusterAttentionDomainName, BuildSnapshot: (&ClusterAttentionBuilder{index: index, sources: sources}).Build}); err != nil {
		index.Stop()
		return nil, err
	}
	return index, nil
}

func attentionKindForSource(source attentionSource, gvr schema.GroupVersionResource) string {
	switch source {
	case attentionSourcePod:
		return "Pod"
	case attentionSourceNode:
		return "Node"
	case attentionSourceWorkload:
		for _, workload := range workloadStoreGVRKinds {
			if workload.GVR == gvr {
				return workload.Kind
			}
		}
	}
	return ""
}

type attentionBundleSink struct {
	index  *clusterAttentionIndex
	owner  string
	source attentionSource
}

func (s attentionBundleSink) UpsertBundle(bundle ingest.Bundle) {
	if record, ok := attentionRecordFromBundle(s.source, bundle); ok {
		s.index.UpsertSource(s.owner, record)
	}
}

func (s attentionBundleSink) DeleteBundle(bundle ingest.Bundle) {
	catalog, ok := bundle.Catalog.(objectcatalog.Summary)
	if !ok {
		return
	}
	s.index.DeleteSource(s.owner, resourceRefFromCatalog(catalog))
}

func (s attentionBundleSink) ReplaceBundles(bundles []ingest.Bundle) {
	records := make([]attentionSourceRecord, 0, len(bundles))
	for _, bundle := range bundles {
		if record, ok := attentionRecordFromBundle(s.source, bundle); ok {
			records = append(records, record)
		}
	}
	s.index.ReplaceSource(s.owner, records)
}

func resourceRefFromCatalog(catalog objectcatalog.Summary) resourcemodel.ResourceRef {
	return resourcemodel.ResourceRef{
		ClusterID: catalog.ClusterID, Group: catalog.Group, Version: catalog.Version,
		Kind: catalog.Kind, Resource: catalog.Resource, Namespace: catalog.Namespace,
		Name: catalog.Name, UID: catalog.UID,
	}
}

func (i *clusterAttentionIndex) upsertEvent(meta ClusterMeta, obj interface{}) {
	event, ok := maintainedUnwrap(obj).(*corev1.Event)
	if !ok {
		return
	}
	if record, keep := attentionRecordFromEvent(meta, event); keep {
		i.UpsertSource("events", record)
	}
}

func (i *clusterAttentionIndex) deleteEvent(meta ClusterMeta, obj interface{}) {
	event, ok := maintainedUnwrap(obj).(*corev1.Event)
	if !ok {
		return
	}
	record, valid := attentionRecordFromEvent(meta, event)
	if valid {
		i.DeleteSource("events", record.Ref)
	}
}

var _ ingest.BundleReplaceSink = attentionBundleSink{}

func evaluateAttentionSource(record attentionSourceRecord, now time.Time) attentionEvaluation {
	if !completeAttentionRef(record.Ref) {
		return attentionEvaluation{}
	}

	switch record.Source {
	case attentionSourcePod:
		return evaluatePodAttention(record, now)
	case attentionSourceWorkload:
		return evaluateWorkloadAttention(record, now)
	case attentionSourceNode:
		return evaluateNodeAttention(record)
	case attentionSourceEvent:
		return evaluateEventAttention(record, now)
	default:
		return attentionEvaluation{}
	}
}

func attentionRecordFromBundle(source attentionSource, bundle ingest.Bundle) (attentionSourceRecord, bool) {
	catalog, ok := bundle.Catalog.(objectcatalog.Summary)
	if !ok {
		return attentionSourceRecord{}, false
	}
	record := attentionSourceRecord{
		Ref: resourcemodel.ResourceRef{
			ClusterID: catalog.ClusterID,
			Group:     catalog.Group,
			Version:   catalog.Version,
			Kind:      catalog.Kind,
			Resource:  catalog.Resource,
			Namespace: catalog.Namespace,
			Name:      catalog.Name,
			UID:       catalog.UID,
		},
		Source: source,
	}
	switch source {
	case attentionSourcePod:
		row, typed := bundle.Table.(PodSummary)
		if !typed {
			return attentionSourceRecord{}, false
		}
		record.Status = row.Status
		record.StatusPresentation = row.StatusPresentation
		record.StatusReason = row.StatusReason
		record.Ready = row.Ready
		record.Restarts = row.Restarts
		record.AgeTimestamp = row.AgeTimestamp
	case attentionSourceWorkload:
		row, typed := bundle.Table.(WorkloadSummary)
		if !typed {
			return attentionSourceRecord{}, false
		}
		record.Status = row.Status
		record.StatusPresentation = row.StatusPresentation
		record.StatusReason = row.StatusReason
		record.Ready = row.Ready
		record.Restarts = row.Restarts
		record.AgeTimestamp = row.AgeTimestamp
	case attentionSourceNode:
		row, typed := bundle.Table.(NodeSummary)
		if !typed {
			return attentionSourceRecord{}, false
		}
		record.Status = row.Status
		record.StatusPresentation = row.StatusPresentation
		record.StatusReason = row.StatusReason
		record.Restarts = row.Restarts
		record.AgeTimestamp = row.AgeTimestamp
	default:
		return attentionSourceRecord{}, false
	}
	return record, completeAttentionRef(record.Ref)
}

func attentionRecordFromEvent(meta ClusterMeta, event *corev1.Event) (attentionSourceRecord, bool) {
	if event == nil {
		return attentionSourceRecord{}, false
	}
	timestamp := eventres.EventTimestamp(event).Time
	record := attentionSourceRecord{
		Ref: resourcemodel.ResourceRef{
			ClusterID: meta.ClusterID,
			Group:     "",
			Version:   "v1",
			Kind:      "Event",
			Resource:  "events",
			Namespace: event.Namespace,
			Name:      event.Name,
			UID:       string(event.UID),
		},
		Source:       attentionSourceEvent,
		Status:       event.Type,
		StatusReason: event.Reason,
		Message:      event.Message,
		AgeTimestamp: timestamp.UnixMilli(),
	}
	return record, completeAttentionRef(record.Ref)
}

func evaluatePodAttention(record attentionSourceRecord, now time.Time) attentionEvaluation {
	classification, statusNeedsAttention := classifyAttentionSource(record)
	if statusNeedsAttention && classification.Grace > 0 && record.Restarts == 0 {
		if deadline, deferred := warningGraceDeadline(record.AgeTimestamp, now); deferred {
			return attentionEvaluation{NextEvaluation: deadline}
		}
	}
	if !statusNeedsAttention && record.Restarts == 0 {
		return attentionEvaluation{}
	}

	reasons := make([]string, 0, 2)
	if statusNeedsAttention {
		reasons = appendReason(reasons, attentionClassificationReason(classification, record))
	}
	severity := AttentionSeverity("")
	if statusNeedsAttention {
		severity = classification.Severity
	}
	if record.Restarts > 0 {
		restartPolicy := attentionPolicyForSignal(attentionSignalRestarts)
		reasons = appendReason(reasons, fmt.Sprintf("%d restarts", record.Restarts))
		severity = moreSevereAttentionLevel(severity, restartPolicy.Severity)
	}
	return findingEvaluation(record, severity, reasons)
}

func evaluateWorkloadAttention(record attentionSourceRecord, now time.Time) attentionEvaluation {
	classification, statusNeedsAttention := classifyAttentionSource(record)
	replicaMismatch := readyReplicaMismatch(record.Ready)
	if !statusNeedsAttention && !replicaMismatch && record.Restarts == 0 {
		return attentionEvaluation{}
	}
	severity := AttentionSeverity("")
	grace := time.Duration(0)
	if statusNeedsAttention {
		severity = classification.Severity
		grace = classification.Grace
	}
	if replicaMismatch {
		replicaPolicy := attentionPolicyForSignal(attentionSignalReplicaMismatch)
		severity = moreSevereAttentionLevel(severity, replicaPolicy.Severity)
		if replicaPolicy.Grace > grace {
			grace = replicaPolicy.Grace
		}
	}
	if record.Restarts > 0 {
		restartPolicy := attentionPolicyForSignal(attentionSignalRestarts)
		severity = moreSevereAttentionLevel(severity, restartPolicy.Severity)
		grace = restartPolicy.Grace
	}
	if grace > 0 && record.Restarts == 0 {
		if deadline, deferred := warningGraceDeadline(record.AgeTimestamp, now); deferred {
			return attentionEvaluation{NextEvaluation: deadline}
		}
	}

	reasons := make([]string, 0, 3)
	if statusNeedsAttention {
		reasons = appendReason(reasons, attentionClassificationReason(classification, record))
	}
	if replicaMismatch {
		reasons = appendReason(reasons, strings.TrimSpace(record.Ready)+" ready")
	}
	if record.Restarts > 0 {
		reasons = appendReason(reasons, fmt.Sprintf("%d restarts", record.Restarts))
	}
	return findingEvaluation(record, severity, reasons)
}

func evaluateNodeAttention(record attentionSourceRecord) attentionEvaluation {
	classification, needsAttention := classifyAttentionSource(record)
	if !needsAttention {
		return attentionEvaluation{}
	}
	return findingEvaluation(record, classification.Severity, []string{attentionClassificationReason(classification, record)})
}

func evaluateEventAttention(record attentionSourceRecord, now time.Time) attentionEvaluation {
	classification, needsAttention := classifyAttentionSource(record)
	if !needsAttention || record.AgeTimestamp <= 0 {
		return attentionEvaluation{}
	}
	observedAt := time.UnixMilli(record.AgeTimestamp).UTC()
	expiresAt := observedAt.Add(attentionEventLookback)
	if !now.Before(expiresAt) {
		return attentionEvaluation{}
	}
	reasons := appendReason(nil, record.StatusReason)
	reasons = appendReason(reasons, record.Message)
	evaluation := findingEvaluation(record, classification.Severity, reasons)
	evaluation.NextEvaluation = expiresAt
	return evaluation
}

func warningGraceDeadline(ageTimestamp int64, now time.Time) (time.Time, bool) {
	if ageTimestamp <= 0 {
		return time.Time{}, false
	}
	deadline := time.UnixMilli(ageTimestamp).UTC().Add(attentionWarningGrace)
	return deadline, now.Before(deadline)
}

func readyReplicaMismatch(ready string) bool {
	parts := strings.Split(strings.TrimSpace(ready), "/")
	if len(parts) != 2 {
		return false
	}
	available, availableErr := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 32)
	desired, desiredErr := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 32)
	return availableErr == nil && desiredErr == nil && desired > 0 && available < desired
}

func findingEvaluation(record attentionSourceRecord, severity AttentionSeverity, reasons []string) attentionEvaluation {
	reasons = compactReasons(reasons)
	if len(reasons) == 0 {
		return attentionEvaluation{}
	}
	return attentionEvaluation{Finding: &AttentionFinding{
		Ref:          record.Ref,
		Severity:     severity,
		Status:       firstNonEmpty(record.Status, reasons[0]),
		Reasons:      reasons,
		Age:          formatAge(time.UnixMilli(record.AgeTimestamp)),
		AgeTimestamp: record.AgeTimestamp,
	}}
}

func completeAttentionRef(ref resourcemodel.ResourceRef) bool {
	return strings.TrimSpace(ref.ClusterID) != "" &&
		strings.TrimSpace(ref.Version) != "" &&
		strings.TrimSpace(ref.Kind) != "" &&
		strings.TrimSpace(ref.Resource) != "" &&
		strings.TrimSpace(ref.Name) != ""
}

func appendReason(reasons []string, reason string) []string {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return reasons
	}
	for _, existing := range reasons {
		if existing == reason {
			return reasons
		}
	}
	return append(reasons, reason)
}

func compactReasons(reasons []string) []string {
	compacted := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		compacted = appendReason(compacted, reason)
	}
	return compacted
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
