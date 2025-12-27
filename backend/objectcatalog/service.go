package objectcatalog

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	authorizationv1 "k8s.io/api/authorization/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	kruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	dynamicinformer "k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
)

const (
	defaultResyncInterval             = 1 * time.Minute
	defaultPageSize                   = 50
	defaultListWorkers                = 32
	defaultNamespaceWorkers           = 16
	defaultEvictionTTL                = 10 * time.Minute
	defaultInformerPromotionThreshold = 5000
	defaultStreamingBatchSize         = 100
	defaultStreamingFlushInterval     = 500 * time.Millisecond
	componentName                     = "ObjectCatalog"
	defaultQueryLimit                 = 200
	maxQueryLimit                     = 1000
	listRetryMaxAttempts              = 3
	listRetryInitialBackoff           = 200 * time.Millisecond
	listRetryMaxBackoff               = 2 * time.Second
	discoveryRequestTimeout           = 15 * time.Second
)

var errInformerNotSynced = errors.New("catalog informer cache not yet synced")

var streamingResourcePriority = map[string]int{
	"namespaces":                0,
	"nodes":                     5,
	"storageclasses":            10,
	"ingressclasses":            12,
	"clusterroles":              15,
	"clusterrolebindings":       16,
	"roles":                     18,
	"rolebindings":              19,
	"serviceaccounts":           20,
	"persistentvolumes":         22,
	"persistentvolumeclaims":    60,
	"resourcequotas":            55,
	"limitranges":               54,
	"services":                  25,
	"endpointslices":            26,
	"storageversions":           28,
	"customresourcedefinitions": 30,
	"deployments":               40,
	"statefulsets":              45,
	"daemonsets":                46,
	"replicasets":               47,
	"jobs":                      48,
	"cronjobs":                  49,
	"horizontalpodautoscalers":  35,
	"ingresses":                 36,
	"networkpolicies":           37,
	"configmaps":                65,
	"secrets":                   70,
	"pods":                      80,
	"events":                    95,
}

// Service orchestrates background ingestion of Kubernetes objects into a lightweight catalog.
type Service struct {
	deps Dependencies
	opts Options

	// cluster metadata is attached to summaries for stable keying.
	clusterID   string
	clusterName string

	mu        sync.RWMutex
	items     map[string]Summary
	lastSeen  map[string]time.Time
	resources map[string]resourceDescriptor
	// cached views to accelerate queries without per-request sorting/filter rebuilds
	sortedChunks          []*summaryChunk
	cachedKinds           []string
	cachedNamespaces      []string
	cachedDescriptors     []Descriptor
	cachesReady           bool
	lastFirstBatchLatency time.Duration

	promotedMu sync.RWMutex
	promoted   map[string]*promotedDescriptor

	healthMu sync.RWMutex
	health   healthStatus

	startOnce sync.Once
	doneCh    chan struct{}

	now func() time.Time

	streamSubMu       sync.Mutex
	streamSubscribers map[int]chan StreamingUpdate
	nextStreamSubID   int
}

type resourceDescriptor struct {
	GVR        schema.GroupVersionResource
	Namespaced bool
	Kind       string
	Group      string
	Version    string
	Resource   string
	Scope      Scope
}

type summaryChunk struct {
	items []Summary
}

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

// NewService constructs a catalog service with the provided dependencies and options.
func NewService(deps Dependencies, opts *Options) *Service {
	serviceOpts := Options{
		ResyncInterval:             defaultResyncInterval,
		PageSize:                   defaultPageSize,
		ListWorkers:                adjustedListWorkers(),
		NamespaceWorkers:           defaultNamespaceWorkers,
		InformerPromotionThreshold: defaultInformerPromotionThreshold,
		EvictionTTL:                defaultEvictionTTL,
		StreamingBatchSize:         defaultStreamingBatchSize,
		StreamingFlushInterval:     defaultStreamingFlushInterval,
	}
	if opts != nil {
		if opts.ResyncInterval > 0 {
			serviceOpts.ResyncInterval = opts.ResyncInterval
		}
		if opts.PageSize > 0 {
			serviceOpts.PageSize = opts.PageSize
		}
		if opts.ListWorkers > 0 {
			serviceOpts.ListWorkers = opts.ListWorkers
		}
		if opts.NamespaceWorkers > 0 {
			serviceOpts.NamespaceWorkers = opts.NamespaceWorkers
		}
		if opts.InformerPromotionThreshold > 0 {
			serviceOpts.InformerPromotionThreshold = opts.InformerPromotionThreshold
		}
		if opts.EvictionTTL > 0 {
			serviceOpts.EvictionTTL = opts.EvictionTTL
		}
		if opts.StreamingBatchSize > 0 {
			serviceOpts.StreamingBatchSize = opts.StreamingBatchSize
		}
		if opts.StreamingFlushInterval > 0 {
			serviceOpts.StreamingFlushInterval = opts.StreamingFlushInterval
		}
	}

	nowFn := deps.Now
	if nowFn == nil {
		nowFn = time.Now
	}

	return &Service{
		deps:              deps,
		opts:              serviceOpts,
		clusterID:         deps.ClusterID,
		clusterName:       deps.ClusterName,
		items:             make(map[string]Summary),
		lastSeen:          make(map[string]time.Time),
		resources:         make(map[string]resourceDescriptor),
		promoted:          make(map[string]*promotedDescriptor),
		health:            healthStatus{State: HealthStateUnknown},
		doneCh:            make(chan struct{}),
		now:               nowFn,
		streamSubscribers: make(map[int]chan StreamingUpdate),
	}
}

