package objectcatalog

import (
	"context"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/runtime/schema"
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
	cachedKinds           []KindInfo
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
