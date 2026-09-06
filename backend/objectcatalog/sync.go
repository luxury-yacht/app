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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// preflightNamespaces returns the namespaces a descriptor's RBAC preflight
// asks about: the configured scope for a namespaced kind under a namespace
// scope (docs/architecture/namespace-scope.md), otherwise the single cluster-wide
// "" ask. The check's scope must match the collection's scope — a scoped
// identity is typically denied cluster-wide but allowed per namespace, and a
// cluster-wide-only preflight would skip collection for every kind.
func (s *Service) preflightNamespaces(desc resourceDescriptor) []string {
	scope := s.scopeNamespaces()
	if !desc.Namespaced || len(scope) == 0 {
		return []string{""}
	}
	return scope
}

// evaluateDescriptor checks if the given descriptor is allowed by the
// capabilities service: allowed in ANY of its preflight namespaces.
func (s *Service) evaluateDescriptor(ctx context.Context, svc *capabilities.Service, desc resourceDescriptor) (bool, error) {
	if svc == nil {
		return true, nil
	}
	reviews := descriptorPreflightReviews(desc, s.preflightNamespaces(desc))
	results, err := svc.Evaluate(ctx, reviews)
	if err != nil {
		return false, err
	}
	return summarizeDescriptorEvaluation(results)
}