// Run starts the catalog ingestion loop and blocks until the context is cancelled.
func (s *Service) Run(ctx context.Context) error {
	var runErr error
	s.startOnce.Do(func() {
		if err := s.ensureDependencies(); err != nil {
			if s.deps.Telemetry != nil {
				s.deps.Telemetry.RecordCatalog(true, 0, 0, 0, err)
			}
			runErr = err
			close(s.doneCh)
			return
		}
		if s.deps.Logger != nil {
			s.deps.Logger.Info("Object catalog service starting", componentName)
		}
		runErr = s.runLoop(ctx)
	})
	return runErr
}

// Wait blocks until the service finishes running.
func (s *Service) Wait() {
	<-s.doneCh
}

// Snapshot returns a copy of the current catalog contents.
func (s *Service) Snapshot() []Summary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Summary, 0, len(s.items))
	for _, item := range s.items {
		result = append(result, item)
	}
	return result
}

// Count reports the number of catalogued objects.
func (s *Service) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.items)
}

// Descriptors returns the catalogued resource definitions discovered during the last sync.
func (s *Service) Descriptors() []Descriptor {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Descriptor, 0, len(s.resources))
	for _, desc := range s.resources {
		result = append(result, exportDescriptor(desc))
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Group != result[j].Group {
			return result[i].Group < result[j].Group
		}
		if result[i].Version != result[j].Version {
			return result[i].Version < result[j].Version
		}
		if result[i].Resource != result[j].Resource {
			return result[i].Resource < result[j].Resource
		}
		return result[i].Kind < result[j].Kind
	})
	return result
}

// Health returns the current health snapshot of the catalog service.
func (s *Service) Health() HealthStatus {
	s.healthMu.RLock()
	defer s.healthMu.RUnlock()
	return HealthStatus{
		Status:              s.health.State,
		ConsecutiveFailures: s.health.ConsecutiveFailures,
		LastSync:            s.health.LastSync,
		LastSuccess:         s.health.LastSuccess,
		LastError:           s.health.LastError,
		Stale:               s.health.Stale,
		FailedResources:     s.health.FailedResources,
	}
}

