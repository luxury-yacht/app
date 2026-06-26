/*
 * backend/refresh/snapshot/service.go
 *
 * Coordinates refresh-domain snapshot builds, permission checks, caching, and
 * cluster metadata injection for the snapshot subsystem.
 */

package snapshot

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Service builds snapshots through registered domain builders and applies short-lived caching via singleflight.
type Service struct {
	registry            *domain.Registry
	telemetry           *telemetry.Recorder
	group               singleflight.Group
	sequence            uint64
	cluster             ClusterMeta
	informerHubMu       sync.RWMutex
	informerHub         refresh.InformerHub
	domainReadiness     map[string][]string
	informerSyncTimeout time.Duration
	cacheMu             sync.RWMutex
	cache               map[string]cacheEntry
	cacheTTL            time.Duration
	epoch               string
	permissionChecker   *permissions.Checker
	runtimeAccess       domainpermissions.RuntimeAccess
	requestSerial       uint64
}

// errInformerSyncTimeout marks snapshot builds rejected because the refresh
// informer caches never reported synced within the configured deadline — for
// example when one informer's watch is RBAC-forbidden and can never complete.
var errInformerSyncTimeout = errors.New("refresh informer caches not synced")

type cacheEntry struct {
	snapshot  *refresh.Snapshot
	expiresAt time.Time
}

var sourceVersionEpochSerial uint64

type BuildRequest struct {
	Context context.Context
	Domain  string
	Scope   string
	Cluster ClusterMeta
}

// NewService returns a Service for the provided registry.
func NewService(reg *domain.Registry, recorder *telemetry.Recorder, meta ClusterMeta) *Service {
	return newService(reg, recorder, meta, nil, domainpermissions.RuntimeAccess{})
}

// NewServiceWithPermissions returns a Service that validates runtime permissions per snapshot request.
func NewServiceWithPermissions(
	reg *domain.Registry,
	recorder *telemetry.Recorder,
	meta ClusterMeta,
	checker *permissions.Checker,
) *Service {
	return newService(reg, recorder, meta, checker, domainpermissions.RuntimeAccess{})
}

func newService(
	reg *domain.Registry,
	recorder *telemetry.Recorder,
	meta ClusterMeta,
	checker *permissions.Checker,
	access domainpermissions.RuntimeAccess,
) *Service {
	if checker != nil && access.IsEmpty() {
		access = domainpermissions.NewRuntimeAccess()
	}
	return &Service{
		registry:            reg,
		telemetry:           recorder,
		cluster:             meta,
		cache:               make(map[string]cacheEntry),
		cacheTTL:            config.SnapshotCacheTTL,
		epoch:               newSourceVersionEpoch(meta),
		informerSyncTimeout: config.RefreshInformerSyncTimeout,
		permissionChecker:   checker,
		runtimeAccess:       access,
	}
}

// WithInformerHub makes snapshot builds wait until the refresh informer caches
// are synced. Without this guard, early table requests can cache empty lister
// results before the first authoritative Kubernetes list has completed.
func (s *Service) WithInformerHub(hub refresh.InformerHub) *Service {
	if s == nil {
		return s
	}
	s.SetInformerHub(hub)
	return s
}

// SetInformerHub swaps the sync-gate hub at runtime. The governor's Cold-tier serving
// transition uses it: after a cooled cluster's manager + informer factory are shut down, the
// original hub's HasSynced reports false (factory.Shutdown clears its synced flag), which would
// block every cooled Build until timeout. A cooled cluster's data is frozen and resident in
// its mmap-backed stores, so its readiness gate must report settled immediately — the cool path
// installs an always-synced hub here. Guarded so it never races an in-flight Build's hub read.
func (s *Service) SetInformerHub(hub refresh.InformerHub) {
	if s == nil {
		return
	}
	s.informerHubMu.Lock()
	s.informerHub = hub
	s.informerHubMu.Unlock()
}

// currentInformerHub reads the live hub under the lock, so a runtime swap (SetInformerHub)
// is visible to an in-flight Build's poll loop without racing.
func (s *Service) currentInformerHub() refresh.InformerHub {
	s.informerHubMu.RLock()
	defer s.informerHubMu.RUnlock()
	return s.informerHub
}

