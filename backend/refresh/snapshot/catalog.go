package snapshot

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
)

const (
	catalogDomain     = "catalog"
	catalogDiffDomain = "catalog-diff"
)

// CatalogConfig wires dependencies for the catalog browse domain.
type CatalogConfig struct {
	CatalogService  func() *objectcatalog.Service
	NamespaceGroups func() []CatalogNamespaceGroup
	Logger          logstream.Logger
}

// CatalogSnapshot captures the browse payload returned to clients.
type CatalogSnapshot struct {
	ClusterMeta
	Items               []objectcatalog.Summary  `json:"items"`
	Continue            string                   `json:"continue,omitempty"`
	Total               int                      `json:"total"`
	ResourceCount       int                      `json:"resourceCount"`
	Kinds               []objectcatalog.KindInfo `json:"kinds,omitempty"`
	Namespaces          []string                 `json:"namespaces,omitempty"`
	NamespaceGroups     []CatalogNamespaceGroup  `json:"namespaceGroups,omitempty"`
	BatchIndex          int                      `json:"batchIndex"`
	BatchSize           int                      `json:"batchSize"`
	TotalBatches        int                      `json:"totalBatches"`
	IsFinal             bool                     `json:"isFinal"`
	FirstBatchLatencyMs int64                    `json:"firstBatchLatencyMs,omitempty"`
}

// CatalogNamespaceGroup captures per-cluster namespace lists and selection.
type CatalogNamespaceGroup struct {
	ClusterMeta
	Namespaces         []string `json:"namespaces"`
	SelectedNamespaces []string `json:"selectedNamespaces,omitempty"`
}

type catalogBuilder struct {
	domain          string
	catalogService  func() *objectcatalog.Service
	namespaceGroups func() []CatalogNamespaceGroup
	logger          logstream.Logger
}

type browseQueryOptions struct {
	Kinds      []string
	Namespaces []string
	Search     string
	Limit      int
	Continue   string
}

// RegisterCatalogDomain registers the catalog browse domain with the registry.
func RegisterCatalogDomain(reg *domain.Registry, cfg CatalogConfig) error {
	return registerCatalogDomain(reg, cfg, catalogDomain)
}

// RegisterCatalogDiffDomain registers the catalog domain used by the diff viewer.
func RegisterCatalogDiffDomain(reg *domain.Registry, cfg CatalogConfig) error {
	return registerCatalogDomain(reg, cfg, catalogDiffDomain)
}

func registerCatalogDomain(reg *domain.Registry, cfg CatalogConfig, name string) error {
	if reg == nil {
		return errors.New("domain registry is required")
	}
	if cfg.CatalogService == nil {
		return errors.New("catalog service accessor is required")
	}

	builder := &catalogBuilder{
		domain:          name,
		catalogService:  cfg.CatalogService,
		namespaceGroups: cfg.NamespaceGroups,
		logger:          cfg.Logger,
	}

	return reg.Register(refresh.DomainConfig{
		Name:          name,
		BuildSnapshot: builder.Build,
	})
}

// Build returns the browse snapshot payload sourced exclusively from the catalog.
func (b *catalogBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	opts, err := parseBrowseScope(scope)
	if err != nil {
		return nil, err
	}

	if ctx.Err() != nil {
		return nil, ctx.Err()
	}

	svc := b.catalogService()
	if svc == nil {
		return nil, errors.New("object catalog service unavailable")
	}

	result := svc.Query(opts.toQueryOptions())
	health := svc.Health()
	cachesReady := svc.CachesReady()

	meta := ClusterMetaFromContext(ctx)
	payload, truncated := buildCatalogSnapshot(result, opts, health, cachesReady, cachesReady)
	payload.ClusterMeta = meta
	payload.NamespaceGroups = buildCatalogNamespaceGroups(svc, meta, b.namespaceGroups, opts.Namespaces)
	if cachesReady && payload.Total > 0 {
		// Streaming caches are warm, but we still honour pagination when the client
		// requested limited scopes. Preserve the continue token so UI callers can
		// keep fetching additional pages after readiness flips to true.
		if payload.Continue == "" {
			payload.IsFinal = true
			if payload.TotalBatches == 0 {
				payload.TotalBatches = 1
			}
		} else {
			payload.IsFinal = false
		}
		payload.BatchSize = len(payload.Items)
	}

	if latency := svc.FirstBatchLatency(); latency > 0 {
		payload.FirstBatchLatencyMs = latency.Milliseconds()
	}

	snapshot := &refresh.Snapshot{
		Domain:  b.domain,
		Scope:   scope,
		Version: uint64(time.Now().UnixNano()),
		Payload: payload,
		Stats: refresh.SnapshotStats{
			ItemCount:    len(payload.Items),
			TotalItems:   result.TotalItems,
			Truncated:    truncated,
			BatchIndex:   payload.BatchIndex,
			BatchSize:    payload.BatchSize,
			TotalBatches: payload.TotalBatches,
			IsFinalBatch: payload.IsFinal,
		},
	}

	if payload.FirstBatchLatencyMs > 0 {
		snapshot.Stats.TimeToFirstRowMs = payload.FirstBatchLatencyMs
	}

	return snapshot, nil
}