// Query filters catalog entries and returns a paginated result.
func (s *Service) Query(opts QueryOptions) QueryResult {
	kindMatcher := newKindMatcher(opts.Kinds)
	namespaceMatcher := newNamespaceMatcher(opts.Namespaces)
	searchMatcher := newSearchMatcher(opts.Search)
	hasNamespaceFilter := len(opts.Namespaces) > 0

	s.mu.RLock()
	chunks := make([]*summaryChunk, len(s.sortedChunks))
	copy(chunks, s.sortedChunks)
	cachedKinds := append([]string(nil), s.cachedKinds...)
	cachedNamespaces := append([]string(nil), s.cachedNamespaces...)
	cachedDescriptors := append([]Descriptor(nil), s.cachedDescriptors...)
	s.mu.RUnlock()

	if len(chunks) == 0 {
		return s.queryWithoutCache(opts, kindMatcher, namespaceMatcher, searchMatcher)
	}

	limit := clampQueryLimit(opts.Limit)
	start := 0
	if opts.Continue != "" {
		if parsed, err := strconv.Atoi(opts.Continue); err == nil && parsed >= 0 {
			start = parsed
		}
	}

	matches := make([]Summary, 0)
	matchKinds := make(map[string]struct{})
	matchNamespaces := make(map[string]struct{})
	// Scope the kinds list to namespace-filtered items when a namespace filter is active.
	namespaceKinds := make(map[string]struct{})
	totalMatches := 0

	for _, chunk := range chunks {
		if chunk == nil || len(chunk.items) == 0 {
			continue
		}
		for _, item := range chunk.items {
			if hasNamespaceFilter && namespaceMatcher(item.Namespace, item.Scope) {
				if item.Kind != "" {
					namespaceKinds[item.Kind] = struct{}{}
				}
			}
			if !kindMatcher(item.Kind, item.Group, item.Version, item.Resource) {
				continue
			}
			if !namespaceMatcher(item.Namespace, item.Scope) {
				continue
			}
			if !searchMatcher(item.Name, item.Namespace, item.Kind) {
				continue
			}

			totalMatches++
			matches = append(matches, item)
			if item.Kind != "" {
				matchKinds[item.Kind] = struct{}{}
			}
			matchNamespaces[item.Namespace] = struct{}{}
		}
	}

	if len(matches) > 1 {
		sortSummaries(matches)
	}

	end := start + limit
	if end > len(matches) {
		end = len(matches)
	}

	filtered := make([]Summary, 0, limit)
	if start < len(matches) {
		filtered = append(filtered, matches[start:end]...)
	}

	var next string
	if totalMatches > end {
		next = strconv.Itoa(end)
	}

	resourceCount := countMatchingDescriptors(cachedDescriptors, kindMatcher)

	kinds := cachedKinds
	if hasNamespaceFilter {
		if len(namespaceKinds) > 0 {
			kinds = snapshotSortedKeys(namespaceKinds)
		} else {
			kinds = []string{}
		}
	} else if len(kinds) == 0 && len(matchKinds) > 0 {
		kinds = snapshotSortedKeys(matchKinds)
	}

	namespaces := cachedNamespaces
	if len(namespaces) == 0 && len(matchNamespaces) > 0 {
		namespaces = snapshotSortedKeys(matchNamespaces)
	}

	return QueryResult{
		Items:         filtered,
		ContinueToken: next,
		TotalItems:    totalMatches,
		ResourceCount: resourceCount,
		Kinds:         kinds,
		Namespaces:    namespaces,
	}
}

func (s *Service) queryWithoutCache(
	opts QueryOptions,
	kindMatcher kindMatcher,
	namespaceMatcher namespaceMatcher,
	searchMatcher searchMatcher,
) QueryResult {
	items := s.Snapshot()
	descriptors := s.Descriptors()

	kindSet := make(map[string]struct{})
	namespaceSet := make(map[string]struct{})
	// Scope the kinds list to namespace-filtered items when a namespace filter is active.
	namespaceKinds := make(map[string]struct{})
	hasNamespaceFilter := len(opts.Namespaces) > 0
	for _, item := range items {
		if item.Kind != "" {
			kindSet[item.Kind] = struct{}{}
		}
		if item.Namespace != "" {
			namespaceSet[item.Namespace] = struct{}{}
		}
		if hasNamespaceFilter && namespaceMatcher(item.Namespace, item.Scope) {
			if item.Kind != "" {
				namespaceKinds[item.Kind] = struct{}{}
			}
		}
	}

	filtered := make([]Summary, 0, len(items))
	for _, item := range items {
		if !kindMatcher(item.Kind, item.Group, item.Version, item.Resource) {
			continue
		}
		if !namespaceMatcher(item.Namespace, item.Scope) {
			continue
		}
		if !searchMatcher(item.Name, item.Namespace, item.Kind) {
			continue
		}
		filtered = append(filtered, item)
	}

	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].Kind != filtered[j].Kind {
			return filtered[i].Kind < filtered[j].Kind
		}
		if filtered[i].Namespace != filtered[j].Namespace {
			return filtered[i].Namespace < filtered[j].Namespace
		}
		return filtered[i].Name < filtered[j].Name
	})

	total := len(filtered)
	limit := clampQueryLimit(opts.Limit)
	start := parseContinueToken(opts.Continue, total)
	end := start + limit
	if end > total {
		end = total
	}

	page := make([]Summary, end-start)
	copy(page, filtered[start:end])

	var next string
	if end < total {
		next = strconv.Itoa(end)
	}

	resourceCount := countMatchingDescriptors(descriptors, kindMatcher)

	kindSource := kindSet
	if hasNamespaceFilter {
		kindSource = namespaceKinds
	}
	kinds := make([]string, 0, len(kindSource))
	for kind := range kindSource {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)

	namespaces := make([]string, 0, len(namespaceSet))
	for ns := range namespaceSet {
		namespaces = append(namespaces, ns)
	}
	sort.Strings(namespaces)

	return QueryResult{
		Items:         page,
		ContinueToken: next,
		TotalItems:    total,
		ResourceCount: resourceCount,
		Kinds:         kinds,
		Namespaces:    namespaces,
	}
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

