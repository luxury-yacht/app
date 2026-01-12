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
	"github.com/luxury-yacht/app/backend/internal/parallel"
	authorizationv1 "k8s.io/api/authorization/v1"
)

// evaluateDescriptor checks if the given descriptor is allowed by the capabilities service.
func (s *Service) evaluateDescriptor(ctx context.Context, svc *capabilities.Service, desc resourceDescriptor) (bool, error) {
	if svc == nil {
		return true, nil
	}
	reviews := []capabilities.ReviewAttributes{
		{
			ID: desc.GVR.String(),
			Attributes: &authorizationv1.ResourceAttributes{
				Group:    desc.Group,
				Version:  desc.Version,
				Resource: desc.Resource,
				Verb:     "list",
			},
		},
	}
	results, err := svc.Evaluate(ctx, reviews)
	if err != nil {
		return false, err
	}
	if len(results) == 0 {
		return false, nil
	}
	res := results[0]
	if res.Error != "" {
		return false, errors.New(res.Error)
	}
	if res.EvaluationError != "" {
		return false, errors.New(res.EvaluationError)
	}
	return res.Allowed, nil
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

	checks := make([]capabilities.ReviewAttributes, 0, len(descriptors))
	indexes := make([]int, 0, len(descriptors))
	for idx, desc := range descriptors {
		checks = append(checks, capabilities.ReviewAttributes{
			ID: desc.GVR.String(),
			Attributes: &authorizationv1.ResourceAttributes{
				Group:    desc.Group,
				Version:  desc.Version,
				Resource: desc.Resource,
				Verb:     "list",
			},
		})
		indexes = append(indexes, idx)
	}

	results, err := svc.Evaluate(ctx, checks)
	if err != nil {
		return nil, nil, err
	}

	errorsByIndex := make(map[int]error)
	for i, res := range results {
		if i >= len(indexes) {
			break
		}
		idx := indexes[i]
		switch {
		case res.Error != "":
			errorsByIndex[idx] = errors.New(res.Error)
		case res.EvaluationError != "":
			errorsByIndex[idx] = errors.New(res.EvaluationError)
		default:
			allowed[idx] = res.Allowed
		}
	}

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
	if s.deps.Logger != nil {
		var deniedExamples []string
		if deniedCount > 0 {
			for _, idx := range indexes {
				if len(deniedExamples) >= 5 {
					break
				}
				if _, hasErr := errorsByIndex[idx]; hasErr {
					continue
				}
				if allowed[idx] {
					continue
				}
				if idx < len(descriptors) {
					deniedExamples = append(deniedExamples, descriptors[idx].GVR.String())
				}
			}
		}
		msg := fmt.Sprintf("catalog RBAC preflight: allowed=%d denied=%d errors=%d total=%d", allowedCount, deniedCount, len(errorsByIndex), len(descriptors))
		if len(deniedExamples) > 0 {
			msg = msg + " deniedSample=" + strings.Join(deniedExamples, ",")
		}
		if len(errorsByIndex) > 0 {
			s.logWarn(msg)
		} else {
			s.logDebug(msg)
		}
	}

	if len(errorsByIndex) == 0 {
		return allowed, errorsByIndex, nil
	}
	errs := make([]error, 0, len(errorsByIndex))
	for idx, errVal := range errorsByIndex {
		desc := descriptors[idx]
		errs = append(errs, fmt.Errorf("%s: %w", desc.GVR.String(), errVal))
	}
	return allowed, nil, errors.Join(errs...)
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

func (s *Service) runLoop(ctx context.Context) error {
	defer close(s.doneCh)
	defer s.stopPromotedInformers()

	// Initial sync.
	if err := s.sync(ctx); err != nil && !errors.Is(err, context.Canceled) {
		s.logWarn(fmt.Sprintf("initial catalog sync failed: %v", err))
	}

	if s.opts.ResyncInterval <= 0 {
		<-ctx.Done()
		return ctx.Err()
	}

	ticker := time.NewTicker(s.opts.ResyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := s.sync(ctx); err != nil && !errors.Is(err, context.Canceled) {
				s.logWarn(fmt.Sprintf("catalog resync failed: %v", err))
			}
		}
	}
}