func buildCatalogSnapshot(
	result objectcatalog.QueryResult,
	opts browseQueryOptions,
	health objectcatalog.HealthStatus,
	cachesReady bool,
	forceFinal bool,
) (CatalogSnapshot, bool) {
	startOffset := 0
	if opts.Continue != "" {
		if parsed, err := strconv.Atoi(opts.Continue); err == nil && parsed >= 0 {
			startOffset = parsed
		}
	}
	effectiveLimit := opts.Limit
	if effectiveLimit <= 0 {
		effectiveLimit = len(result.Items)
	}
	if effectiveLimit <= 0 {
		effectiveLimit = 1
	}
	batchIndex := 0
	if startOffset > 0 {
		batchIndex = startOffset / effectiveLimit
	}
	totalBatches := 0
	if result.TotalItems > 0 && effectiveLimit > 0 {
		totalBatches = (result.TotalItems + effectiveLimit - 1) / effectiveLimit
	}
	isFinal := result.ContinueToken == "" || result.TotalItems == 0
	streamingDisabled := health.Status == objectcatalog.HealthStateError ||
		health.Status == objectcatalog.HealthStateDegraded ||
		health.Stale ||
		health.ConsecutiveFailures > 3
	if streamingDisabled {
		isFinal = true
		result.ContinueToken = ""
		if totalBatches == 0 {
			totalBatches = batchIndex + 1
		}
	}

	if forceFinal {
		isFinal = true
		if totalBatches == 0 {
			totalBatches = max(1, totalBatches)
		}
	} else if !cachesReady {
		isFinal = false
	}

	payload := CatalogSnapshot{
		Items:         cloneSummaries(result.Items),
		Continue:      result.ContinueToken,
		Total:         result.TotalItems,
		ResourceCount: result.ResourceCount,
		Kinds:         cloneKindInfos(result.Kinds),
		Namespaces:    cloneStrings(result.Namespaces),
		BatchIndex:    batchIndex,
		BatchSize:     len(result.Items),
		TotalBatches:  totalBatches,
		IsFinal:       isFinal,
	}

	truncated := result.ContinueToken != "" || (payload.Total > 0 && len(payload.Items) < payload.Total)

	return payload, truncated
}

func buildCatalogNamespaceGroups(
	svc *objectcatalog.Service,
	meta ClusterMeta,
	provider func() []CatalogNamespaceGroup,
	selected []string,
) []CatalogNamespaceGroup {
	groups := []CatalogNamespaceGroup(nil)
	if provider != nil {
		groups = provider()
	}
	if len(groups) == 0 && svc != nil {
		if namespaces := svc.Namespaces(); len(namespaces) > 0 {
			groups = []CatalogNamespaceGroup{{
				ClusterMeta: meta,
				Namespaces:  cloneStrings(namespaces),
			}}
		}
	}
	if len(groups) == 0 {
		return nil
	}

	groups = cloneNamespaceGroups(groups)
	selected = normalizeSelectedNamespaces(selected)
	if len(selected) > 0 {
		for i := range groups {
			if len(groups[i].SelectedNamespaces) == 0 {
				groups[i].SelectedNamespaces = cloneStrings(selected)
			}
		}
	}
	return groups
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func parseBrowseScope(scope string) (browseQueryOptions, error) {
	_, trimmed := refresh.SplitClusterScope(scope)
	if trimmed == "" {
		return browseQueryOptions{}, nil
	}
	values, err := url.ParseQuery(trimmed)
	if err != nil {
		return browseQueryOptions{}, err
	}
	opts := browseQueryOptions{
		Kinds:      values["kind"],
		Namespaces: values["namespace"],
		Search:     values.Get("search"),
		Continue:   values.Get("continue"),
	}
	if limit := values.Get("limit"); limit != "" {
		if parsed, err := strconv.Atoi(limit); err == nil {
			opts.Limit = parsed
		}
	}
	return opts, nil
}

func (o browseQueryOptions) toQueryOptions() objectcatalog.QueryOptions {
	return objectcatalog.QueryOptions{
		Kinds:      o.Kinds,
		Namespaces: o.Namespaces,
		Search:     o.Search,
		Limit:      o.Limit,
		Continue:   o.Continue,
	}
}

func cloneSummaries(items []objectcatalog.Summary) []objectcatalog.Summary {
	if len(items) == 0 {
		return []objectcatalog.Summary{}
	}
	cloned := make([]objectcatalog.Summary, len(items))
	copy(cloned, items)
	return cloned
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func cloneKindInfos(values []objectcatalog.KindInfo) []objectcatalog.KindInfo {
	if len(values) == 0 {
		return []objectcatalog.KindInfo{}
	}
	cloned := make([]objectcatalog.KindInfo, len(values))
	copy(cloned, values)
	return cloned
}

func cloneNamespaceGroups(groups []CatalogNamespaceGroup) []CatalogNamespaceGroup {
	if len(groups) == 0 {
		return nil
	}
	cloned := make([]CatalogNamespaceGroup, len(groups))
	for i, group := range groups {
		cloned[i] = group
		cloned[i].Namespaces = cloneStrings(group.Namespaces)
		cloned[i].SelectedNamespaces = cloneStrings(group.SelectedNamespaces)
	}
	return cloned
}

func normalizeSelectedNamespaces(namespaces []string) []string {
	if len(namespaces) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(namespaces))
	normalized := make([]string, 0, len(namespaces))
	for _, namespace := range namespaces {
		value := strings.TrimSpace(namespace)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized
}