func (s *Service) discoverResources(ctx context.Context) ([]resourceDescriptor, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	discoveryClient := s.deps.Common.KubernetesClient.Discovery()
	if cfg := s.deps.Common.RestConfig; cfg != nil {
		cfgCopy := rest.CopyConfig(cfg)
		cfgCopy.Timeout = discoveryRequestTimeout
		if dc, err := discovery.NewDiscoveryClientForConfig(cfgCopy); err == nil {
			discoveryClient = dc
		} else if s.deps.Logger != nil {
			s.logDebug(fmt.Sprintf("catalog discovery client fallback: %v", err))
		}
	}
	if discoveryClient == nil {
		return nil, errors.New("discovery client not available")
	}

	resourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && len(resourceLists) == 0 {
		return nil, err
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	return s.extractDescriptors(resourceLists), nil
}

func (s *Service) extractDescriptors(resourceLists []*metav1.APIResourceList) []resourceDescriptor {
	exported := ExtractDescriptors(resourceLists)
	result := make([]resourceDescriptor, 0, len(exported))
	for _, desc := range exported {
		r := resourceDescriptor{
			GVR: schema.GroupVersionResource{
				Group:    desc.Group,
				Version:  desc.Version,
				Resource: desc.Resource,
			},
			Namespaced: desc.Namespaced,
			Kind:       desc.Kind,
			Group:      desc.Group,
			Version:    desc.Version,
			Resource:   desc.Resource,
			Scope:      desc.Scope,
		}
		result = append(result, r)
	}
	return result
}
func (s *Service) collectResource(ctx context.Context, index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, error) {
	if summaries, handled, err := s.collectViaSharedInformer(index, desc, namespaces, agg); handled {
		return summaries, err
	}
	if promoted := s.getPromotedDescriptor(desc.GVR.String()); promoted != nil {
		if summaries, err := s.collectFromInformer(index, desc, promoted, agg); err == nil {
			return summaries, nil
		} else if !errors.Is(err, errInformerNotSynced) {
			s.logWarn(fmt.Sprintf("catalog informer for %s unavailable (%v); falling back to list", desc.GVR.String(), err))
		}
	}

	summaries, err := s.listResource(ctx, index, desc, namespaces, agg)
	if err != nil {
		return nil, err
	}
	s.maybePromote(ctx, desc, len(summaries))
	return summaries, nil
}

func (s *Service) collectViaSharedInformer(index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, bool, error) {
	factory := s.deps.InformerFactory
	if factory == nil {
		return emitSummaries(index, agg, nil, nil, false)
	}

	gr := desc.GVR.GroupResource()
	switch gr {
	case schema.GroupResource{Group: "", Resource: "pods"}:
		lister := factory.Core().V1().Pods().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				pods, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(pods), nil
			}
			pods, err := lister.Pods(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(pods), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "apps", Resource: "deployments"}:
		lister := factory.Apps().V1().Deployments().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.Deployments(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "apps", Resource: "statefulsets"}:
		lister := factory.Apps().V1().StatefulSets().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.StatefulSets(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "apps", Resource: "daemonsets"}:
		lister := factory.Apps().V1().DaemonSets().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.DaemonSets(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "apps", Resource: "replicasets"}:
		lister := factory.Apps().V1().ReplicaSets().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.ReplicaSets(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "batch", Resource: "jobs"}:
		lister := factory.Batch().V1().Jobs().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.Jobs(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "batch", Resource: "cronjobs"}:
		lister := factory.Batch().V1().CronJobs().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.CronJobs(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "", Resource: "services"}:
		lister := factory.Core().V1().Services().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.Services(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "", Resource: "endpoints"}:
		if agg != nil {
			agg.complete(index)
		}
		return nil, true, nil
	case schema.GroupResource{Group: "discovery.k8s.io", Resource: "endpointslices"}:
		lister := factory.Discovery().V1().EndpointSlices().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.EndpointSlices(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "", Resource: "configmaps"}:
		lister := factory.Core().V1().ConfigMaps().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.ConfigMaps(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "", Resource: "secrets"}:
		lister := factory.Core().V1().Secrets().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.Secrets(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "", Resource: "persistentvolumeclaims"}:
		lister := factory.Core().V1().PersistentVolumeClaims().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.PersistentVolumeClaims(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "", Resource: "resourcequotas"}:
		lister := factory.Core().V1().ResourceQuotas().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.ResourceQuotas(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "", Resource: "limitranges"}:
		lister := factory.Core().V1().LimitRanges().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.LimitRanges(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "networking.k8s.io", Resource: "ingresses"}:
		lister := factory.Networking().V1().Ingresses().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.Ingresses(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "networking.k8s.io", Resource: "networkpolicies"}:
		lister := factory.Networking().V1().NetworkPolicies().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.NetworkPolicies(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "autoscaling", Resource: "horizontalpodautoscalers"}:
		lister := factory.Autoscaling().V1().HorizontalPodAutoscalers().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.HorizontalPodAutoscalers(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "rbac.authorization.k8s.io", Resource: "clusterroles"}:
		lister := factory.Rbac().V1().ClusterRoles().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	case schema.GroupResource{Group: "rbac.authorization.k8s.io", Resource: "clusterrolebindings"}:
		lister := factory.Rbac().V1().ClusterRoleBindings().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	case schema.GroupResource{Group: "rbac.authorization.k8s.io", Resource: "roles"}:
		lister := factory.Rbac().V1().Roles().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.Roles(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "rbac.authorization.k8s.io", Resource: "rolebindings"}:
		lister := factory.Rbac().V1().RoleBindings().Lister()
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, func(ns string) ([]metav1.Object, error) {
			if ns == "" || ns == metav1.NamespaceAll {
				items, err := lister.List(labels.Everything())
				if err != nil {
					return nil, err
				}
				return toMetaObjects(items), nil
			}
			items, err := lister.RoleBindings(ns).List(labels.Everything())
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		})
		return emitSummaries(index, agg, summaries, err, true)
	case schema.GroupResource{Group: "", Resource: "namespaces"}:
		lister := factory.Core().V1().Namespaces().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	case schema.GroupResource{Group: "", Resource: "nodes"}:
		lister := factory.Core().V1().Nodes().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	case schema.GroupResource{Group: "", Resource: "persistentvolumes"}:
		lister := factory.Core().V1().PersistentVolumes().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	case schema.GroupResource{Group: "storage.k8s.io", Resource: "storageclasses"}:
		lister := factory.Storage().V1().StorageClasses().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	case schema.GroupResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}:
		if s.deps.APIExtensionsInformerFactory == nil {
			return emitSummaries(index, agg, nil, nil, false)
		}
		lister := s.deps.APIExtensionsInformerFactory.Apiextensions().V1().CustomResourceDefinitions().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	}

	return emitSummaries(index, agg, nil, nil, false)
}

