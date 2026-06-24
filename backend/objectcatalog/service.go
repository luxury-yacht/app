/*
 * backend/objectcatalog/service.go
 *
 * Defines the object catalog service and its shared dependencies.
 */

package objectcatalog

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
)

const (
	componentName = "ObjectCatalog"
)

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

	mu sync.RWMutex
	catalogIndex
	queryStore CatalogQueryStore
	identity   *resourceIdentityResolver

	// discoveryClient is the per-cluster discovery client the catalog re-discovers through.
	// In production it is a disk-cached, ETag-revalidating, aggregated-discovery client
	// (built once via ensureDiscovery → buildDiscoveryClient); tests pre-inject it.
	// discoveryInvalidate is its cache-invalidation hook (nil for a plain, uncached client),
	// and discoveryStale latches when a CRD change requires the cache to be invalidated on
	// the next discover so a newly-created CRD is never hidden behind a stale document.
	discoveryOnce       sync.Once
	discoveryClient     discovery.DiscoveryInterface
	discoveryInvalidate func()
	discoveryStale      atomic.Bool

	// dynamicIngested is the set of dynamic (CRD-backed) kinds the catalog has promoted
	// onto the ingest path on demand (see maybePromote). collectViaIngest serves these from
	// the ingest manager's CatalogRows once their reflector has synced; stopDynamicReflectors
	// tears them down with the catalog.
	dynamicMu       sync.RWMutex
	dynamicIngested map[schema.GroupVersionResource]struct{}

	healthMu sync.RWMutex
	health   healthStatus

	syncMu         sync.Mutex  // serializes full syncs from the run loop and watch recovery path
	syncInProgress atomic.Bool // true while sync() is running; prevents watch flush races

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

// summaryChunk holds one published batch of summaries. Chunks are IMMUTABLE
// once published: items are never mutated in place — emit and cache rebuilds
// always create fresh chunks. Snapshots therefore share chunk pointers.
type summaryChunk struct {
	items []Summary
}

// NewService constructs a catalog service with the provided dependencies and options.
func NewService(deps Dependencies, opts *Options) *Service {
	serviceOpts := Options{
		ResyncInterval:             config.ObjectCatalogResyncInterval,
		PageSize:                   config.ObjectCatalogPageSize,
		ListWorkers:                adjustedListWorkers(),
		NamespaceWorkers:           config.ObjectCatalogNamespaceWorkers,
		InformerPromotionThreshold: config.ObjectCatalogInformerPromotionThreshold,
		EvictionTTL:                config.ObjectCatalogEvictionTTL,
		StreamingBatchSize:         config.ObjectCatalogStreamingBatchSize,
		StreamingFlushInterval:     config.ObjectCatalogStreamingFlushInterval,
		EnableReactiveUpdates:      true,
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
		if !opts.EnableReactiveUpdates {
			serviceOpts.EnableReactiveUpdates = false
		}
		if opts.QueryStore != nil {
			serviceOpts.QueryStore = opts.QueryStore
		}
	}

	nowFn := deps.Now
	if nowFn == nil {
		nowFn = time.Now
	}

	service := &Service{
		deps:              deps,
		opts:              serviceOpts,
		clusterID:         deps.ClusterID,
		clusterName:       deps.ClusterName,
		catalogIndex:      newCatalogIndex(),
		identity:          newResourceIdentityResolver(deps.Common, deps.Logger),
		dynamicIngested:   make(map[schema.GroupVersionResource]struct{}),
		health:            healthStatus{State: HealthStateUnknown},
		doneCh:            make(chan struct{}),
		now:               nowFn,
		streamSubscribers: make(map[int]chan StreamingUpdate),
	}
	if serviceOpts.QueryStore != nil {
		service.queryStore = serviceOpts.QueryStore
	} else {
		service.queryStore = newInMemoryCatalogQueryStore(service)
	}
	return service
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
		s.logInfo("Object catalog service starting")
		runErr = s.runLoop(ctx)
	})
	return runErr
}

// Wait blocks until the service finishes running.
func (s *Service) Wait() {
	<-s.doneCh
}