func (s *Service) sync(ctx context.Context) error {
	start := s.now()

	currentItems, currentLastSeen, prevResourceCount := s.captureCurrentState()
	newItems := cloneSummaryMap(currentItems)
	newLastSeen := cloneTimeMap(currentLastSeen)
	previousItems := currentItems
	previousLastSeen := currentLastSeen
	prevItemCount := len(newItems)

	descriptors, err := s.discoverResources(ctx)
	if err != nil {
		elapsed := s.now().Sub(start)
		s.updateHealth(false, true, err, 0)
		s.recordTelemetry(prevItemCount, prevResourceCount, elapsed, err)
		return err
	}
	if s.deps.Logger != nil {
		s.logInfo(fmt.Sprintf("catalog discovered %d descriptor(s)", len(descriptors)))
	}
	if len(descriptors) == 0 {
		s.mu.Lock()
		s.items = make(map[string]Summary)
		s.lastSeen = make(map[string]time.Time)
		s.resources = make(map[string]resourceDescriptor)
		s.sortedChunks = nil
		s.cachedKinds = nil
		s.cachedNamespaces = nil
		s.cachedDescriptors = nil
		s.cachesReady = true
		s.mu.Unlock()
		s.logDebug("no resources discovered; catalog cleared")
		elapsed := s.now().Sub(start)
		s.updateHealth(true, false, nil, 0)
		s.recordTelemetry(0, 0, elapsed, nil)
		return nil
	}

	sort.SliceStable(descriptors, func(i, j int) bool {
		pi := descriptorStreamingPriority(descriptors[i])
		pj := descriptorStreamingPriority(descriptors[j])
		if pi != pj {
			return pi < pj
		}
		if descriptors[i].Kind != descriptors[j].Kind {
			return descriptors[i].Kind < descriptors[j].Kind
		}
		if descriptors[i].Group != descriptors[j].Group {
			return descriptors[i].Group < descriptors[j].Group
		}
		if descriptors[i].Version != descriptors[j].Version {
			return descriptors[i].Version < descriptors[j].Version
		}
		return descriptors[i].Resource < descriptors[j].Resource
	})

	agg := newStreamingAggregator(s)
	s.broadcastStreaming(false)

	var capService *capabilities.Service
	if factory := s.deps.CapabilityFactory; factory != nil {
		capService = factory()
	}

	s.mu.Lock()
	s.items = newItems
	s.lastSeen = newLastSeen
	s.resources = make(map[string]resourceDescriptor, len(descriptors))
	s.mu.Unlock()

	var resultsMu sync.Mutex
	succeeded := make(map[string][]Summary, len(descriptors))
	failed := make(map[string]error)
	allowedIndices := make(map[int]resourceDescriptor)
	allowedSet := make(map[string]resourceDescriptor)

	// Attempt batch RBAC evaluation to cut API churn; fall back to per-descriptor if batch fails.
	var batchEvaluated bool
	if capService != nil {
		if batchAllowed, batchErrors, batchErr := s.evaluateDescriptorsBatch(ctx, capService, descriptors); batchErr == nil && len(batchErrors) == 0 {
			batchEvaluated = true
			for idx, desc := range descriptors {
				if batchAllowed[idx] {
					allowedIndices[idx] = desc
					allowedSet[desc.GVR.String()] = desc
				}
			}
		}
	}

	tasks := make([]func(context.Context) error, 0, len(descriptors))
	for index, desc := range descriptors {
		index := index
		desc := desc
		tasks = append(tasks, func(taskCtx context.Context) error {
			if !batchEvaluated {
				allowed, evalErr := s.evaluateDescriptor(taskCtx, capService, desc)
				if evalErr != nil {
					resultsMu.Lock()
					failed[desc.GVR.String()] = evalErr
					resultsMu.Unlock()
					return evalErr
				}
				if !allowed {
					return nil
				}

				resultsMu.Lock()
				allowedIndices[index] = desc
				allowedSet[desc.GVR.String()] = desc
				resultsMu.Unlock()
			} else if _, ok := allowedSet[desc.GVR.String()]; !ok {
				return nil
			}

			summaries, err := s.collectResource(taskCtx, index, desc, nil, agg)
			if err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					return err
				}
				resultsMu.Lock()
				failed[desc.GVR.String()] = err
				resultsMu.Unlock()
				return err
			}
			if len(summaries) == 0 {
				s.logDebug(fmt.Sprintf("catalog collected 0 objects for %s", desc.GVR.String()))
			} else {
				s.logDebug(fmt.Sprintf("catalog collected %d object(s) for %s", len(summaries), desc.GVR.String()))
			}
			resultsMu.Lock()
			succeeded[desc.GVR.String()] = summaries
			resultsMu.Unlock()
			return nil
		})
	}

	runErr := parallel.RunLimited(ctx, s.opts.ListWorkers, tasks...)

	allowedDescriptors := make([]resourceDescriptor, 0, len(allowedIndices))
	for idx := 0; idx < len(descriptors); idx++ {
		if desc, ok := allowedIndices[idx]; ok {
			allowedDescriptors = append(allowedDescriptors, desc)
		}
	}
	descriptorCache := toDescriptorSlice(allowedDescriptors)
	if s.deps.Logger != nil {
		s.logInfo(fmt.Sprintf("catalog RBAC allowed %d/%d descriptor(s)", len(allowedDescriptors), len(descriptors)))
	}

	removeDisallowedEntries(newItems, newLastSeen, allowedSet)

	now := s.now()
	for gvr, summaries := range succeeded {
		desc := allowedSet[gvr]
		removeDescriptorEntries(newItems, newLastSeen, gvr)
		for _, summary := range summaries {
			key := catalogKey(desc, summary.Namespace, summary.Name)
			newItems[key] = summary
			newLastSeen[key] = now
		}
	}

	s.mu.Lock()
	for gvr, desc := range allowedSet {
		s.resources[gvr] = desc
	}
	s.mu.Unlock()

	failedCount := len(failed)
	var collectErr error
	if failedCount > 0 {
		failedKeys := make([]string, 0, failedCount)
		joined := make([]error, 0, failedCount)
		for gvr, failure := range failed {
			failedKeys = append(failedKeys, gvr)
			if failure != nil {
				joined = append(joined, fmt.Errorf("%s: %w", gvr, failure))
			}
		}
		sort.Strings(failedKeys)
		collectErr = &PartialSyncError{
			FailedDescriptors: failedKeys,
			Err:               errors.Join(joined...),
		}
		s.logWarn(fmt.Sprintf("catalog collection incomplete; retained previous data for %d descriptor(s)", failedCount))
	} else if runErr != nil && !errors.Is(runErr, context.Canceled) && !errors.Is(runErr, context.DeadlineExceeded) {
		collectErr = runErr
		s.logWarn(fmt.Sprintf("catalog collection failed: %v", runErr))
	}

	if failedCount > 0 {
		for gvr := range failed {
			restoreDescriptorEntries(newItems, newLastSeen, previousItems, previousLastSeen, gvr)
		}
		for key, summary := range previousItems {
			if _, exists := newItems[key]; !exists {
				newItems[key] = summary
				if ts, ok := previousLastSeen[key]; ok {
					newLastSeen[key] = ts
				}
			}
		}
	}

	if collectErr == nil {
		agg.finalize(descriptorCache, true)
		s.pruneMissing(newLastSeen)
	} else {
		agg.finalize(descriptorCache, false)
		s.rebuildCacheFromItems(newItems, descriptorCache)
		s.pruneMissing(newLastSeen)
	}

	elapsed := s.now().Sub(start)
	firstBatchLatency := agg.firstFlushLatency()
	s.setFirstBatchLatency(firstBatchLatency)
	if collectErr == nil {
		if firstBatchLatency > 0 {
			s.logDebug(fmt.Sprintf("catalog streaming first batch latency: %s", firstBatchLatency))
		}
		s.logInfo(fmt.Sprintf("catalog sync completed: %d objects, %d resources, took %s", len(newItems), len(allowedSet), elapsed))
		s.updateHealth(true, false, nil, 0)
	} else {
		s.updateHealth(false, failedCount > 0, collectErr, failedCount)
	}
	s.recordTelemetry(len(newItems), len(allowedSet), elapsed, collectErr)

	if collectErr != nil {
		return collectErr
	}
	return nil
}