func (s *Service) collectFromNamespacedLister(desc resourceDescriptor, namespaces []string, list func(namespace string) ([]metav1.Object, error)) ([]Summary, error) {
	targets := listTargets(desc, namespaces)
	summaries := make([]Summary, 0)
	for _, ns := range targets {
		objects, err := list(ns)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, s.summariesFromObjects(desc, objects)...)
	}
	return summaries, nil
}

func (s *Service) summariesFromObjects(desc resourceDescriptor, objs []metav1.Object) []Summary {
	if len(objs) == 0 {
		return nil
	}
	result := make([]Summary, 0, len(objs))
	for _, obj := range objs {
		if obj == nil {
			continue
		}
		result = append(result, s.buildSummary(desc, obj))
	}
	return result
}

func (s *Service) listResource(ctx context.Context, index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, error) {
	dynamicClient := s.deps.Common.DynamicClient
	if dynamicClient == nil {
		return nil, errors.New("dynamic client not available")
	}

	namespaceable := dynamicClient.Resource(desc.GVR)
	var targets []string
	if desc.Namespaced && len(namespaces) > 0 {
		targets = uniqueNamespaces(namespaces)
		if len(targets) == 0 {
			if agg != nil {
				agg.complete(index)
			}
			return nil, nil
		}
	} else if desc.Namespaced {
		targets = []string{metav1.NamespaceAll}
	} else {
		targets = []string{""}
	}

	if len(targets) == 0 {
		if agg != nil {
			agg.complete(index)
		}
		return nil, nil
	}

	if desc.Namespaced && len(targets) > 1 && s.namespaceWorkerLimit(len(targets)) > 1 {
		return s.listResourceNamespacedParallel(ctx, index, namespaceable, desc, targets, agg)
	}

	return s.listResourceSequential(ctx, index, namespaceable, desc, targets, agg)
}