func descriptorPreflightReviews(desc resourceDescriptor, namespaces []string) []capabilities.ReviewAttributes {
	reviews := make([]capabilities.ReviewAttributes, 0, len(namespaces))
	for _, namespace := range namespaces {
		reviews = append(reviews, capabilities.ReviewAttributes{
			ID: desc.GVR.String() + "|" + namespace,
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

func summarizeDescriptorEvaluation(results []capabilities.CheckResult) (bool, error) {
	var firstErr error
	answered := false
	for _, res := range results {
		switch {
		case res.Error != "":
			if firstErr == nil {
				firstErr = errors.New(res.Error)
			}
		case res.EvaluationError != "":
			if firstErr == nil {
				firstErr = errors.New(res.EvaluationError)
			}
		default:
			answered = true
			if res.Allowed {
				return true, nil
			}
		}
	}
	if !answered {
		if firstErr != nil {
			return false, firstErr
		}
		return false, nil
	}
	return false, nil
}

// evaluateDescriptorsBatch checks if the given descriptors are allowed by the capabilities service.
func (s *Service) evaluateDescriptorsBatch(ctx context.Context, svc *capabilities.Service, descriptors []resourceDescriptor) (map[int]bool, map[int]error, error) {
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

	allowed, errorsByIndex := summarizeBatchEvaluation(results, plan.indexes, len(descriptors))
	s.logDescriptorEvaluation(descriptors, plan.indexes, allowed, errorsByIndex)

	if len(errorsByIndex) == 0 {
		return allowed, errorsByIndex, nil
	}
	return allowed, nil, joinDescriptorEvaluationErrors(descriptors, errorsByIndex)
}

type descriptorEvaluationBatchPlan struct {
	checks  []capabilities.ReviewAttributes
	indexes []int
}

// descriptorEvaluationPlan creates one check per descriptor and preflight namespace.
// The indexes preserve the association between the capability service's positional
// results and the descriptors that supplied them.
func (s *Service) descriptorEvaluationPlan(descriptors []resourceDescriptor) descriptorEvaluationBatchPlan {
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
	indexes []int,
	descriptorCount int,
) (map[int]bool, map[int]error) {
	allowed := make(map[int]bool, descriptorCount)
	errorsByIndex := make(map[int]error)
	answered := make(map[int]bool, descriptorCount)
	for i, result := range results {
		if i >= len(indexes) {
			break
		}
		recordBatchEvaluationResult(indexes[i], result, allowed, answered, errorsByIndex)
	}
	for idx := range answered {
		delete(errorsByIndex, idx)
	}
	return allowed, errorsByIndex
}

func recordBatchEvaluationResult(
	idx int,
	result capabilities.CheckResult,
	allowed map[int]bool,
	answered map[int]bool,
	errorsByIndex map[int]error,
) {
	message := result.Error
	if message == "" {
		message = result.EvaluationError
	}
	if message != "" {
		if _, exists := errorsByIndex[idx]; !exists {
			errorsByIndex[idx] = errors.New(message)
		}
		return
	}
	answered[idx] = true
	if result.Allowed {
		allowed[idx] = true
	}
}

func (s *Service) logDescriptorEvaluation(
	descriptors []resourceDescriptor,
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
	descriptors []resourceDescriptor,
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
		examples = append(examples, descriptors[idx].GVR.String())
	}
	return examples
}

func joinDescriptorEvaluationErrors(descriptors []resourceDescriptor, errorsByIndex map[int]error) error {
	errs := make([]error, 0, len(errorsByIndex))
	for idx, errVal := range errorsByIndex {
		errs = append(errs, fmt.Errorf("%s: %w", descriptors[idx].GVR.String(), errVal))
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
	defer s.stopDynamicReflectors()
	defer s.stopIngestReconciliation()

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
	if s.opts.EnableReactiveUpdates && s.deps.InformerFactory != nil {
		notifier := newWatchNotifier(s)
		go func() {
			registerWatchHandlers(s.deps.InformerFactory, s.deps.APIExtensionsInformerFactory, notifier, s)
			go notifier.run(ctx)
			s.logInfo("catalog reactive updates enabled")
		}()
	}

	if s.opts.ResyncInterval <= 0 {
		<-ctx.Done()
		return ctx.Err()
	}

	resyncInterval := s.opts.ResyncInterval
	if s.opts.EnableReactiveUpdates && s.deps.InformerFactory != nil {
		// With reactive updates the full resync is a consistency safety net.
		if resyncInterval < config.ObjectCatalogReactiveMinResyncInterval {
			resyncInterval = config.ObjectCatalogReactiveMinResyncInterval
		}
	}
	// After a failed/incomplete sync (e.g. a startup race where ingest stores are
	// not yet synced), retry on a short interval that backs off toward the normal
	// cadence, so the catalog recovers in seconds instead of staying degraded until
	// the next full resync. A successful sync snaps back to the normal interval.
	interval := nextCatalogResyncInterval(
		initialSyncErr == nil, 0, s.opts.FailedSyncRetryInterval, resyncInterval,
	)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			err := s.sync(ctx)
			if err != nil && !errors.Is(err, context.Canceled) {
				s.logWarn(fmt.Sprintf("catalog resync failed: %v", err))
			}
			if next := nextCatalogResyncInterval(
				err == nil, interval, s.opts.FailedSyncRetryInterval, resyncInterval,
			); next != interval {
				interval = next
				ticker.Reset(interval)
			}
		}
	}
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
	descriptors       []resourceDescriptor
	aggregator        *streamingAggregator
	capabilityService *capabilities.Service
	resultsMu         sync.Mutex
	succeeded         map[string][]Summary
	failed            map[string]error
	allowedIndices    map[int]resourceDescriptor
	allowedSet        map[string]resourceDescriptor
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
	runErr := parallel.RunLimited(ctx, s.opts.ListWorkers, run.collectionTasks()...)
	return run.finish(runErr)
}

func newCatalogSync(s *Service, start time.Time) *catalogSync {
	currentItems, currentLastSeen, prevResourceCount := s.captureCurrentState()
	newItems := cloneSummaryMap(currentItems)
	return &catalogSync{
		service: s, start: start, prevResourceCount: prevResourceCount,
		prevItemCount: len(newItems), newItems: newItems,
		newLastSeen: cloneTimeMap(currentLastSeen), previousItems: currentItems,
		previousLastSeen: currentLastSeen,
	}
}

func (run *catalogSync) discover(ctx context.Context) (bool, error) {
	descriptors, err := run.service.discoverResources(ctx)
	if err != nil {
		return false, err
	}
	run.descriptors = descriptors
	if run.service.identity != nil {
		run.service.identity.replaceDiscovered(descriptors)
	}
	run.service.logInfo(fmt.Sprintf("catalog discovered %d descriptor(s)", len(descriptors)))
	return len(descriptors) == 0, nil
}

func (run *catalogSync) publishEmpty() {
	s := run.service
	s.mu.Lock()
	s.catalogIndex.reset()
	s.mu.Unlock()
	s.replaceFinalizerBlockers(nil)
	s.logDebug("no resources discovered; catalog cleared")
	elapsed := s.now().Sub(run.start)
	s.updateHealth(true, false, nil, 0)
	s.recordTelemetry(0, 0, elapsed, nil)
}

func (run *catalogSync) prepare(ctx context.Context) {
	sortResourceDescriptors(run.descriptors)
	s := run.service
	run.aggregator = newStreamingAggregator(s)
	s.broadcastStreaming(false)
	if factory := s.deps.CapabilityFactory; factory != nil {
		run.capabilityService = factory()
	}
	run.succeeded = make(map[string][]Summary, len(run.descriptors))
	run.failed = make(map[string]error)
	run.allowedIndices = make(map[int]resourceDescriptor)
	run.allowedSet = make(map[string]resourceDescriptor)
	run.preparePublishedState()
	run.evaluateCapabilities(ctx)
}

func sortResourceDescriptors(descriptors []resourceDescriptor) {
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
	s.items = run.newItems
	s.lastSeen = run.newLastSeen
	s.catalogIndex.replaceResources(nil)
	// Collectors incrementally rebuild this sync's query view after this reset.
	s.catalogIndex.resetQueryStore()
}

func (run *catalogSync) evaluateCapabilities(ctx context.Context) {
	if run.capabilityService == nil {
		return
	}
	allowed, batchErrors, err := run.service.evaluateDescriptorsBatch(ctx, run.capabilityService, run.descriptors)
	if err != nil || len(batchErrors) != 0 {
		return
	}
	run.batchEvaluated = true
	for idx, desc := range run.descriptors {
		if allowed[idx] {
			run.allow(idx, desc)
		}
	}
}

func (run *catalogSync) waitForCaches(ctx context.Context) error {
	wait := run.service.deps.WaitForCaches
	if wait != nil {
		if err := wait(ctx); err != nil {
			return fmt.Errorf("waiting for informer caches: %w", err)
		}
	}
	if err := run.waitForIngest(ctx); err != nil {
		return fmt.Errorf("waiting for catalog ingest stores: %w", err)
	}
	return nil
}

func (run *catalogSync) waitForIngest(ctx context.Context) error {
	source := run.service.deps.IngestSource
	gvrs := catalogStaticIngestGVRs(run.descriptors)
	if source == nil || len(gvrs) == 0 {
		return nil
	}
	waitTimer := time.NewTimer(run.service.opts.IngestSyncWaitTimeout)
	defer waitTimer.Stop()
	ticker := time.NewTicker(config.RefreshInformerSyncPollInterval)
	defer ticker.Stop()
	for {
		settled := true
		for _, gvr := range gvrs {
			if source.Tracks(gvr) && !source.HasSyncedFor(gvr) {
				settled = false
				break
			}
		}
		if settled {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-waitTimer.C:
			// A manager that never started cannot arm its per-GVR degrade deadline.
			// That deadline is measured from manager start and normally settles first;
			// this independent timer starts at catalog entry so the never-started case
			// remains bounded even though both use the same configured duration.
			// Continue into collection so synced resources remain usable and the
			// existing partial-sync diagnostic plus fast retry can report/recover the
			// unsynced stores instead of wedging the whole catalog before its run loop.
			run.service.ingestSyncTimeoutWarnOnce.Do(func() {
				run.service.logWarn("catalog ingest stores did not settle before the startup deadline; continuing with partial collection")
			})
			return nil
		case <-ticker.C:
		}
	}
}

func catalogStaticIngestGVRs(descriptors []resourceDescriptor) []schema.GroupVersionResource {
	gvrs := make([]schema.GroupVersionResource, 0, len(descriptors))
	seen := make(map[schema.GroupVersionResource]struct{})
	for _, desc := range descriptors {
		if _, owned := catalogIngestOwnedGVRs[desc.GVR]; !owned {
			continue
		}
		if _, exists := seen[desc.GVR]; exists {
			continue
		}
		seen[desc.GVR] = struct{}{}
		gvrs = append(gvrs, desc.GVR)
	}
	return gvrs
}

func (run *catalogSync) failBeforeCollection(err error) error {
	elapsed := run.service.now().Sub(run.start)
	run.service.updateHealth(false, true, err, 0)
	run.service.recordTelemetry(run.prevItemCount, run.prevResourceCount, elapsed, err)
	return err
}

func (run *catalogSync) collectionTasks() []func(context.Context) error {
	tasks := make([]func(context.Context) error, 0, len(run.descriptors))
	for index, desc := range run.descriptors {
		index, desc := index, desc
		tasks = append(tasks, func(ctx context.Context) error {
			return run.collectDescriptor(ctx, index, desc)
		})
	}
	return tasks
}

func (run *catalogSync) collectDescriptor(ctx context.Context, index int, desc resourceDescriptor) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !run.batchEvaluated {
		allowed, err := run.service.evaluateDescriptor(ctx, run.capabilityService, desc)
		if err != nil {
			run.recordFailure(desc, err)
			return err
		}
		if !allowed {
			return nil
		}
		run.allow(index, desc)
	} else if !run.isAllowed(desc) {
		return nil
	}

	summaries, err := run.service.collectResource(
		ctx, index, desc, run.service.scopeNamespaces(), run.aggregator,
	)
	if err != nil {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			run.recordFailure(desc, err)
		}
		return err
	}
	run.logCollected(desc, len(summaries))
	run.resultsMu.Lock()
	run.succeeded[desc.GVR.String()] = summaries
	run.resultsMu.Unlock()
	return nil
}

