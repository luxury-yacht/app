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
// attention. Causes combines every active finding for that source object.
type AttentionFinding struct {
	ClusterMeta
	Ref          resourcemodel.ResourceRef `json:"ref"`
	Kind         string                    `json:"kind"`
	Name         string                    `json:"name"`
	Namespace    string                    `json:"namespace,omitempty"`
	Severity     AttentionSeverity         `json:"severity"`
	Status       string                    `json:"status"`
	Causes       []AttentionCause          `json:"causes"`
	Age          string                    `json:"age"`
	AgeTimestamp int64                     `json:"ageTimestamp,omitempty"`
}

// AttentionCause is one stable, independently suppressible reason an object
// appears in Attention. Type is persisted; Message is current display data.
type AttentionCause struct {
	Type     string            `json:"type"`
	Label    string            `json:"label"`
	Message  string            `json:"message"`
	Severity AttentionSeverity `json:"severity"`
}

// AttentionObjectFindingIgnore suppresses one finding type for one exact
// object identity. The UID prevents a replacement object from inheriting the
// old object's suppression.
type AttentionObjectFindingIgnore struct {
	Ref         resourcemodel.ResourceRef `json:"ref"`
	FindingType string                    `json:"findingType"`
}

// AttentionIgnoreRules is the effective suppression state for one cluster.
// ClusterFindingTypes apply only to this cluster; GlobalFindingTypes apply to
// every cluster, including clusters opened after the rule was persisted.
type AttentionIgnoreRules struct {
	ObjectFindings      []AttentionObjectFindingIgnore `json:"objectFindings"`
	ClusterFindingTypes []string                       `json:"clusterFindingTypes"`
	GlobalFindingTypes  []string                       `json:"globalFindingTypes"`
}

// AttentionFindingTypeDefinition is one stable type users can suppress.
type AttentionFindingTypeDefinition struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// AttentionSeverityCounts summarizes every current finding in the cluster,
// independent of the table's active query, page, or filters.
type AttentionSeverityCounts struct {
	Info    int `json:"info"`
	Warning int `json:"warning"`
	Error   int `json:"error"`
}

type ClusterAttentionSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	SeverityCounts AttentionSeverityCounts          `json:"severityCounts"`
	IgnoreRules    AttentionIgnoreRules             `json:"ignoreRules"`
	FindingTypes   []AttentionFindingTypeDefinition `json:"findingTypes"`
	Rows           []AttentionFinding               `json:"rows"`
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
	severityCounts := countAttentionSeverities(rows)
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
			SeverityCounts:        severityCounts,
			IgnoreRules:           b.index.IgnoreRules(),
			FindingTypes:          AttentionFindingTypes(),
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