func (s *Service) listResourceSequential(ctx context.Context, index int, namespaceable dynamic.NamespaceableResourceInterface, desc resourceDescriptor, targets []string, agg *streamingAggregator) ([]Summary, error) {
	results := make([]Summary, 0)
	for _, target := range targets {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		resourceInterface := resourceInterfaceForTarget(namespaceable, desc.Namespaced, target)
		items, err := s.listNamespaceItems(ctx, index, desc, resourceInterface, agg)
		if err != nil {
			return nil, err
		}
		if len(items) > 0 {
			results = append(results, items...)
		}
	}
	if len(results) == 0 && agg != nil {
		agg.complete(index)
	}
	return results, nil
}

func (s *Service) listResourceNamespacedParallel(ctx context.Context, index int, namespaceable dynamic.NamespaceableResourceInterface, desc resourceDescriptor, targets []string, agg *streamingAggregator) ([]Summary, error) {
	results := make([]Summary, 0)
	var mu sync.Mutex
	limit := s.namespaceWorkerLimit(len(targets))
	err := parallel.ForEach(ctx, targets, limit, func(taskCtx context.Context, target string) error {
		resourceInterface := resourceInterfaceForTarget(namespaceable, true, target)
		items, err := s.listNamespaceItems(taskCtx, index, desc, resourceInterface, agg)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		mu.Lock()
		results = append(results, items...)
		mu.Unlock()
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(results) == 0 && agg != nil {
		agg.complete(index)
	}
	return results, nil
}

func (s *Service) listNamespaceItems(ctx context.Context, index int, desc resourceDescriptor, resourceInterface dynamic.ResourceInterface, agg *streamingAggregator) ([]Summary, error) {
	batchSize := s.opts.PageSize
	if s.opts.StreamingBatchSize > 0 && s.opts.StreamingBatchSize < batchSize {
		batchSize = s.opts.StreamingBatchSize
	}
	options := metav1.ListOptions{Limit: int64(batchSize)}
	results := make([]Summary, 0)
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		var list *unstructuredv1.UnstructuredList
		var err error
		for attempt := 0; attempt < listRetryMaxAttempts; attempt++ {
			list, err = resourceInterface.List(ctx, options)
			if err == nil {
				break
			}
			if apierrors.IsForbidden(err) {
				s.logDebug(fmt.Sprintf("permission denied listing %s, skipping", desc.GVR.String()))
				return results, nil
			}
			if !shouldRetryList(err) || attempt == listRetryMaxAttempts-1 {
				return nil, err
			}
			delay := listRetryBackoff(attempt)
			s.logDebug(fmt.Sprintf("retrying list for %s after error: %v (backoff=%s)", desc.GVR.String(), err, delay))
			if err := timeutil.SleepWithContext(ctx, delay); err != nil {
				return nil, err
			}
		}
		if list == nil {
			return results, nil
		}

		page := make([]Summary, 0, len(list.Items))
		for i := range list.Items {
			item := &list.Items[i]
			page = append(page, s.buildSummary(desc, item))
		}
		if len(page) > 0 {
			results = append(results, page...)
			if agg != nil {
				agg.emit(index, page)
			}
		}

		cont := list.GetContinue()
		if cont == "" {
			break
		}
		options.Continue = cont
	}
	return results, nil
}

func (s *Service) namespaceWorkerLimit(targetCount int) int {
	if targetCount <= 1 {
		return 1
	}
	limit := s.opts.NamespaceWorkers
	if limit <= 0 || limit > targetCount {
		limit = targetCount
	}
	if limit < 1 {
		return 1
	}
	return limit
}

func (s *Service) maybePromote(ctx context.Context, desc resourceDescriptor, itemCount int) {
	if s.opts.InformerPromotionThreshold <= 0 {
		return
	}
	if itemCount < s.opts.InformerPromotionThreshold {
		return
	}
	if s.deps.Common.DynamicClient == nil {
		return
	}
	key := desc.GVR.String()
	if s.getPromotedDescriptor(key) != nil {
		return
	}

	genericInformer := dynamicinformer.NewFilteredDynamicInformer(
		s.deps.Common.DynamicClient,
		desc.GVR,
		metav1.NamespaceAll,
		0,
		cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc},
		nil,
	)
	informer := genericInformer.Informer()
	stopCh := make(chan struct{})
	promoted := &promotedDescriptor{informer: informer, stopCh: stopCh}

	s.promotedMu.Lock()
	if _, exists := s.promoted[key]; exists {
		s.promotedMu.Unlock()
		promoted.stop()
		return
	}
	s.promoted[key] = promoted
	s.promotedMu.Unlock()

	go informer.Run(stopCh)
	if !cache.WaitForCacheSync(ctx.Done(), informer.HasSynced) {
		s.logWarn(fmt.Sprintf("catalog informer promotion failed to sync for %s", key))
		promoted.stop()
		s.promotedMu.Lock()
		delete(s.promoted, key)
		s.promotedMu.Unlock()
		return
	}
	s.logInfo(fmt.Sprintf("catalog descriptor %s promoted to informer", key))
}

