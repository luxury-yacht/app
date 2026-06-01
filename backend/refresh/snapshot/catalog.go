package snapshot

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	catalogDomain     = "catalog"
	catalogDiffDomain = "catalog-diff"
)

// CatalogConfig wires dependencies for the catalog browse domain.
type CatalogConfig struct {
	CatalogService  func() *objectcatalog.Service
	NamespaceGroups func() []CatalogNamespaceGroup
	Logger          containerlogsstream.Logger
}

// CatalogSnapshot captures the browse payload returned to clients.
type CatalogSnapshot struct {
	ClusterMeta
	Items               []objectcatalog.Summary  `json:"items"`
	Continue            string                   `json:"continue,omitempty"`
	Previous            string                   `json:"previous,omitempty"`
	CursorInvalid       bool                     `json:"cursorInvalid,omitempty"`
	Total               int                      `json:"total"`
	TotalIsExact        bool                     `json:"totalIsExact"`
	ResourceCount       int                      `json:"resourceCount"`
	Kinds               []objectcatalog.KindInfo `json:"kinds,omitempty"`
	Namespaces          []string                 `json:"namespaces,omitempty"`
	FacetsExact         bool                     `json:"facetsExact"`
	HasNext             bool                     `json:"hasNext"`
	HasPrevious         bool                     `json:"hasPrevious"`
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
	logger          containerlogsstream.Logger
}

type browseQueryOptions struct {
	Kinds      []string
	Namespaces []string
	Search     string
	SortField  string
	SortDir    string
	Limit      int
	Continue   string
	CustomOnly bool
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

	meta := ClusterMetaFromContext(ctx)
	adapter := newCatalogRefreshAdapter(svc, meta, b.namespaceGroups)
	return adapter.BuildSnapshot(b.domain, scope, opts), nil
}

func buildCatalogSnapshot(
	result objectcatalog.QueryResult,
	opts browseQueryOptions,
	health objectcatalog.HealthStatus,
	cachesReady bool,
	forceFinal bool,
) (CatalogSnapshot, bool) {
	effectiveLimit := opts.Limit
	if effectiveLimit <= 0 {
		effectiveLimit = len(result.Items)
	}
	if effectiveLimit <= 0 {
		effectiveLimit = 1
	}
	hasNext := result.ContinueToken != ""
	hasPrevious := result.PreviousToken != ""
	batchIndex := keysetCatalogBatchIndex(hasPrevious)
	totalBatches := 0
	if result.TotalIsExact && !hasPrevious && result.TotalItems > 0 && effectiveLimit > 0 {
		totalBatches = (result.TotalItems + effectiveLimit - 1) / effectiveLimit
	}
	isFinal := !hasNext || result.TotalItems == 0
	streamingDisabled := health.Status == objectcatalog.HealthStateError ||
		health.Status == objectcatalog.HealthStateDegraded ||
		health.Stale ||
		health.ConsecutiveFailures > 3
	if streamingDisabled {
		isFinal = true
		result.ContinueToken = ""
		hasNext = false
	}

	if forceFinal {
		isFinal = true
		if totalBatches == 0 && !hasPrevious {
			totalBatches = max(1, totalBatches)
		}
	} else if !cachesReady {
		isFinal = false
	}

	payload := CatalogSnapshot{
		Items:         cloneSummaries(result.Items),
		Continue:      result.ContinueToken,
		Previous:      result.PreviousToken,
		CursorInvalid: result.CursorInvalid,
		Total:         result.TotalItems,
		TotalIsExact:  result.TotalIsExact,
		ResourceCount: result.ResourceCount,
		Kinds:         cloneKindInfos(result.Kinds),
		Namespaces:    cloneStrings(result.Namespaces),
		FacetsExact:   result.FacetsExact,
		HasNext:       hasNext,
		HasPrevious:   hasPrevious,
		BatchIndex:    batchIndex,
		BatchSize:     len(result.Items),
		TotalBatches:  totalBatches,
		IsFinal:       isFinal,
	}

	truncated := result.ContinueToken != "" || (payload.Total > 0 && len(payload.Items) < payload.Total)

	return payload, truncated
}

func keysetCatalogBatchIndex(hasPrevious bool) int {
	if hasPrevious {
		return -1
	}
	return 0
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
	request := resourceQueryRequestFromValues("", "browse", values, ResourceQueryRequest{})
	opts := browseQueryOptions{
		Kinds:      request.Kinds,
		Namespaces: request.Namespaces,
		Search:     request.Search,
		SortField:  request.SortField,
		SortDir:    request.SortDirection,
		Continue:   request.Continue,
		Limit:      request.Limit,
		CustomOnly: values.Get("customOnly") == "true",
	}
	return opts, nil
}

func (o browseQueryOptions) toQueryOptions() objectcatalog.QueryOptions {
	return objectcatalog.QueryOptions{
		Kinds:         o.Kinds,
		Namespaces:    o.Namespaces,
		Search:        o.Search,
		SortField:     o.SortField,
		SortDirection: o.SortDir,
		Limit:         o.Limit,
		Continue:      o.Continue,
		CustomOnly:    o.CustomOnly,
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
