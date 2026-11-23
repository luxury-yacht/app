/*
 * backend/objectcatalog/sync.go
 *
 * Catalog sync pipeline and RBAC evaluation.
 */

package objectcatalog

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/config"
	"golang.org/x/sync/errgroup"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// preflightNamespaces returns the namespaces a descriptor's RBAC preflight
// asks about: the configured scope for a namespaced kind under a namespace
// scope (docs/architecture/namespace-scope.md), otherwise the single cluster-wide
// "" ask. The check's scope must match the collection's scope — a scoped
// identity is typically denied cluster-wide but allowed per namespace, and a
// cluster-wide-only preflight would skip collection for every kind.
func (s *Service) preflightNamespaces(desc Descriptor) []string {
	scope := s.scopeNamespaces()
	if !desc.Namespaced || len(scope) == 0 {
		return []string{""}
	}
	return scope
}

// evaluateDescriptor checks if the given descriptor is allowed by the
// capabilities service: allowed in ANY of its preflight namespaces.
func (s *Service) evaluateDescriptor(ctx context.Context, svc *capabilities.Service, desc Descriptor) (bool, map[string]bool, error) {
	if svc == nil {
		return true, nil, nil
	}
	reviews := descriptorPreflightReviews(desc, s.preflightNamespaces(desc))
	results, err := svc.Evaluate(ctx, reviews)
	if err != nil {
		return false, nil, err
	}
	var evaluation descriptorEvaluation
	for i, result := range results {
		evaluation.record(result, reviews[i].Attributes.Namespace)
	}
	allowed, err := evaluation.result()
	return allowed, evaluation.namespaces, err
}

func descriptorPreflightReviews(desc Descriptor, namespaces []string) []capabilities.ReviewAttributes {
	reviews := make([]capabilities.ReviewAttributes, 0, len(namespaces))
	for _, namespace := range namespaces {
		reviews = append(reviews, capabilities.ReviewAttributes{
			ID: desc.GVR().String() + "|" + namespace,
			Attributes: &authorizationv1.ResourceAttributes{
				Group:     desc.Group,
				Version:   desc.Version,
				Resource:  desc.Resource,
				Verb:      "list",
				Namespace: namespace,
			},
		})
	}
	return reviews
}

// Namespace grants are any-of. A definitive answer, including denial, takes
// precedence over a sibling namespace's error in both batch and fallback checks.
type descriptorEvaluation struct {
	allowed    bool
	answered   bool
	firstErr   error
	namespaces map[string]bool
}

func (e *descriptorEvaluation) record(result capabilities.CheckResult, namespace string) {
	message := result.Error
	if message == "" {
		message = result.EvaluationError
	}
	if message != "" {
		if e.firstErr == nil {
			e.firstErr = errors.New(message)
		}
		return
	}
	e.answered = true
	e.allowed = e.allowed || result.Allowed
	if namespace != "" {
		if e.namespaces == nil {
			e.namespaces = make(map[string]bool)
		}
		e.namespaces[namespace] = result.Allowed
	}
}

func (e descriptorEvaluation) result() (bool, error) {
	if e.answered {
		return e.allowed, nil
	}
	return false, e.firstErr
}

// evaluateDescriptorsBatch checks if the given descriptors are allowed by the capabilities service.
func (s *Service) evaluateDescriptorsBatch(ctx context.Context, svc *capabilities.Service, descriptors []Descriptor) (map[int]bool, map[int]map[string]bool, error) {
	allowed := make(map[int]bool, len(descriptors))
	if len(descriptors) == 0 {
		return allowed, nil, nil
	}

	if svc == nil {
		for idx := range descriptors {
			allowed[idx] = true
		}
		return allowed, nil, nil
	}

	plan := s.descriptorEvaluationPlan(descriptors)
	results, err := svc.Evaluate(ctx, plan.checks)
	if err != nil {
		return nil, nil, err
	}

	allowed, namespaces, errorsByIndex := summarizeBatchEvaluation(results, plan, len(descriptors))
	s.logDescriptorEvaluation(descriptors, plan.indexes, allowed, errorsByIndex)

	if len(errorsByIndex) == 0 {
		return allowed, namespaces, nil
	}
	return allowed, namespaces, joinDescriptorEvaluationErrors(descriptors, errorsByIndex)
}