func (s *Service) collectFromInformer(index int, desc resourceDescriptor, promoted *promotedDescriptor, agg *streamingAggregator) ([]Summary, error) {
	if promoted == nil {
		return nil, errors.New("no informer")
	}
	if !promoted.informer.HasSynced() {
		return nil, errInformerNotSynced
	}
	objects := promoted.informer.GetStore().List()
	results := make([]Summary, 0, len(objects))
	for _, obj := range objects {
		runtimeObj, ok := obj.(kruntime.Object)
		if !ok {
			continue
		}
		accessor, err := meta.Accessor(runtimeObj)
		if err != nil {
			continue
		}
		unstructuredObj := &unstructuredv1.Unstructured{}
		if u, ok := runtimeObj.(*unstructuredv1.Unstructured); ok {
			unstructuredObj = u
		} else {
			unstructuredObj.SetNamespace(accessor.GetNamespace())
			unstructuredObj.SetName(accessor.GetName())
			unstructuredObj.SetUID(accessor.GetUID())
			unstructuredObj.SetResourceVersion(accessor.GetResourceVersion())
			unstructuredObj.SetCreationTimestamp(accessor.GetCreationTimestamp())
			unstructuredObj.SetGroupVersionKind(schema.GroupVersionKind{
				Group:   desc.Group,
				Version: desc.Version,
				Kind:    desc.Kind,
			})
		}
		results = append(results, s.buildSummary(desc, unstructuredObj))
	}
	if agg != nil && len(results) > 0 {
		agg.emit(index, results)
	}
	if agg != nil && len(results) == 0 {
		agg.complete(index)
	}
	return results, nil
}

func (s *Service) getPromotedDescriptor(key string) *promotedDescriptor {
	s.promotedMu.RLock()
	defer s.promotedMu.RUnlock()
	return s.promoted[key]
}

func (s *Service) stopPromotedInformers() {
	s.promotedMu.Lock()
	defer s.promotedMu.Unlock()
	for key, promoted := range s.promoted {
		if promoted != nil {
			promoted.stop()
		}
		delete(s.promoted, key)
	}
}

type kindMatcher func(kind, group, version, resource string) bool

func newKindMatcher(filters []string) kindMatcher {
	if len(filters) == 0 {
		return func(string, string, string, string) bool { return true }
	}
	normalized := make(map[string]struct{})
	for _, filter := range filters {
		value := strings.TrimSpace(filter)
		if value == "" {
			continue
		}
		normalized[strings.ToLower(value)] = struct{}{}
	}
	if len(normalized) == 0 {
		return func(string, string, string, string) bool { return true }
	}
	return func(kind, group, version, resource string) bool {
		candidates := []string{
			strings.ToLower(kind),
			strings.ToLower(group + "/" + kind),
			strings.ToLower(resource),
			strings.ToLower(group + "/" + resource),
			strings.ToLower(group + "/" + version + "/" + resource),
		}
		for _, candidate := range candidates {
			if _, ok := normalized[candidate]; ok {
				return true
			}
		}
		return false
	}
}

type namespaceMatcher func(namespace string, scope Scope) bool

func newNamespaceMatcher(filters []string) namespaceMatcher {
	if len(filters) == 0 {
		return func(string, Scope) bool { return true }
	}

	namespaces := make(map[string]struct{})
	clusterRequested := false

	for _, filter := range filters {
		value := strings.TrimSpace(filter)
		if value == "" {
			clusterRequested = true
			continue
		}
		if strings.EqualFold(value, "cluster") {
			clusterRequested = true
			continue
		}
		namespaces[strings.ToLower(value)] = struct{}{}
	}

	if !clusterRequested && len(namespaces) == 0 {
		return func(string, Scope) bool { return true }
	}

	return func(namespace string, scope Scope) bool {
		if scope == ScopeCluster {
			return clusterRequested || len(namespaces) == 0
		}
		if len(namespaces) == 0 {
			// Only cluster-scoped objects were requested.
			return false
		}
		_, ok := namespaces[strings.ToLower(namespace)]
		return ok
	}
}

type searchMatcher func(name, namespace, kind string) bool