func countAttentionSeverities(rows []AttentionFinding) AttentionSeverityCounts {
	var counts AttentionSeverityCounts
	for _, row := range rows {
		switch row.Severity {
		case AttentionSeverityInfo:
			counts.Info++
		case AttentionSeverityWarning:
			counts.Warning++
		case AttentionSeverityError:
			counts.Error++
		}
	}
	return counts
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
	objectNamespace    string
	Status             string
	StatusState        string
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

	mu                  sync.Mutex
	sources             map[string]attentionSourceState
	owners              map[string]map[string]struct{}
	ownerKinds          map[string]map[string]struct{}
	unavailableOwners   map[string]struct{}
	findings            map[string]AttentionFinding
	deadlines           attentionDeadlineHeap
	timer               *time.Timer
	notify              *time.Timer
	broadcast           func(version string)
	dirty               bool
	revision            uint64
	stopped             bool
	eventRows           func() []attentionSourceRecord
	eventRowsSynced     func() bool
	ignoreRules         AttentionIgnoreRules
	ignoredObjectPruner func(resourcemodel.ResourceRef)
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

// SetIgnoreRules replaces the cluster's suppression rules and immediately
// reprojects every maintained source so both the table and sidebar counts
// reflect the new state without rebuilding the refresh subsystem.
func (i *clusterAttentionIndex) SetIgnoreRules(rules AttentionIgnoreRules) {
	if i == nil {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return
	}
	rules = normalizeAttentionIgnoreRules(rules)
	rulesChanged := !reflect.DeepEqual(i.ignoreRules, rules)
	i.ignoreRules = rules
	now := i.now()
	for key, state := range i.sources {
		evaluation := i.filterIgnoredEvaluationLocked(evaluateAttentionSource(state.record, now))
		state.deadline = evaluation.NextEvaluation
		i.sources[key] = state
		i.applyFindingLocked(key, evaluation.Finding)
	}
	for _, row := range i.maintained.store.Snapshot() {
		key := attentionRefKey(row.Ref)
		if _, hasLiveSource := i.sources[key]; hasLiveSource {
			continue
		}
		filtered := i.filterIgnoredEvaluationLocked(attentionEvaluation{Finding: &row}).Finding
		i.applyFindingLocked(key, filtered)
	}
	if rulesChanged {
		i.revision++
		i.markDirtyLocked()
	}
	i.armTimerLocked()
}

func (i *clusterAttentionIndex) IgnoreRules() AttentionIgnoreRules {
	if i == nil {
		return AttentionIgnoreRules{}
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	return cloneAttentionIgnoreRules(i.ignoreRules)
}

func (i *clusterAttentionIndex) SetIgnoredObjectPruner(pruner func(resourcemodel.ResourceRef)) {
	if i == nil {
		return
	}
	i.mu.Lock()
	i.ignoredObjectPruner = pruner
	i.mu.Unlock()
}

func cloneAttentionIgnoreRules(rules AttentionIgnoreRules) AttentionIgnoreRules {
	return AttentionIgnoreRules{
		ObjectFindings:      append([]AttentionObjectFindingIgnore(nil), rules.ObjectFindings...),
		ClusterFindingTypes: append([]string(nil), rules.ClusterFindingTypes...),
		GlobalFindingTypes:  append([]string(nil), rules.GlobalFindingTypes...),
	}
}

func normalizeAttentionIgnoreRules(rules AttentionIgnoreRules) AttentionIgnoreRules {
	return AttentionIgnoreRules{
		ObjectFindings:      dedupeAttentionObjectFindings(rules.ObjectFindings),
		ClusterFindingTypes: normalizeAttentionFindingTypes(rules.ClusterFindingTypes),
		GlobalFindingTypes:  normalizeAttentionFindingTypes(rules.GlobalFindingTypes),
	}
}

func normalizeAttentionFindingTypes(rawTypes []string) []string {
	types := make([]string, 0, len(rawTypes))
	seenTypes := make(map[string]struct{}, len(rawTypes))
	for _, raw := range rawTypes {
		findingType := strings.TrimSpace(raw)
		if findingType == "" {
			continue
		}
		if _, exists := seenTypes[findingType]; exists {
			continue
		}
		seenTypes[findingType] = struct{}{}
		types = append(types, findingType)
	}
	return types
}

func (i *clusterAttentionIndex) filterIgnoredEvaluationLocked(evaluation attentionEvaluation) attentionEvaluation {
	if evaluation.Finding == nil {
		return evaluation
	}
	ignoredTypes := make(map[string]struct{}, len(i.ignoreRules.ClusterFindingTypes)+len(i.ignoreRules.GlobalFindingTypes))
	for _, findingType := range i.ignoreRules.ClusterFindingTypes {
		ignoredTypes[strings.TrimSpace(findingType)] = struct{}{}
	}
	for _, findingType := range i.ignoreRules.GlobalFindingTypes {
		ignoredTypes[strings.TrimSpace(findingType)] = struct{}{}
	}
	causes := make([]AttentionCause, 0, len(evaluation.Finding.Causes))
	for _, cause := range evaluation.Finding.Causes {
		if _, ignored := ignoredTypes[cause.Type]; ignored {
			continue
		}
		if i.objectFindingIgnoredLocked(evaluation.Finding.Ref, cause.Type) {
			continue
		}
		causes = append(causes, cause)
	}
	if len(causes) == 0 {
		evaluation.Finding = nil
		return evaluation
	}
	evaluation.Finding.Causes = causes
	evaluation.Finding.Severity = attentionCauseSeverity(causes)
	return evaluation
}

func (i *clusterAttentionIndex) objectFindingIgnoredLocked(ref resourcemodel.ResourceRef, findingType string) bool {
	target := attentionIgnoredObjectFindingKey(AttentionObjectFindingIgnore{Ref: ref, FindingType: findingType})
	if target == "" {
		return false
	}
	for _, ignored := range i.ignoreRules.ObjectFindings {
		if attentionIgnoredObjectFindingKey(ignored) == target {
			return true
		}
	}
	return false
}

func (i *clusterAttentionIndex) pruneIgnoredObjectLocked(ref resourcemodel.ResourceRef) bool {
	target := attentionIgnoredObjectKey(ref)
	if target == "" {
		return false
	}
	kept := i.ignoreRules.ObjectFindings[:0]
	removed := false
	for _, ignored := range i.ignoreRules.ObjectFindings {
		if attentionIgnoredObjectKey(ignored.Ref) == target {
			removed = true
			continue
		}
		kept = append(kept, ignored)
	}
	i.ignoreRules.ObjectFindings = kept
	if removed {
		i.revision++
		i.markDirtyLocked()
	}
	return removed
}

func attentionIgnoredObjectKey(ref resourcemodel.ResourceRef) string {
	if strings.TrimSpace(ref.UID) == "" {
		return ""
	}
	return strings.ToLower(strings.Join([]string{
		ref.ClusterID, ref.Group, ref.Version, ref.Kind, ref.Namespace, ref.Name, ref.UID,
	}, "\x00"))
}

func attentionIgnoredObjectFindingKey(ignore AttentionObjectFindingIgnore) string {
	objectKey := attentionIgnoredObjectKey(ignore.Ref)
	findingType := strings.TrimSpace(ignore.FindingType)
	if objectKey == "" || findingType == "" {
		return ""
	}
	return objectKey + "\x00" + strings.ToLower(findingType)
}

func dedupeAttentionObjectFindings(ignores []AttentionObjectFindingIgnore) []AttentionObjectFindingIgnore {
	deduped := make([]AttentionObjectFindingIgnore, 0, len(ignores))
	seen := make(map[string]struct{}, len(ignores))
	for _, ignore := range ignores {
		ignore.FindingType = strings.TrimSpace(ignore.FindingType)
		key := attentionIgnoredObjectFindingKey(ignore)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, ignore)
	}
	return deduped
}

func dedupeAttentionRefs(refs []resourcemodel.ResourceRef) []resourcemodel.ResourceRef {
	deduped := make([]resourcemodel.ResourceRef, 0, len(refs))
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		key := attentionIgnoredObjectKey(ref)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, ref)
	}
	return deduped
}