// WithDomainReadiness narrows the informer sync gate per domain: a declared
// domain waits only on its own resources' informers (canonical
// permissions.ResourceKey format), so one slow watch no longer delays every
// other domain's first snapshot. Domains absent from the map keep the
// conservative factory-wide gate.
func (s *Service) WithDomainReadiness(readiness map[string][]string) *Service {
	if s == nil {
		return s
	}
	s.domainReadiness = readiness
	return s
}

// Build returns a snapshot for the requested domain/scope.
func (s *Service) Build(ctx context.Context, domainName, scope string) (*refresh.Snapshot, error) {
	return s.BuildRequest(BuildRequest{
		Context: ctx,
		Domain:  domainName,
		Scope:   scope,
		Cluster: s.cluster,
	})
}

func (s *Service) BuildRequest(req BuildRequest) (*refresh.Snapshot, error) {
	if err := req.Cluster.Validate(); err != nil {
		return nil, err
	}
	ctx := WithClusterMeta(req.Context, req.Cluster)
	domainName := req.Domain
	scope := req.Scope
	permissionCacheKey := ""
	var err error
	ctx, permissionCacheKey, err = s.ensurePermissions(ctx, domainName, scope)
	if err != nil {
		return nil, err
	}
	if err := s.waitForInformerSync(ctx, domainName); err != nil {
		if errors.Is(err, errInformerSyncTimeout) {
			s.recordTelemetry(domainName, scope, 0, err, false, 0, nil, 0, 0, 0, true, 0)
		}
		return nil, err
	}
	cacheKey := s.cacheKey(domainName, scope)
	if permissionCacheKey != "" {
		cacheKey += ":permissions:" + permissionCacheKey
	}
	groupKey := cacheKey
	if refresh.HasCacheBypass(ctx) {
		// Keep cache-bypass builds isolated from cached singleflight requests.
		groupKey = cacheKey + ":bypass"
	}
	if s.shouldBypassSingleflight(domainName) {
		groupKey = fmt.Sprintf("%s:live:%d", cacheKey, atomic.AddUint64(&s.requestSerial, 1))
	}
	bypassSnapshotCache := s.shouldBypassSnapshotCache(domainName)
	if !refresh.HasCacheBypass(ctx) && !bypassSnapshotCache {
		if cached := s.loadCache(cacheKey); cached != nil {
			return cached, nil
		}
	}
	value, err, _ := s.group.Do(groupKey, func() (interface{}, error) {
		if !refresh.HasCacheBypass(ctx) && !bypassSnapshotCache {
			if cached := s.loadCache(cacheKey); cached != nil {
				return cached, nil
			}
		}
		start := time.Now()
		snap, buildErr := s.registry.Build(ctx, domainName, scope)
		duration := time.Since(start)
		if buildErr != nil {
			s.recordTelemetry(
				domainName,
				scope,
				duration,
				buildErr,
				false,
				0,
				nil,
				0,
				0,
				0,
				true,
				duration.Milliseconds(),
			)
			return nil, buildErr
		}
		snap.GeneratedAt = time.Now().UnixMilli()
		snap.Sequence = atomic.AddUint64(&s.sequence, 1)
		snap.Stats.BuildDurationMs = duration.Milliseconds()
		snap.Stats.BuildStartedAtUnix = start.UnixMilli()
		if snap.Stats.BatchIndex == 0 && snap.Stats.TimeToFirstRowMs == 0 {
			snap.Stats.TimeToFirstRowMs = duration.Milliseconds()
		}
		if snap.Payload != nil {
			if data, marshalErr := json.Marshal(snap.Payload); marshalErr == nil {
				snap.Checksum = checksumBytes(data)
			}
		}
		s.finalizeSourceVersion(snap)
		s.recordTelemetry(
			domainName,
			scope,
			duration,
			nil,
			snap.Stats.Truncated,
			snap.Stats.TotalItems,
			snap.Stats.Warnings,
			snap.Stats.BatchIndex,
			snap.Stats.TotalBatches,
			snap.Stats.BatchSize,
			snap.Stats.IsFinalBatch,
			snap.Stats.TimeToFirstRowMs,
		)
		s.storeCache(cacheKey, snap)
		return snap, nil
	})
	if err != nil {
		return nil, err
	}
	return value.(*refresh.Snapshot), nil
}