func newSearchMatcher(term string) searchMatcher {
	value := strings.ToLower(strings.TrimSpace(term))
	if value == "" {
		return func(string, string, string) bool { return true }
	}
	return func(name, namespace, kind string) bool {
		if strings.Contains(strings.ToLower(name), value) {
			return true
		}
		if namespace != "" && strings.Contains(strings.ToLower(namespace), value) {
			return true
		}
		if strings.Contains(strings.ToLower(kind), value) {
			return true
		}
		return false
	}
}

func (s *Service) buildSummary(desc resourceDescriptor, item metav1.Object) Summary {
	creationTimestamp := ""
	if ts := item.GetCreationTimestamp(); !ts.IsZero() {
		creationTimestamp = ts.UTC().Format(time.RFC3339)
	}

	summary := Summary{
		ClusterID:         s.clusterID,
		ClusterName:       s.clusterName,
		Kind:              desc.Kind,
		Group:             desc.Group,
		Version:           desc.Version,
		Resource:          desc.Resource,
		Namespace:         item.GetNamespace(),
		Name:              item.GetName(),
		UID:               string(item.GetUID()),
		ResourceVersion:   item.GetResourceVersion(),
		CreationTimestamp: creationTimestamp,
		Scope:             desc.Scope,
	}

	if digest := labelsDigest(item.GetLabels()); digest != "" {
		summary.LabelsDigest = digest
	}

	return summary
}

func (s *Service) pruneMissing(seen map[string]time.Time) {
	if s.opts.EvictionTTL <= 0 {
		return
	}

	expiry := s.now().Add(-s.opts.EvictionTTL)
	for key, last := range seen {
		if last.Before(expiry) {
			delete(seen, key)
		}
	}
}

func (s *Service) logInfo(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Info(msg, componentName)
	}
}

func (s *Service) logWarn(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Warn(msg, componentName)
	}
}

func (s *Service) logDebug(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Debug(msg, componentName)
	}
}

func (s *Service) recordTelemetry(itemCount, resourceCount int, duration time.Duration, err error) {
	if s.deps.Telemetry != nil {
		s.deps.Telemetry.RecordCatalog(true, itemCount, resourceCount, duration, err)
	}
}

func (s *Service) rebuildCacheFromItems(items map[string]Summary, descriptors []Descriptor) {
	kindSet := make(map[string]struct{})
	namespaceSet := make(map[string]struct{})
	chunks := make([]*summaryChunk, 0, 1)

	if len(items) > 0 {
		summaries := make([]Summary, 0, len(items))
		for _, summary := range items {
			summaries = append(summaries, summary)
			if summary.Kind != "" {
				kindSet[summary.Kind] = struct{}{}
			}
			if summary.Namespace != "" {
				namespaceSet[summary.Namespace] = struct{}{}
			}
		}
		sort.Slice(summaries, func(i, j int) bool {
			if summaries[i].Kind != summaries[j].Kind {
				return summaries[i].Kind < summaries[j].Kind
			}
			if summaries[i].Namespace != summaries[j].Namespace {
				return summaries[i].Namespace < summaries[j].Namespace
			}
			return summaries[i].Name < summaries[j].Name
		})
		chunkCopy := make([]Summary, len(summaries))
		copy(chunkCopy, summaries)
		chunks = append(chunks, &summaryChunk{items: chunkCopy})
	}

	s.publishStreamingState(chunks, kindSet, namespaceSet, descriptors, true)
}

func (s *Service) captureCurrentState() (map[string]Summary, map[string]time.Time, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.items, s.lastSeen, len(s.resources)
}

type healthStatus struct {
	State               HealthState
	ConsecutiveFailures int
	LastSync            time.Time
	LastSuccess         time.Time
	LastError           string
	Stale               bool
	FailedResources     int
}

func (s *Service) updateHealth(success bool, stale bool, err error, failedCount int) {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()

	now := s.now()
	s.health.LastSync = now
	if success {
		s.health.State = HealthStateOK
		s.health.ConsecutiveFailures = 0
		s.health.LastError = ""
		s.health.Stale = false
		s.health.FailedResources = 0
		s.health.LastSuccess = now
		return
	}

	s.health.ConsecutiveFailures++
	s.health.FailedResources = failedCount
	s.health.Stale = true
	if stale || failedCount > 0 {
		s.health.State = HealthStateDegraded
	} else {
		s.health.State = HealthStateError
	}
	if err != nil {
		s.health.LastError = err.Error()
	}
}

type promotedDescriptor struct {
	informer cache.SharedIndexInformer
	stopCh   chan struct{}
	stopOnce sync.Once
}

func (p *promotedDescriptor) stop() {
	if p == nil {
		return
	}
	p.stopOnce.Do(func() {
		close(p.stopCh)
	})
}