type descriptorEvaluationBatchPlan struct {
	checks  []capabilities.ReviewAttributes
	indexes []int
}

// descriptorEvaluationPlan creates one check per descriptor and preflight namespace.
// The indexes preserve the association between the capability service's positional
// results and the descriptors that supplied them.
func (s *Service) descriptorEvaluationPlan(descriptors []Descriptor) descriptorEvaluationBatchPlan {
	plan := descriptorEvaluationBatchPlan{
		checks:  make([]capabilities.ReviewAttributes, 0, len(descriptors)),
		indexes: make([]int, 0, len(descriptors)),
	}
	for idx, desc := range descriptors {
		for _, check := range descriptorPreflightReviews(desc, s.preflightNamespaces(desc)) {
			plan.checks = append(plan.checks, check)
			plan.indexes = append(plan.indexes, idx)
		}
	}
	return plan
}

func summarizeBatchEvaluation(
	results []capabilities.CheckResult,
	plan descriptorEvaluationBatchPlan,
	descriptorCount int,
) (map[int]bool, map[int]map[string]bool, map[int]error) {
	evaluations := make(map[int]descriptorEvaluation, descriptorCount)
	for i, result := range results {
		if i >= len(plan.indexes) {
			break
		}
		idx := plan.indexes[i]
		evaluation := evaluations[idx]
		evaluation.record(result, plan.checks[i].Attributes.Namespace)
		evaluations[idx] = evaluation
	}
	allowed := make(map[int]bool, descriptorCount)
	namespaces := make(map[int]map[string]bool)
	errorsByIndex := make(map[int]error)
	for idx, evaluation := range evaluations {
		granted, err := evaluation.result()
		if granted {
			allowed[idx] = true
		}
		if len(evaluation.namespaces) != 0 {
			namespaces[idx] = evaluation.namespaces
		}
		if err != nil {
			errorsByIndex[idx] = err
		}
	}
	return allowed, namespaces, errorsByIndex
}

func (s *Service) logDescriptorEvaluation(
	descriptors []Descriptor,
	indexes []int,
	allowed map[int]bool,
	errorsByIndex map[int]error,
) {
	if s.deps.Logger == nil {
		return
	}
	allowedCount, deniedCount := countDescriptorEvaluationResults(indexes, allowed, errorsByIndex)
	deniedExamples := descriptorDeniedExamples(descriptors, indexes, allowed, errorsByIndex, 5)
	msg := fmt.Sprintf(
		"catalog RBAC preflight: allowed=%d denied=%d errors=%d total=%d",
		allowedCount, deniedCount, len(errorsByIndex), len(descriptors),
	)
	if len(deniedExamples) > 0 {
		msg += " deniedSample=" + strings.Join(deniedExamples, ",")
	}
	if len(errorsByIndex) > 0 {
		s.logWarn(msg)
		return
	}
	s.logDebug(msg)
}

func countDescriptorEvaluationResults(indexes []int, allowed map[int]bool, errorsByIndex map[int]error) (int, int) {
	allowedCount := 0
	deniedCount := 0
	for _, idx := range indexes {
		if _, hasErr := errorsByIndex[idx]; hasErr {
			continue
		}
		if allowed[idx] {
			allowedCount++
		} else {
			deniedCount++
		}
	}
	return allowedCount, deniedCount
}

func descriptorDeniedExamples(
	descriptors []Descriptor,
	indexes []int,
	allowed map[int]bool,
	errorsByIndex map[int]error,
	limit int,
) []string {
	examples := make([]string, 0, limit)
	for _, idx := range indexes {
		if len(examples) >= limit {
			break
		}
		if _, hasErr := errorsByIndex[idx]; hasErr || allowed[idx] || idx >= len(descriptors) {
			continue
		}
		examples = append(examples, descriptors[idx].GVR().String())
	}
	return examples
}

func joinDescriptorEvaluationErrors(descriptors []Descriptor, errorsByIndex map[int]error) error {
	errs := make([]error, 0, len(errorsByIndex))
	for idx, errVal := range errorsByIndex {
		errs = append(errs, fmt.Errorf("%s: %w", descriptors[idx].GVR().String(), errVal))
	}
	return errors.Join(errs...)
}