func (i *clusterAttentionIndex) UpsertSource(owner string, record attentionSourceRecord) {
	if i == nil || strings.TrimSpace(owner) == "" || !completeAttentionRef(record.Ref) {
		return
	}
	i.mu.Lock()
	if i.stopped {
		i.mu.Unlock()
		return
	}
	pruned := i.upsertSourceLocked(owner, record, i.now())
	pruner := i.ignoredObjectPruner
	i.armTimerLocked()
	i.mu.Unlock()
	if pruned != nil && pruner != nil {
		pruner(*pruned)
	}
}

func (i *clusterAttentionIndex) ReplaceSource(owner string, records []attentionSourceRecord) {
	i.replaceSource(owner, records, true)
}

func (i *clusterAttentionIndex) replaceSource(owner string, records []attentionSourceRecord, pruneMissingIgnores bool) {
	if i == nil || strings.TrimSpace(owner) == "" {
		return
	}
	i.mu.Lock()
	if i.stopped {
		i.mu.Unlock()
		return
	}
	want := make(map[string]struct{}, len(records))
	presentIgnoredKeys := make(map[string]struct{}, len(records))
	pruned := make([]resourcemodel.ResourceRef, 0)
	now := i.now()
	for _, record := range records {
		if !completeAttentionRef(record.Ref) {
			continue
		}
		key := attentionRefKey(record.Ref)
		want[key] = struct{}{}
		presentIgnoredKeys[attentionIgnoredObjectKey(record.Ref)] = struct{}{}
		if replaced := i.upsertSourceLocked(owner, record, now); replaced != nil {
			pruned = append(pruned, *replaced)
		}
	}
	for key := range i.owners[owner] {
		if _, keep := want[key]; keep {
			continue
		}
		state := i.sources[key]
		i.deleteSourceLocked(owner, key)
		if i.pruneIgnoredObjectLocked(state.record.Ref) {
			pruned = append(pruned, state.record.Ref)
		}
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
	if pruneMissingIgnores {
		for _, ignored := range append([]AttentionObjectFindingIgnore(nil), i.ignoreRules.ObjectFindings...) {
			if _, ownedKind := i.ownerKinds[owner][ignored.Ref.Kind]; !ownedKind {
				continue
			}
			if _, exists := presentIgnoredKeys[attentionIgnoredObjectKey(ignored.Ref)]; exists {
				continue
			}
			if i.pruneIgnoredObjectLocked(ignored.Ref) {
				pruned = append(pruned, ignored.Ref)
			}
		}
	}
	i.owners[owner] = want
	i.armTimerLocked()
	pruner := i.ignoredObjectPruner
	i.mu.Unlock()
	if pruner != nil {
		for _, ref := range dedupeAttentionRefs(pruned) {
			pruner(ref)
		}
	}
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
		key := attentionRefKey(row.Ref)
		filtered := i.filterIgnoredEvaluationLocked(attentionEvaluation{Finding: &row}).Finding
		if filtered == nil {
			i.maintained.store.Delete(key)
			continue
		}
		i.findings[key] = *filtered
		i.maintained.store.Upsert(*filtered)
	}
	i.maintained.bumpSinkVersion()
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
	eventRowsSynced := i.eventRowsSynced
	i.mu.Unlock()
	for _, owner := range unavailableOwners {
		i.replaceSource(owner, nil, false)
	}
	if eventRows != nil && (eventRowsSynced == nil || eventRowsSynced()) {
		i.ReplaceSource("events", eventRows())
	}
}