func (run *catalogSync) allow(index int, desc resourceDescriptor) {
	run.resultsMu.Lock()
	defer run.resultsMu.Unlock()
	run.allowedIndices[index] = desc
	run.allowedSet[desc.GVR.String()] = desc
}

func (run *catalogSync) isAllowed(desc resourceDescriptor) bool {
	run.resultsMu.Lock()
	defer run.resultsMu.Unlock()
	_, ok := run.allowedSet[desc.GVR.String()]
	return ok
}

func (run *catalogSync) recordFailure(desc resourceDescriptor, err error) {
	run.resultsMu.Lock()
	defer run.resultsMu.Unlock()
	run.failed[desc.GVR.String()] = err
}

func (run *catalogSync) logCollected(desc resourceDescriptor, count int) {
	if count == 0 {
		run.service.logDebug(fmt.Sprintf("catalog collected 0 objects for %s", desc.GVR.String()))
		return
	}
	run.service.logDebug(fmt.Sprintf("catalog collected %d object(s) for %s", count, desc.GVR.String()))
}

func (run *catalogSync) finish(runErr error) error {
	descriptorCache := run.applyCollectionResults()
	collectErr := run.collectionError(runErr)
	run.restoreFailedDescriptors()
	enrichCatalogActionFacts(run.newItems, run.allowedSet, run.failed)
	run.publish(descriptorCache, collectErr)
	run.recordCompletion(collectErr)
	return collectErr
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
	s.mu.Lock()
	for gvr, desc := range run.allowedSet {
		s.catalogIndex.setResource(gvr, desc)
	}
	s.mu.Unlock()
	return toDescriptorSlice(allowedDescriptors)
}