func (s *Service) ensureDependencies() error {
	if s.deps.Common.KubernetesClient == nil {
		return errors.New("kubernetes client not initialised")
	}
	if s.deps.Common.EnsureClient != nil {
		if err := s.deps.Common.EnsureClient("object catalog"); err != nil {
			return err
		}
	}
	if s.deps.Common.DynamicClient == nil {
		return errors.New("dynamic client not initialised")
	}
	return nil
}

// nextCatalogResyncInterval schedules the next full resync. A successful sync uses
// the normal (full) cadence. A failed/incomplete sync — typically the startup race
// where ingest stores are not yet synced — retries on a short interval that backs
// off (doubling) toward full, so a transient failure self-heals in seconds instead
// of waiting up to the full interval (5 min with reactive updates), while a
// persistent failure settles at the normal cadence without hammering the cluster.
// A non-positive or too-large retry interval disables the fast-retry (keeps full).
func nextCatalogResyncInterval(syncOK bool, current, retry, full time.Duration) time.Duration {
	if syncOK || retry <= 0 || retry >= full {
		return full
	}
	next := current * 2
	if next < retry {
		next = retry
	}
	if next > full {
		next = full
	}
	return next
}

func (s *Service) runLoop(ctx context.Context) error {
	defer close(s.doneCh)
	defer s.stopIngestReconciliation()
	if s.opts.EnableReactiveUpdates && s.deps.IngestSource != nil {
		unsubscribe := s.deps.IngestSource.SubscribeDynamicCatalogChanges(s.applyDynamicCatalogChange)
		defer unsubscribe()
	}
	notifier := newWatchNotifier(s)

	// Initial sync.
	initialSyncErr := s.sync(ctx)
	if initialSyncErr != nil && !errors.Is(initialSyncErr, context.Canceled) {
		s.logWarn(fmt.Sprintf("initial catalog sync failed: %v", initialSyncErr))
	}

	// Start the reactive update notifier OFF the resync loop's critical path: the
	// sink-registration replay walks populated ingest stores and can take a while,
	// and a failed initial sync — the startup race — is exactly when the fast retry
	// below must fire promptly. Registration racing a sync is safe by design: the
	// contended ingest callbacks queue a trailing authoritative read, including
	// changes arriving after the full sync already collected their kind.
	watchCtx, cancelWatch := context.WithCancel(ctx)
	waitForNotifier := s.startWatchNotifier(watchCtx, notifier)
	// Defers run in reverse order: cancel before joining the notifier.
	defer waitForNotifier()
	defer cancelWatch()
	return s.runResyncLoop(ctx, initialSyncErr)
}

func (s *Service) startWatchNotifier(ctx context.Context, notifier *watchNotifier) func() {
	if !s.opts.EnableReactiveUpdates {
		return func() {
			// Reactive updates are disabled, so there is no notifier to join.
		}
	}
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		defer notifier.removeHandlers()
		registerWatchHandlers(notifier, s)
		s.logInfo("catalog reactive updates enabled")
		notifier.run(ctx)
	}()
	return func() { <-watchDone }
}

// requestCatalogRetry brings forward the next periodic sync. Direct recovery
// and periodic collection share this retry loop and its backoff.
func (s *Service) requestCatalogRetry() {
	select {
	case s.catalogRetry <- struct{}{}:
	default:
	}
}

func (s *Service) runResyncLoop(ctx context.Context, initialSyncErr error) error {
	if s.opts.ResyncInterval <= 0 {
		<-ctx.Done()
		return ctx.Err()
	}

	resyncInterval := s.fullResyncInterval()
	// After a failed/incomplete sync (e.g. a startup race where ingest stores are
	// not yet synced), retry on a short interval that backs off toward the normal
	// cadence, so the catalog recovers in seconds instead of staying degraded until
	// the next full resync. A successful sync snaps back to the normal interval.
	interval := nextCatalogResyncInterval(
		initialSyncErr == nil, 0, s.opts.FailedSyncRetryInterval, resyncInterval,
	)
	retry := nextCatalogResyncInterval(false, 0, s.opts.FailedSyncRetryInterval, resyncInterval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		var next time.Duration
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.catalogRetry:
			next = min(retry, interval)
		case <-ticker.C:
			next = s.resyncAndChooseNextInterval(ctx, interval, resyncInterval)
		}
		if next != interval {
			interval = next
			ticker.Reset(interval)
		}
	}
}

