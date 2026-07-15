package snapshot

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
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
//
// The catalog is the ResourceQueryProviderCatalog member of the resource-query
// contract. It deliberately does NOT embed ResourceQueryEnvelope: its `kinds`
// facet is the richer []objectcatalog.KindInfo (with per-kind counts), and it
// carries a keyset pagination model (previous/hasNext/batches) the flat envelope
// does not. Instead it surfaces the envelope's provider/completeness/capabilities
// contract fields directly alongside its own projection so the frontend
// controller can treat it as a conformant provider.
type CatalogSnapshot struct {
	ClusterMeta
	Provider     ResourceQueryProvider     `json:"provider"`
	Completeness ResourceQueryCompleteness `json:"completeness,omitempty"`
	Capabilities ResourceQueryCapabilities `json:"capabilities"`
	Items        []objectcatalog.Summary   `json:"items"`
	Continue     string                    `json:"continue,omitempty"`
	Previous     string                    `json:"previous,omitempty"`
	// Self addresses the served page itself (counted serves; see the envelope's
	// twin field) — page-stable refetch after an anchored landing.
	Self          string `json:"self,omitempty"`
	CursorInvalid bool   `json:"cursorInvalid,omitempty"`
	// Anchor is present iff the request carried one; PageStartRank is the
	// serve-time rank of the page's first row (pointer: rank 0 must survive
	// omitempty). Same contract as ResourceQueryEnvelope.
	Anchor          *ResourceQueryAnchorResult `json:"anchor,omitempty"`
	PageStartRank   *int                       `json:"pageStartRank,omitempty"`
	Total           int                        `json:"total"`
	UnfilteredTotal int                        `json:"unfilteredTotal"`
	TotalIsExact    bool                       `json:"totalIsExact"`
	ResourceCount   int                        `json:"resourceCount"`
	Kinds           []objectcatalog.KindInfo   `json:"kinds,omitempty"`
	Namespaces      []string                   `json:"namespaces,omitempty"`
	Groups          []string                   `json:"groups,omitempty"`
	ResourceScopes  []objectcatalog.Scope      `json:"resourceScopes,omitempty"`
	FacetsExact     bool                       `json:"facetsExact"`
	Issues          []ResourceQueryIssue       `json:"issues,omitempty"`
	HasNext         bool                       `json:"hasNext"`
	HasPrevious     bool                       `json:"hasPrevious"`
	NamespaceGroups []CatalogNamespaceGroup    `json:"namespaceGroups,omitempty"`
	// Batch fields below are diagnostics / streaming-progress only — NOT page
	// metadata. Pagination is the keyset Continue/Previous/HasNext/HasPrevious
	// above; the resource-inventory controller must not treat these as page state
	// (the "more pages" signal is the keyset token, not the batch counters). See
	// TestCatalogPaginationIsKeysetNotBatch.
	BatchIndex          int   `json:"batchIndex"`
	BatchSize           int   `json:"batchSize"`
	TotalBatches        int   `json:"totalBatches"`
	IsFinal             bool  `json:"isFinal"`
	FirstBatchLatencyMs int64 `json:"firstBatchLatencyMs,omitempty"`
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
	Scope           objectcatalog.Scope
	ScopeNamespaces []string
	Kinds           []string
	Namespaces      []string
	Groups          []string
	ResourceScopes  []objectcatalog.Scope
	Search          string
	SortField       string
	SortDir         string
	Limit           int
	Continue        string
	CustomOnly      bool
	MatchNone       bool
	Anchor          *ResourceQueryAnchor
	StartRank       *int
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

// newCatalogCapabilities builds capabilities for the catalog browse provider.
// Exports/copies are client-driven walks over the query cursor for every
// provider (the old backend query-wide export was retired), so capabilities
// describe only the query surface: sort/filter/search fields.
func newCatalogCapabilities() ResourceQueryCapabilities {
	return ResourceQueryCapabilities{
		SortableFields:   []string{"name", "kind", "namespace", "age", "creationTimestamp"},
		FilterableFields: []string{"kinds", "namespaces", "apiGroups", "resourceScopes"},
		SearchableFields: []string{"name", "kind", "namespace"},
	}
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
	// A degraded/stale sync keeps its already-collected data (partial failures
	// retain the prior data), and the querypage keyset cursor is stable under
	// churn and self-invalidates (CursorInvalid resets to page 1). So a degraded
	// catalog keeps paginating — it only downgrades completeness and surfaces a
	// health issue. It must NOT clear the cursor: doing so disabled Next for every
	// catalog view whenever a single resource type failed to list.
	degraded := health.Status == objectcatalog.HealthStateError ||
		health.Status == objectcatalog.HealthStateDegraded ||
		health.Stale ||
		health.ConsecutiveFailures > 3
	issues := catalogSnapshotIssues(result, health)

	if forceFinal {
		isFinal = true
		if totalBatches == 0 && !hasPrevious {
			totalBatches = max(1, totalBatches)
		}
	} else if !cachesReady {
		isFinal = false
	}

	truncated := result.ContinueToken != "" || (result.TotalItems > 0 && len(result.Items) < result.TotalItems)

	// Completeness mirrors the typed providers' degraded-based meaning, NOT
	// "fits in one page": a healthy catalog that simply has more pages is
	// `complete` (pagination is the recourse), and only a degraded catalog —
	// where streaming/pagination is disabled, so what you see is all you get —
	// is `partial`. This keeps the frontend controller's partial/degraded banner
	// off normal paginated browsing.
	payload := CatalogSnapshot{
		Provider:        ResourceQueryProviderCatalog,
		Completeness:    resourceQueryCompleteness(!degraded),
		Capabilities:    newCatalogCapabilities(),
		Items:           cloneSummaries(result.Items),
		Continue:        result.ContinueToken,
		Previous:        result.PreviousToken,
		Self:            result.SelfToken,
		CursorInvalid:   result.CursorInvalid,
		Anchor:          catalogAnchorResult(result.AnchorOutcome),
		PageStartRank:   pageStartRankPtr(result.PageStartRank),
		Total:           result.TotalItems,
		UnfilteredTotal: result.UnfilteredTotal,
		TotalIsExact:    result.TotalIsExact,
		ResourceCount:   result.ResourceCount,
		Kinds:           cloneKindInfos(result.Kinds),
		Namespaces:      cloneStrings(result.Namespaces),
		Groups:          cloneStrings(result.Groups),
		ResourceScopes:  cloneResourceScopes(result.ResourceScopes),
		FacetsExact:     result.FacetsExact,
		Issues:          issues,
		HasNext:         hasNext,
		HasPrevious:     hasPrevious,
		BatchIndex:      batchIndex,
		BatchSize:       len(result.Items),
		TotalBatches:    totalBatches,
		IsFinal:         isFinal,
	}

	return payload, truncated
}

func catalogSnapshotIssues(result objectcatalog.QueryResult, health objectcatalog.HealthStatus) []ResourceQueryIssue {
	issues := make([]ResourceQueryIssue, 0, 4)
	if result.CursorInvalid {
		issues = append(issues, ResourceQueryIssue{
			Kind:    "Catalog cursor",
			Message: "The previous page cursor expired or no longer matches this query; the table reset to a valid page.",
		})
	}
	if !result.TotalIsExact {
		issues = append(issues, ResourceQueryIssue{
			Kind:    "Catalog totals",
			Message: "The total result count is approximate because the match set exceeded the catalog metadata budget.",
		})
	}
	if !result.FacetsExact {
		issues = append(issues, ResourceQueryIssue{
			Kind:    "Catalog facets",
			Message: "Catalog filter options are approximate because the catalog metadata is incomplete.",
		})
	}
	if health.Status == objectcatalog.HealthStateDegraded ||
		health.Status == objectcatalog.HealthStateError ||
		health.Stale ||
		health.ConsecutiveFailures > 0 {
		message := "Catalog data may be stale or incomplete because one or more resource syncs failed."
		if health.FailedResources > 0 {
			message += " Failed resources: " + strconv.Itoa(health.FailedResources) + "."
		}
		if health.LastError != "" {
			message += " Last error: " + health.LastError
		}
		issues = append(issues, ResourceQueryIssue{
			Kind:    "Catalog health",
			Message: message,
		})
	}
	if len(health.DeniedResources) > 0 {
		const maxNamed = 5
		named := health.DeniedResources
		suffix := ""
		if len(named) > maxNamed {
			suffix = " and " + strconv.Itoa(len(named)-maxNamed) + " more"
			named = named[:maxNamed]
		}
		issues = append(issues, ResourceQueryIssue{
			Kind: "Catalog permissions",
			Message: "Your role cannot list " + strings.Join(named, ", ") + suffix +
				"; objects of those types are not shown.",
		})
	}
	return issues
}

func keysetCatalogBatchIndex(hasPrevious bool) int {
	if hasPrevious {
		return -1
	}
	return 0
}

// catalogAnchorResult maps the catalog engine's anchor outcome onto the wire
// contract (nil when the request carried no anchor), reusing the typed path's
// found/filtered/not-found mapping.
func catalogAnchorResult(outcome *querypage.AnchorOutcome) *ResourceQueryAnchorResult {
	if outcome == nil {
		return nil
	}
	return anchorResultFromOutcome(*outcome)
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
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	if trimmed == "" {
		return browseQueryOptions{}, nil
	}
	values, err := url.ParseQuery(trimmed)
	if err != nil {
		return browseQueryOptions{}, err
	}
	// The scope's cluster id is the request cluster: the anchor's same-cluster
	// rule must be checked against it, not a placeholder.
	request := resourceQueryRequestFromValues(clusterID, "browse", values, ResourceQueryRequest{})
	if err := request.validate(); err != nil {
		return browseQueryOptions{}, err
	}
	var resourceScope objectcatalog.Scope
	switch strings.ToLower(strings.TrimSpace(values.Get("resourceScope"))) {
	case "":
	case "cluster":
		resourceScope = objectcatalog.ScopeCluster
	case "namespace":
		resourceScope = objectcatalog.ScopeNamespace
	default:
		return browseQueryOptions{}, fmt.Errorf("invalid catalog resource scope %q", values.Get("resourceScope"))
	}
	resourceScopeFilters := make([]objectcatalog.Scope, 0, len(values["resourceScopeFilter"]))
	for _, raw := range values["resourceScopeFilter"] {
		switch strings.ToLower(strings.TrimSpace(raw)) {
		case "cluster":
			resourceScopeFilters = append(resourceScopeFilters, objectcatalog.ScopeCluster)
		case "namespace":
			resourceScopeFilters = append(resourceScopeFilters, objectcatalog.ScopeNamespace)
		default:
			return browseQueryOptions{}, fmt.Errorf("invalid catalog resource scope filter %q", raw)
		}
	}
	opts := browseQueryOptions{
		Scope:           resourceScope,
		ScopeNamespaces: values["scopeNamespace"],
		Kinds:           request.Kinds,
		Namespaces:      request.Namespaces,
		Groups:          values["apiGroup"],
		ResourceScopes:  resourceScopeFilters,
		Search:          request.Search,
		SortField:       request.SortField,
		SortDir:         request.SortDirection,
		Continue:        request.Continue,
		Limit:           request.Limit,
		CustomOnly:      values.Get("customOnly") == "true",
		MatchNone:       request.MatchNone,
		Anchor:          request.Anchor,
		StartRank:       request.StartRank,
	}
	return opts, nil
}

func (o browseQueryOptions) toQueryOptions() objectcatalog.QueryOptions {
	opts := objectcatalog.QueryOptions{
		Scope:           o.Scope,
		ScopeNamespaces: o.ScopeNamespaces,
		Kinds:           o.Kinds,
		Namespaces:      o.Namespaces,
		Groups:          o.Groups,
		ResourceScopes:  o.ResourceScopes,
		Search:          o.Search,
		SortField:       o.SortField,
		SortDirection:   o.SortDir,
		Limit:           o.Limit,
		Continue:        o.Continue,
		CustomOnly:      o.CustomOnly,
		MatchNone:       o.MatchNone,
	}
	if a := o.Anchor; a != nil {
		// ClusterID stays behind: parseBrowseScope already enforced the
		// same-cluster rule, and the catalog service is per-cluster.
		opts.Anchor = &objectcatalog.QueryAnchor{
			Group:     a.Group,
			Version:   a.Version,
			Kind:      a.Kind,
			Namespace: a.Namespace,
			Name:      a.Name,
			UID:       a.UID,
		}
	}
	opts.StartRank = o.StartRank
	return opts
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

func cloneResourceScopes(values []objectcatalog.Scope) []objectcatalog.Scope {
	if len(values) == 0 {
		return []objectcatalog.Scope{}
	}
	cloned := make([]objectcatalog.Scope, len(values))
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