func (run *catalogSync) orderedAllowedDescriptors() []resourceDescriptor {
	allowed := make([]resourceDescriptor, 0, len(run.allowedIndices))
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
	return &PartialSyncError{FailedDescriptors: failedKeys, Err: errors.Join(joined...)}
}

func (run *catalogSync) restoreFailedDescriptors() {
	if len(run.failed) == 0 {
		return
	}
	for gvr := range run.failed {
		restoreDescriptorEntries(run.newItems, run.newLastSeen, run.previousItems, run.previousLastSeen, gvr)
	}
	for key, summary := range run.previousItems {
		if _, exists := run.newItems[key]; exists {
			continue
		}
		run.newItems[key] = summary
		if timestamp, ok := run.previousLastSeen[key]; ok {
			run.newLastSeen[key] = timestamp
		}
	}
}

func (run *catalogSync) publish(descriptors []Descriptor, collectErr error) {
	run.aggregator.finalize(descriptors, collectErr == nil)
	run.service.rebuildCacheFromItems(run.newItems, descriptors)
	run.service.pruneMissing(run.newLastSeen)
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
		s.updateHealth(true, false, nil, 0)
	} else {
		s.updateHealth(false, len(run.failed) > 0, collectErr, len(run.failed))
	}
	s.recordTelemetry(len(run.newItems), len(run.allowedSet), elapsed, collectErr)
}