func (s *Service) resyncAndChooseNextInterval(ctx context.Context, current, full time.Duration) time.Duration {
	err := s.sync(ctx)
	if err != nil && !errors.Is(err, context.Canceled) {
		s.logWarn(fmt.Sprintf("catalog resync failed: %v", err))
	}
	reconciled := err == nil && !s.apiResources.discoveryPending()
	return nextCatalogResyncInterval(reconciled, current, s.opts.FailedSyncRetryInterval, full)
}

func (s *Service) fullResyncInterval() time.Duration {
	interval := s.opts.ResyncInterval
	if s.opts.EnableReactiveUpdates && interval < config.ObjectCatalogReactiveMinResyncInterval {
		// With reactive updates the full resync is a consistency safety net.
		return config.ObjectCatalogReactiveMinResyncInterval
	}
	return interval
}

type catalogSync struct {
	service           *Service
	start             time.Time
	prevResourceCount int
	prevItemCount     int
	newItems          map[string]Summary
	newLastSeen       map[string]time.Time
	previousItems     map[string]Summary
	previousLastSeen  map[string]time.Time
	descriptors       []Descriptor
	staleDescriptors  map[string]struct{}
	discoveryFailure  error
	aggregator        *streamingAggregator
	capabilityService *capabilities.Service
	resultsMu         sync.Mutex
	succeeded         map[string][]Summary
	failed            map[string]error
	allowedIndices    map[int]Descriptor
	allowedSet        map[string]Descriptor
	deniedNamespaces  map[string]map[string]struct{}
	batchEvaluated    bool
}

func (s *Service) sync(ctx context.Context) error {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	start := s.now()
	s.syncInProgress.Store(true)
	defer s.syncInProgress.Store(false)
	s.resetDeniedResources()

	run := newCatalogSync(s, start)
	empty, err := run.discover(ctx)
	if err != nil {
		return run.failBeforeCollection(err)
	}
	if empty {
		run.publishEmpty()
		return nil
	}
	run.prepare(ctx)
	if err := run.waitForCaches(ctx); err != nil {
		return run.failBeforeCollection(err)
	}
	runErr := run.collect(ctx)
	return run.finish(runErr)
}

func newCatalogSync(s *Service, start time.Time) *catalogSync {
	currentItems, currentLastSeen, prevResourceCount := s.captureCurrentState()
	s.mu.RLock()
	denied := make(map[string]map[string]struct{}, len(s.catalogIndex.deniedNamespaces))
	for gvr, namespaces := range s.catalogIndex.deniedNamespaces {
		denied[gvr] = maps.Clone(namespaces)
	}
	s.mu.RUnlock()
	newItems := cloneSummaryMap(currentItems)
	return &catalogSync{
		service: s, start: start, prevResourceCount: prevResourceCount,
		prevItemCount: len(newItems), newItems: newItems,
		newLastSeen: cloneTimeMap(currentLastSeen), previousItems: currentItems,
		previousLastSeen: currentLastSeen,
		deniedNamespaces: denied,
	}
}

func (run *catalogSync) discover(ctx context.Context) (bool, error) {
	result, err := run.service.discoverResources(ctx)
	if err != nil {
		return false, err
	}
	run.descriptors = result.descriptors
	run.discoveryFailure = filterDiscoveryFailures(result.partialFailure, func(gv schema.GroupVersion) bool {
		return catalogExcludedGroups.Has(gv.Group)
	})
	run.retainUnreadDescriptors(result.failedGroupVersions)
	if run.service.identity != nil {
		run.service.identity.replaceDiscovered(run.descriptors)
	}
	run.service.logInfo(fmt.Sprintf("catalog discovered %d descriptor(s)", len(run.descriptors)))
	return len(run.descriptors) == 0 && run.discoveryFailure == nil, nil
}