func (s *Service) waitForInformerSync(ctx context.Context, domainName string) error {
	if s == nil {
		return nil
	}
	if s.currentInformerHub() == nil {
		return nil
	}
	// A domain with declared readiness resources waits only on those informers;
	// undeclared domains keep the conservative factory-wide gate. The hub is re-read
	// on every poll, not captured once, so a runtime swap (the Cold-tier cooled-hub
	// install) is observed by an already-blocked Build.
	keys, scoped := s.domainReadiness[domainName]
	settled := func() bool {
		hub := s.currentInformerHub()
		if hub == nil {
			return true
		}
		if scoped {
			return hub.ResourcesSettled(keys)
		}
		return hub.HasSynced(ctx)
	}
	if settled() {
		return nil
	}
	timeout := s.informerSyncTimeout
	if timeout <= 0 {
		timeout = config.RefreshInformerSyncTimeout
	}
	// Bound the wait: a single informer whose watch can never complete (for
	// example an RBAC-forbidden resource) keeps the sync gate closed forever,
	// and the caller's context may carry no deadline.
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(config.RefreshInformerSyncPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("refresh informer caches not synced: %w", ctx.Err())
		case <-deadline.C:
			return fmt.Errorf("%w after %s; the cluster API may be unreachable or a watch may be unauthorized", errInformerSyncTimeout, timeout)
		case <-ticker.C:
			if settled() {
				return nil
			}
		}
	}
}

// ensurePermissions blocks snapshot builds when the current identity no longer has list access.
// Permission-denied placeholder domains are skipped — their BuildSnapshot stub already
// returns the correct PermissionDeniedError, so firing SSAR calls is redundant.
func (s *Service) ensurePermissions(ctx context.Context, domainName, scope string) (context.Context, string, error) {
	if s == nil || s.permissionChecker == nil {
		return ctx, "", nil
	}
	// Skip SSAR checks for domains already registered as permission-denied placeholders.
	// The domain's BuildSnapshot will return a PermissionDeniedError on its own.
	if s.registry != nil && s.registry.IsPermissionDenied(domainName) {
		return ctx, "", nil
	}
	start := time.Now()
	decision, err := s.runtimeAccess.Check(ctx, domainName, s.permissionChecker)
	permissionCacheKey := domainpermissions.AllowedResourcesFingerprint(decision.AllowedResources)
	if len(decision.AllowedResources) > 0 {
		ctx = domainpermissions.WithAllowedResources(ctx, domainName, decision.AllowedResources)
	}
	if err != nil {
		duration := time.Since(start)
		s.recordTelemetry(
			domainName,
			scope,
			duration,
			err,
			false,
			0,
			nil,
			0,
			0,
			0,
			true,
			duration.Milliseconds(),
		)
		return ctx, permissionCacheKey, err
	}
	if decision.Allowed {
		return ctx, permissionCacheKey, nil
	}
	denied := refresh.NewPermissionDeniedError(domainName, decision.DeniedReason)
	duration := time.Since(start)
	s.recordTelemetry(
		domainName,
		scope,
		duration,
		denied,
		false,
		0,
		nil,
		0,
		0,
		0,
		true,
		duration.Milliseconds(),
	)
	return ctx, permissionCacheKey, denied
}

func (s *Service) recordTelemetry(
	domain string,
	scope string,
	duration time.Duration,
	err error,
	truncated bool,
	totalItems int,
	warnings []string,
	batchIndex int,
	totalBatches int,
	batchSize int,
	isFinal bool,
	timeToFirstRowMs int64,
) {
	if s.telemetry == nil {
		return
	}
	s.telemetry.RecordSnapshot(
		domain,
		scope,
		s.cluster.ClusterID,
		s.cluster.ClusterName,
		duration,
		err,
		truncated,
		totalItems,
		warnings,
		batchIndex,
		totalBatches,
		batchSize,
		isFinal,
		timeToFirstRowMs,
	)
}