func (i *clusterAttentionIndex) DeleteSource(owner string, ref resourcemodel.ResourceRef) {
	if i == nil || strings.TrimSpace(owner) == "" {
		return
	}
	i.mu.Lock()
	if i.stopped {
		i.mu.Unlock()
		return
	}
	i.deleteSourceLocked(owner, attentionRefKey(ref))
	pruned := i.pruneIgnoredObjectLocked(ref)
	pruner := i.ignoredObjectPruner
	i.armTimerLocked()
	i.mu.Unlock()
	if pruned && pruner != nil {
		pruner(ref)
	}
}

func (i *clusterAttentionIndex) upsertSourceLocked(owner string, record attentionSourceRecord, now time.Time) *resourcemodel.ResourceRef {
	key := attentionRefKey(record.Ref)
	previous := i.sources[key]
	var pruned *resourcemodel.ResourceRef
	if previous.owner != "" && attentionIgnoredObjectKey(previous.record.Ref) != attentionIgnoredObjectKey(record.Ref) &&
		i.pruneIgnoredObjectLocked(previous.record.Ref) {
		removed := previous.record.Ref
		pruned = &removed
	}
	if previous.owner != "" && previous.owner != owner {
		delete(i.owners[previous.owner], key)
	}
	state := attentionSourceState{
		record: record, owner: owner, generation: previous.generation + 1,
	}
	evaluation := i.filterIgnoredEvaluationLocked(evaluateAttentionSource(record, now))
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
	return pruned
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
		evaluation := i.filterIgnoredEvaluationLocked(evaluateAttentionSource(state.record, now))
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
			{
				Descriptor: ResourceQueryFacetDescriptor{Key: "findings", Label: "Findings", Placeholder: "All findings", Searchable: true, BulkActions: true},
				Values:     func(row AttentionFinding) []string { return attentionCauseTypes(row.Causes) },
				Label:      attentionFindingTypeLabel,
			},
		},
		SearchText: func(row AttentionFinding) []string {
			return []string{
				row.Kind,
				row.Name,
				row.Namespace,
				string(row.Severity),
				row.Status,
				strings.Join(attentionCauseLabels(row.Causes), " "),
				strings.Join(attentionCauseMessages(row.Causes), " "),
			}
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
				return strings.Join(attentionCauseLabels(row.Causes), ", ")
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

func attentionCauseTypes(causes []AttentionCause) []string {
	types := make([]string, 0, len(causes))
	for _, cause := range causes {
		types = appendReason(types, cause.Type)
	}
	return types
}

func attentionFindingTypeLabel(findingType string) string {
	for _, definition := range AttentionFindingTypes() {
		if definition.ID == findingType {
			return definition.Label
		}
	}
	return findingType
}

func attentionCauseLabels(causes []AttentionCause) []string {
	labels := make([]string, 0, len(causes))
	for _, cause := range causes {
		labels = appendReason(labels, cause.Label)
	}
	return labels
}

func attentionCauseMessages(causes []AttentionCause) []string {
	messages := make([]string, 0, len(causes))
	for _, cause := range causes {
		if message := strings.TrimSpace(cause.Message); message != "" {
			messages = append(messages, message)
		}
	}
	return messages
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

type ClusterAttentionOptions struct {
	IgnoreRules         AttentionIgnoreRules
	IgnoredObjectPruner func(resourcemodel.ResourceRef)
}

func RegisterClusterAttentionDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	permissions ClusterAttentionPermissions,
	meta ClusterMeta,
	ingestManager *ingest.IngestManager,
	options ClusterAttentionOptions,
) (*ClusterAttentionIndex, error) {
	if reg == nil {
		return nil, fmt.Errorf("%s registry is nil", clusterAttentionDomainName)
	}
	index := newClusterAttentionIndex(meta, time.Now)
	index.SetIgnoreRules(options.IgnoreRules)
	index.SetIgnoredObjectPruner(options.IgnoredObjectPruner)
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
		index.eventRowsSynced = events.HasSynced
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
		record.StatusState = row.StatusState
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
		Source:          attentionSourceEvent,
		objectNamespace: event.InvolvedObject.Namespace,
		Status:          event.Type,
		StatusReason:    event.Reason,
		Message:         event.Message,
		AgeTimestamp:    timestamp.UnixMilli(),
	}
	return record, completeAttentionRef(record.Ref)
}