// Match the API Resources inventory's preferred identity through a partial
// response. In particular, a reachable sibling version cannot replace one
// whose preferred version may still exist.
func (run *catalogSync) retainUnreadDescriptors(failed []schema.GroupVersion) {
	if len(failed) == 0 {
		return
	}
	groups := failedAPIGroups(failed)
	discovered := make(map[schema.GroupResource]Descriptor, len(run.descriptors))
	for _, desc := range run.descriptors {
		discovered[desc.GVR().GroupResource()] = desc
	}
	var stale []Descriptor
	kept := make(map[schema.GroupResource]struct{})
	run.staleDescriptors = make(map[string]struct{})
	for _, desc := range run.service.Descriptors() {
		gr := desc.GVR().GroupResource()
		if _, unavailable := groups[desc.Group]; !unavailable || discovered[gr] == desc {
			continue
		}
		kept[gr] = struct{}{}
		run.staleDescriptors[desc.GVR().String()] = struct{}{}
		stale = append(stale, desc)
	}
	run.descriptors = slices.DeleteFunc(run.descriptors, func(desc Descriptor) bool {
		_, retained := kept[desc.GVR().GroupResource()]
		return retained
	})
	run.descriptors = append(run.descriptors, stale...)
}

func (run *catalogSync) publishEmpty() {
	s := run.service
	s.mu.Lock()
	s.catalogIndex.reset()
	s.mu.Unlock()
	s.publishSyncedAttentionSubsets(nil)
	s.logDebug("no resources discovered; catalog cleared")
	elapsed := s.now().Sub(run.start)
	s.updateHealth(true, false, nil, 0)
	s.recordTelemetry(0, 0, elapsed, nil)
	s.broadcastStreaming(true)
}

func (run *catalogSync) prepare(ctx context.Context) {
	sortResourceDescriptors(run.descriptors)
	s := run.service
	run.aggregator = newStreamingAggregator(s)
	if run.aggregator.publishProgress {
		s.broadcastStreaming(false)
	}
	if factory := s.deps.CapabilityFactory; factory != nil {
		run.capabilityService = factory()
	}
	run.succeeded = make(map[string][]Summary, len(run.descriptors))
	run.failed = make(map[string]error)
	run.allowedIndices = make(map[int]Descriptor)
	run.allowedSet = make(map[string]Descriptor)
	run.preparePublishedState()
	run.evaluateCapabilities(ctx)
}

func sortResourceDescriptors(descriptors []Descriptor) {
	sort.SliceStable(descriptors, func(i, j int) bool {
		left, right := descriptors[i], descriptors[j]
		if comparison := descriptorStreamingPriority(left) - descriptorStreamingPriority(right); comparison != 0 {
			return comparison < 0
		}
		if left.Kind != right.Kind {
			return left.Kind < right.Kind
		}
		if left.Group != right.Group {
			return left.Group < right.Group
		}
		if left.Version != right.Version {
			return left.Version < right.Version
		}
		return left.Resource < right.Resource
	})
}

func (run *catalogSync) preparePublishedState() {
	s := run.service
	s.mu.Lock()
	defer s.mu.Unlock()
	if run.aggregator.publishProgress {
		s.catalogIndex.replaceResources(nil)
		s.catalogIndex.resetQueryStore()
	}
}

func (run *catalogSync) evaluateCapabilities(ctx context.Context) {
	if run.capabilityService == nil {
		return
	}
	allowed, namespaces, err := run.service.evaluateDescriptorsBatch(ctx, run.capabilityService, run.descriptors)
	run.batchEvaluated = err == nil
	for idx, desc := range run.descriptors {
		run.applyNamespaceDecisions(desc, namespaces[idx])
		if run.batchEvaluated && allowed[idx] {
			run.allow(idx, desc)
		}
	}
}

// waitForCaches waits until the tracked ingest stores collection reads from
// have settled.
func (run *catalogSync) waitForCaches(ctx context.Context) error {
	ingestGVRs := catalogStaticIngestGVRs(run.descriptors)
	ingestGVRs = slices.DeleteFunc(ingestGVRs, func(gvr schema.GroupVersionResource) bool {
		_, stale := run.staleDescriptors[gvr.String()]
		return stale
	})
	if run.sourcesSettled(ingestGVRs) {
		return nil
	}
	waitTimer := time.NewTimer(run.service.opts.SourceSyncWaitTimeout)
	defer waitTimer.Stop()
	ticker := time.NewTicker(config.RefreshSyncPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("waiting for catalog sources: %w", ctx.Err())
		case <-waitTimer.C:
			// A manager that never started cannot arm its per-resource degrade
			// deadline. That deadline is measured from its start and normally settles
			// first; this independent timer starts at catalog entry so the
			// never-started case remains bounded even though both use the same
			// configured duration. Continue into collection so synced stores remain
			// usable: unsynced ingest stores report partial health and recover
			// through the fast retry.
			run.service.sourceSyncTimeoutWarnOnce.Do(func() {
				run.service.logWarn("catalog ingest stores did not settle before the startup deadline; continuing collection")
			})
			return nil
		case <-ticker.C:
			if run.sourcesSettled(ingestGVRs) {
				return nil
			}
		}
	}
}