func (s *Service) cacheKey(domainName, scope string) string {
	return fmt.Sprintf("%s:%s", domainName, scope)
}

func (s *Service) loadCache(key string) *refresh.Snapshot {
	if s.cacheTTL <= 0 {
		return nil
	}
	s.cacheMu.RLock()
	entry, ok := s.cache[key]
	s.cacheMu.RUnlock()
	if !ok {
		return nil
	}
	if time.Now().After(entry.expiresAt) {
		s.cacheMu.Lock()
		delete(s.cache, key)
		s.cacheMu.Unlock()
		return nil
	}
	return entry.snapshot
}

func (s *Service) storeCache(key string, snap *refresh.Snapshot) {
	if s.cacheTTL <= 0 || snap == nil {
		return
	}
	if !s.shouldCacheSnapshot(snap) {
		return
	}
	s.cacheMu.Lock()
	s.cache[key] = cacheEntry{
		snapshot:  snap,
		expiresAt: time.Now().Add(s.cacheTTL),
	}
	s.cacheMu.Unlock()
}

func (s *Service) shouldCacheSnapshot(snap *refresh.Snapshot) bool {
	if snap == nil {
		return false
	}
	if snap.Domain == "object-maintenance" {
		return false
	}
	// Avoid caching partial snapshots so follow-up requests can rehydrate cleanly.
	if snap.Stats.Truncated {
		return false
	}
	if snap.Stats.TotalBatches > 0 && !snap.Stats.IsFinalBatch {
		return false
	}
	return true
}

func (s *Service) shouldBypassSingleflight(domainName string) bool {
	return domainName == "object-maintenance"
}

func (s *Service) shouldBypassSnapshotCache(domainName string) bool {
	switch domainName {
	case "pods", "namespace-workloads", "nodes":
		return true
	default:
		return false
	}
}

func newSourceVersionEpoch(meta ClusterMeta) string {
	serial := atomic.AddUint64(&sourceVersionEpochSerial, 1)
	return fmt.Sprintf("%s:%d:%d", meta.ClusterID, time.Now().UnixNano(), serial)
}

func (s *Service) finalizeSourceVersion(snap *refresh.Snapshot) {
	if snap == nil {
		return
	}
	if snap.SourceVersions == nil {
		snap.SourceVersions = make(map[string]string)
	}
	if strings.TrimSpace(snap.SourceVersions["object"]) == "" {
		snap.SourceVersions["object"] = strconv.FormatUint(snap.Version, 10)
	}
	snap.SourceVersion = s.sourceVersionToken(snap.Domain, snap.Scope, snap.SourceVersions)
}

func (s *Service) sourceVersionToken(domainName, scope string, sourceVersions map[string]string) string {
	type sourceClock struct {
		Source  string `json:"source"`
		Version string `json:"version"`
	}
	payload := struct {
		Epoch   string        `json:"epoch"`
		Cluster string        `json:"cluster"`
		Domain  string        `json:"domain"`
		Scope   string        `json:"scope"`
		Sources []sourceClock `json:"sources"`
	}{
		Epoch:   s.epoch,
		Cluster: s.cluster.ClusterID,
		Domain:  domainName,
		Scope:   scope,
	}
	keys := make([]string, 0, len(sourceVersions))
	for key, version := range sourceVersions {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(version) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		payload.Sources = append(payload.Sources, sourceClock{Source: key, Version: sourceVersions[key]})
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return "sv:" + hex.EncodeToString(sum[:])
}

func checksumBytes(data []byte) string {
	sum := fnv1a32(data)
	return fmt.Sprintf("%08x", sum)
}

func fnv1a32(data []byte) uint32 {
	const offset32 = 2166136261
	const prime32 = 16777619
	hash := uint32(offset32)
	for _, b := range data {
		hash ^= uint32(b)
		hash *= prime32
	}
	return hash
}