func evaluatePodAttention(record attentionSourceRecord, now time.Time) attentionEvaluation {
	classification, statusNeedsAttention := classifyAttentionSource(record)
	podNotReady := podReadyMismatch(record)
	if !statusNeedsAttention && !podNotReady && record.Restarts == 0 {
		return attentionEvaluation{}
	}

	nextEvaluation := time.Time{}
	graceDeadline, beforeGrace := warningGraceDeadline(record.AgeTimestamp, now)
	causes := make([]AttentionCause, 0, 3)

	includeClassification := statusNeedsAttention
	classificationSeverity := classification.Severity
	if statusNeedsAttention && classification.Grace > 0 && record.Restarts == 0 {
		if beforeGrace {
			if classification.GraceSeverity == "" {
				includeClassification = false
			} else {
				classificationSeverity = classification.GraceSeverity
			}
			nextEvaluation = graceDeadline
		}
	}
	if includeClassification {
		cause := classificationCause(classification, record)
		cause.Severity = classificationSeverity
		causes = appendAttentionCause(causes, cause)
	}
	if podNotReady {
		policy := attentionPolicyForSignal(attentionSignalPodNotReady)
		cause := signalCause(attentionSignalPodNotReady, policy, strings.TrimSpace(record.Ready)+" ready")
		if policy.Grace > 0 && beforeGrace {
			if policy.GraceSeverity != "" {
				cause.Severity = policy.GraceSeverity
				causes = appendAttentionCause(causes, cause)
			}
			nextEvaluation = graceDeadline
		} else {
			causes = appendAttentionCause(causes, cause)
		}
	}
	if record.Restarts > 0 {
		restartPolicy := attentionPolicyForSignal(attentionSignalRestarts)
		causes = appendAttentionCause(causes, signalCause(attentionSignalRestarts, restartPolicy, fmt.Sprintf("%d restarts", record.Restarts)))
	}
	evaluation := findingEvaluation(record, causes)
	evaluation.NextEvaluation = nextEvaluation
	return evaluation
}

func podReadyMismatch(record attentionSourceRecord) bool {
	ready, total, ok := parseReadyCounts(record.Ready)
	return ok && podCountsAsNotReadySignal(record.StatusState, ready, total)
}