func (run *catalogSync) sourcesSettled(ingestGVRs []schema.GroupVersionResource) bool {
	source := run.service.deps.IngestSource
	if source == nil {
		return true
	}
	for _, gvr := range ingestGVRs {
		if source.Tracks(gvr) && !source.HasSyncedFor(gvr) {
			return false
		}
	}
	return true
}

func catalogStaticIngestGVRs(descriptors []Descriptor) []schema.GroupVersionResource {
	gvrs := make([]schema.GroupVersionResource, 0, len(descriptors))
	seen := make(map[schema.GroupVersionResource]struct{})
	for _, desc := range descriptors {
		if _, owned := catalogIngestGVRs[desc.GVR()]; !owned {
			continue
		}
		if _, exists := seen[desc.GVR()]; exists {
			continue
		}
		seen[desc.GVR()] = struct{}{}
		gvrs = append(gvrs, desc.GVR())
	}
	return gvrs
}

func (run *catalogSync) failBeforeCollection(err error) error {
	elapsed := run.service.now().Sub(run.start)
	run.service.updateHealth(false, true, err, 0)
	run.service.recordTelemetry(run.prevItemCount, run.prevResourceCount, elapsed, err)
	return err
}

func (run *catalogSync) collect(ctx context.Context) error {
	// Kinds are independent. A failed LIST must not cancel healthy siblings;
	// caller cancellation still reaches every worker through the original context.
	var group errgroup.Group
	if limit := run.service.opts.ListWorkers; limit > 0 {
		group.SetLimit(limit)
	}
	for index, desc := range run.descriptors {
		group.Go(func() error {
			return run.collectDescriptor(ctx, index, desc)
		})
	}
	return group.Wait()
}

func (run *catalogSync) collectDescriptor(ctx context.Context, index int, desc Descriptor) error {
	if err := ctx.Err(); err != nil {
		run.recordFailure(desc, err)
		return err
	}
	allowed, err := run.admitDescriptor(ctx, index, desc)
	if err != nil {
		run.recordFailure(desc, err)
		return err
	}
	_, stale := run.staleDescriptors[desc.GVR().String()]
	if !allowed || stale {
		return nil
	}
	return run.collectAdmittedDescriptor(ctx, desc)
}

func (run *catalogSync) collectAdmittedDescriptor(ctx context.Context, desc Descriptor) error {
	summaries, err := run.service.collectResource(
		ctx, desc, run.readableNamespaces(desc), run.aggregator,
	)
	if err != nil {
		// Cancellation and bounded initial-read timeouts are incomplete reads too:
		// retain the descriptor's last publication and report partial health.
		run.recordFailure(desc, err)
		return err
	}
	run.logCollected(desc, len(summaries))
	run.resultsMu.Lock()
	run.succeeded[desc.GVR().String()] = summaries
	run.resultsMu.Unlock()
	return nil
}

func (run *catalogSync) admitDescriptor(ctx context.Context, index int, desc Descriptor) (bool, error) {
	if run.batchEvaluated {
		return run.isAllowed(desc), nil
	}
	allowed, namespaces, err := run.service.evaluateDescriptor(ctx, run.capabilityService, desc)
	run.applyNamespaceDecisions(desc, namespaces)
	if allowed {
		run.allow(index, desc)
	}
	return allowed, err
}

func (run *catalogSync) applyNamespaceDecisions(desc Descriptor, decisions map[string]bool) {
	if len(decisions) == 0 {
		return
	}
	run.resultsMu.Lock()
	defer run.resultsMu.Unlock()
	key := desc.GVR().String()
	denied := run.deniedNamespaces[key]
	if denied == nil {
		denied = make(map[string]struct{})
	}
	for namespace, allowed := range decisions {
		if allowed {
			delete(denied, namespace)
		} else {
			denied[namespace] = struct{}{}
		}
	}
	if len(denied) == 0 {
		delete(run.deniedNamespaces, key)
	} else {
		run.deniedNamespaces[key] = denied
	}
}

func (run *catalogSync) readableNamespaces(desc Descriptor) []string {
	scope := run.service.scopeNamespaces()
	run.resultsMu.Lock()
	defer run.resultsMu.Unlock()
	denied := run.deniedNamespaces[desc.GVR().String()]
	if len(denied) == 0 {
		return scope
	}
	return slices.DeleteFunc(slices.Clone(scope), func(namespace string) bool {
		_, forbidden := denied[namespace]
		return forbidden
	})
}

func (run *catalogSync) allow(index int, desc Descriptor) {
	run.resultsMu.Lock()
	defer run.resultsMu.Unlock()
	run.allowedIndices[index] = desc
	run.allowedSet[desc.GVR().String()] = desc
}

func (run *catalogSync) isAllowed(desc Descriptor) bool {
	run.resultsMu.Lock()
	defer run.resultsMu.Unlock()
	_, ok := run.allowedSet[desc.GVR().String()]
	return ok
}

func (run *catalogSync) recordFailure(desc Descriptor, err error) {
	run.resultsMu.Lock()
	defer run.resultsMu.Unlock()
	run.failed[desc.GVR().String()] = err
}

func (run *catalogSync) logCollected(desc Descriptor, count int) {
	if count == 0 {
		run.service.logDebug(fmt.Sprintf("catalog collected 0 objects for %s", desc.GVR().String()))
		return
	}
	run.service.logDebug(fmt.Sprintf("catalog collected %d object(s) for %s", count, desc.GVR().String()))
}

func (run *catalogSync) finish(runErr error) error {
	descriptorCache := run.applyCollectionResults()
	collectErr := run.collectionError(runErr)
	run.restoreFailedDescriptors()
	run.removeDeniedNamespaceRows()
	enrichCatalogActionFacts(run.newItems, run.allowedSet, run.failed, run.staleDescriptors)
	run.publish(descriptorCache, collectErr)
	run.recordCompletion(collectErr)
	return collectErr
}

func (run *catalogSync) removeDeniedNamespaceRows() {
	if len(run.deniedNamespaces) == 0 {
		return
	}
	for key, item := range run.newItems {
		if _, forbidden := run.deniedNamespaces[descriptorKeyFromItemKey(key)][item.Ref.Namespace]; forbidden {
			delete(run.newItems, key)
			delete(run.newLastSeen, key)
		}
	}
}

func (run *catalogSync) applyCollectionResults() []Descriptor {
	allowedDescriptors := run.orderedAllowedDescriptors()
	s := run.service
	s.logInfo(fmt.Sprintf("catalog RBAC allowed %d/%d descriptor(s)", len(allowedDescriptors), len(run.descriptors)))
	removeDisallowedEntries(run.newItems, run.newLastSeen, run.allowedSet)
	now := s.now()
	for gvr, summaries := range run.succeeded {
		desc := run.allowedSet[gvr]
		removeDescriptorEntries(run.newItems, run.newLastSeen, gvr)
		for _, summary := range summaries {
			key := catalogKey(desc, summary.Ref.Namespace, summary.Ref.Name)
			run.newItems[key] = summary
			run.newLastSeen[key] = now
		}
	}
	if len(allowedDescriptors) == 0 {
		return nil
	}
	return allowedDescriptors
}

func (run *catalogSync) orderedAllowedDescriptors() []Descriptor {
	allowed := make([]Descriptor, 0, len(run.allowedIndices))
	for idx := range run.descriptors {
		if desc, ok := run.allowedIndices[idx]; ok {
			allowed = append(allowed, desc)
		}
	}
	return allowed
}