func evaluateWorkloadAttention(record attentionSourceRecord, now time.Time) attentionEvaluation {
	classification, statusNeedsAttention := classifyAttentionSource(record)
	replicaMismatch := readyReplicaMismatch(record.Ready)
	if !statusNeedsAttention && !replicaMismatch && record.Restarts == 0 {
		return attentionEvaluation{}
	}
	graceDeadline, beforeGrace := warningGraceDeadline(record.AgeTimestamp, now)
	nextEvaluation := time.Time{}
	causes := make([]AttentionCause, 0, 3)
	if statusNeedsAttention {
		cause := classificationCause(classification, record)
		if classification.Grace > 0 && record.Restarts == 0 && beforeGrace {
			if classification.GraceSeverity != "" {
				cause.Severity = classification.GraceSeverity
				causes = appendAttentionCause(causes, cause)
			}
			nextEvaluation = graceDeadline
		} else {
			causes = appendAttentionCause(causes, cause)
		}
	}
	if replicaMismatch {
		policy := attentionPolicyForSignal(attentionSignalReplicaMismatch)
		cause := signalCause(attentionSignalReplicaMismatch, policy, strings.TrimSpace(record.Ready)+" ready")
		if policy.Grace > 0 && record.Restarts == 0 && beforeGrace {
			if policy.GraceSeverity != "" {
				cause.Severity = policy.GraceSeverity
				causes = appendAttentionCause(causes, cause)
			}
			nextEvaluation = graceDeadline
		} else {
			causes = appendAttentionCause(causes, cause)
		}
	}
	if record.Restarts > 0 {
		policy := attentionPolicyForSignal(attentionSignalRestarts)
		causes = appendAttentionCause(causes, signalCause(attentionSignalRestarts, policy, fmt.Sprintf("%d restarts", record.Restarts)))
	}
	evaluation := findingEvaluation(record, causes)
	evaluation.NextEvaluation = nextEvaluation
	return evaluation
}

func evaluateNodeAttention(record attentionSourceRecord) attentionEvaluation {
	classification, needsAttention := classifyAttentionSource(record)
	if !needsAttention {
		return attentionEvaluation{}
	}
	return findingEvaluation(record, []AttentionCause{classificationCause(classification, record)})
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
	message := strings.Join(compactReasons([]string{record.StatusReason, record.Message}), " · ")
	evaluation := findingEvaluation(record, []AttentionCause{{
		Type: classification.ID, Label: classification.Label, Message: message, Severity: classification.Severity,
	}})
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
	available, desired, ok := parseReadyCounts(ready)
	return ok && desired > 0 && available < desired
}

func parseReadyCounts(ready string) (int32, int32, bool) {
	parts := strings.Split(strings.TrimSpace(ready), "/")
	if len(parts) != 2 {
		return 0, 0, false
	}
	available, availableErr := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 32)
	desired, desiredErr := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 32)
	return int32(available), int32(desired), availableErr == nil && desiredErr == nil
}

func findingEvaluation(record attentionSourceRecord, causes []AttentionCause) attentionEvaluation {
	causes = compactAttentionCauses(causes)
	if len(causes) == 0 {
		return attentionEvaluation{}
	}
	return attentionEvaluation{Finding: &AttentionFinding{
		Ref:          record.Ref,
		Namespace:    attentionFindingNamespace(record),
		Severity:     attentionCauseSeverity(causes),
		Status:       firstNonEmpty(record.Status, causes[0].Message),
		Causes:       causes,
		Age:          formatAge(time.UnixMilli(record.AgeTimestamp)),
		AgeTimestamp: record.AgeTimestamp,
	}}
}

func attentionFindingNamespace(record attentionSourceRecord) string {
	if record.Source == attentionSourceEvent {
		return strings.TrimSpace(record.objectNamespace)
	}
	return strings.TrimSpace(record.Ref.Namespace)
}

func classificationCause(rule attentionClassificationRule, record attentionSourceRecord) AttentionCause {
	return AttentionCause{
		Type: rule.ID, Label: rule.Label, Message: attentionClassificationReason(rule, record), Severity: rule.Severity,
	}
}

func signalCause(signal attentionSignal, policy attentionSignalPolicy, message string) AttentionCause {
	return AttentionCause{Type: string(signal), Label: policy.Label, Message: message, Severity: policy.Severity}
}

func appendAttentionCause(causes []AttentionCause, cause AttentionCause) []AttentionCause {
	if strings.TrimSpace(cause.Type) == "" || strings.TrimSpace(cause.Message) == "" {
		return causes
	}
	for _, existing := range causes {
		if existing.Type == cause.Type && existing.Message == cause.Message {
			return causes
		}
	}
	return append(causes, cause)
}

func compactAttentionCauses(causes []AttentionCause) []AttentionCause {
	compacted := make([]AttentionCause, 0, len(causes))
	for _, cause := range causes {
		compacted = appendAttentionCause(compacted, cause)
	}
	return compacted
}

func attentionCauseSeverity(causes []AttentionCause) AttentionSeverity {
	severity := AttentionSeverity("")
	for _, cause := range causes {
		severity = moreSevereAttentionLevel(severity, cause.Severity)
	}
	return severity
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