func (run *catalogSync) collectionError(runErr error) error {
	if len(run.failed) == 0 {
		if runErr != nil {
			run.service.logWarn(fmt.Sprintf("catalog collection failed: %v", runErr))
		}
		if runErr == nil {
			return run.discoveryFailure
		}
		return runErr
	}
	failedKeys := make([]string, 0, len(run.failed))
	joined := make([]error, 0, len(run.failed))
	for gvr, failure := range run.failed {
		failedKeys = append(failedKeys, gvr)
		if failure != nil {
			joined = append(joined, fmt.Errorf("%s: %w", gvr, failure))
		}
	}
	sort.Strings(failedKeys)
	run.service.logWarn(fmt.Sprintf("catalog collection incomplete; retained previous data for %d descriptor(s)", len(run.failed)))
	return &PartialSyncError{FailedDescriptors: failedKeys, Err: errors.Join(append(joined, run.discoveryFailure)...)}
}

// A discovered descriptor skipped without a collection or review error was
// explicitly denied by permission preflight.
func (run *catalogSync) preflightDenied(gvr string) bool {
	_, allowed := run.allowedSet[gvr]
	_, failed := run.failed[gvr]
	return !allowed && !failed
}

func (run *catalogSync) restoreFailedDescriptors() {
	if len(run.failed) == 0 {
		return
	}
	for gvr := range run.failed {
		restoreDescriptorEntries(run.newItems, run.newLastSeen, run.previousItems, run.previousLastSeen, gvr)
	}
	denied := make(map[string]struct{})
	for _, desc := range run.descriptors {
		if key := desc.GVR().String(); run.preflightDenied(key) {
			denied[key] = struct{}{}
		}
	}
	run.restoreMissingRows(denied)
}

func (run *catalogSync) restoreMissingRows(denied map[string]struct{}) {
	for key, summary := range run.previousItems {
		if _, exists := run.newItems[key]; exists {
			continue
		}
		if _, forbidden := denied[descriptorKeyFromItemKey(key)]; forbidden {
			continue
		}
		run.newItems[key] = summary
		if timestamp, ok := run.previousLastSeen[key]; ok {
			run.newLastSeen[key] = timestamp
		}
	}
}

// completeResources are the resources this sync listed completely: collected
// without error and without a forbidden page. A failed resource keeps its
// previous rows, so a miss there proves nothing.
func (run *catalogSync) completeResources(denied map[string]struct{}) map[string]struct{} {
	complete := make(map[string]struct{}, len(run.succeeded))
	for gvr := range run.succeeded {
		if _, forbidden := denied[deniedResourceName(run.allowedSet[gvr])]; !forbidden {
			complete[gvr] = struct{}{}
		}
	}
	return complete
}

func (run *catalogSync) publish(descriptors []Descriptor, collectErr error) {
	s := run.service
	s.pruneMissing(run.newLastSeen)
	denied := s.deniedResourceSet()
	complete := run.completeResources(denied)
	// Collection owns these maps until the complete replacement is ready. Swap
	// rows, identities, list outcome and query state together under the
	// reader's lock.
	s.mu.Lock()
	s.items, s.lastSeen = run.newItems, run.newLastSeen
	s.catalogIndex.replaceResources(run.allowedSet)
	s.catalogIndex.replaceListOutcome(complete, denied)
	s.catalogIndex.deniedNamespaces = run.deniedNamespaces
	s.cacheRebuilds.Add(1)
	s.catalogIndex.rebuildCacheFromItems(run.newItems, descriptors)
	s.mu.Unlock()
	s.updateHealth(collectErr == nil, run.discoveryFailure != nil || len(run.failed) > 0, collectErr, len(run.failed))
	run.publishListedDefinitions(complete, denied)
	s.publishSyncedAttentionSubsets(run.newItems)
	// Notify after publishing the complete replacement, including rows retained
	// for failed descriptors, so readers never observe the intermediate batches.
	run.service.broadcastStreaming(collectErr == nil)
}

func (run *catalogSync) recordCompletion(collectErr error) {
	s := run.service
	elapsed := s.now().Sub(run.start)
	latency := run.aggregator.firstFlushLatency()
	s.setFirstBatchLatency(latency)
	if collectErr == nil {
		if latency > 0 {
			s.logDebug(fmt.Sprintf("catalog streaming first batch latency: %s", latency))
		}
		s.logInfo(fmt.Sprintf("catalog sync completed: %d objects, %d resources, took %s", len(run.newItems), len(run.allowedSet), elapsed))
	}
	s.recordTelemetry(len(run.newItems), len(run.allowedSet), elapsed, collectErr)
}
