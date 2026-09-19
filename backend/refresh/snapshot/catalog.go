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
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resourcekind"
)

const (
	catalogDomain     = "catalog"
	catalogDiffDomain = "catalog-diff"
)

// CatalogConfig wires dependencies for the catalog browse domain.
type CatalogConfig struct {
	CatalogService  func() *objectcatalog.Service
	NamespaceGroups func() []CatalogNamespaceGroup
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
	ResourceFamilies objectcatalog.ResourceFamilies `json:"resourceFamilies"`
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
	return b.buildSnapshot(svc, meta, scope, opts), nil
}

// newCatalogCapabilities builds capabilities for the catalog browse provider.
// Exports/copies are client-driven walks over the query cursor for every
// provider (the old backend query-wide export was retired), so capabilities
// describe only the query surface: sort/filter/search fields.
func newCatalogCapabilities() ResourceQueryCapabilities {
	return ResourceQueryCapabilities{
		SortableFields:   []string{"name", "kind", "api", "namespace", "age", "creationTimestamp"},
		FilterableFields: []string{"kinds", "namespaces", "apiGroups", "resourceScopes"},
		SearchableFields: []string{"name", "kind", "namespace"},
	}
}

func buildCatalogSnapshot(
	result objectcatalog.QueryResult,
	opts objectcatalog.QueryOptions,
	health objectcatalog.HealthStatus,
	cachesReady bool,
	forceFinal bool,
) (CatalogSnapshot, bool) {
	effectiveLimit := opts.Limit
	if effectiveLimit <= 0 {
		effectiveLimit = max(1, len(result.Items))
	}
	hasNext := result.ContinueToken != ""
	hasPrevious := result.PreviousToken != ""
	batchIndex := keysetCatalogBatchIndex(hasPrevious)
	totalBatches := 0
	if result.TotalIsExact && !hasPrevious && result.TotalItems > 0 {
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
			totalBatches = 1
		}
	} else if !cachesReady {
		isFinal = false
	}

	truncated := result.ContinueToken != "" || (result.TotalItems > 0 && len(result.Items) < result.TotalItems)

	// Completeness describes catalog health independently of pagination: a
	// healthy catalog remains complete even when more pages are available.
	payload := CatalogSnapshot{
		Provider:        ResourceQueryProviderCatalog,
		Completeness:    resourceQueryCompleteness(!degraded),
		Capabilities:    newCatalogCapabilities(),
		Items:           cloneCatalogValues(result.Items),
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
		Kinds:           cloneCatalogValues(result.Kinds),
		Namespaces:      cloneCatalogValues(result.Namespaces),
		Groups:          cloneCatalogValues(result.Groups),
		ResourceScopes:  cloneCatalogValues(result.ResourceScopes),
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
	return append(issues, catalogHealthIssues(health)...)
}

func catalogHealthIssues(health objectcatalog.HealthStatus) []ResourceQueryIssue {
	issues := make([]ResourceQueryIssue, 0, 2)
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
				Namespaces:  cloneCatalogValues(namespaces),
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
				groups[i].SelectedNamespaces = cloneCatalogValues(selected)
			}
		}
	}
	return groups
}

func parseBrowseScope(scope string) (objectcatalog.QueryOptions, error) {
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	if trimmed == "" {
		return objectcatalog.QueryOptions{}, nil
	}
	values, err := url.ParseQuery(trimmed)
	if err != nil {
		return objectcatalog.QueryOptions{}, err
	}
	// The scope's cluster id is the request cluster: the anchor's same-cluster
	// rule must be checked against it, not a placeholder.
	request := resourceQueryRequestFromValues(clusterID, "browse", values, ResourceQueryRequest{})
	if err := request.validate(); err != nil {
		return objectcatalog.QueryOptions{}, err
	}
	var resourceScope objectcatalog.Scope
	switch strings.ToLower(strings.TrimSpace(values.Get("resourceScope"))) {
	case "":
	case "cluster":
		resourceScope = objectcatalog.ScopeCluster
	case "namespace":
		resourceScope = objectcatalog.ScopeNamespace
	default:
		return objectcatalog.QueryOptions{}, fmt.Errorf("invalid catalog resource scope %q", values.Get("resourceScope"))
	}
	resourceScopeFilters := make([]objectcatalog.Scope, 0, len(values["resourceScopeFilter"]))
	for _, raw := range values["resourceScopeFilter"] {
		switch strings.ToLower(strings.TrimSpace(raw)) {
		case "cluster":
			resourceScopeFilters = append(resourceScopeFilters, objectcatalog.ScopeCluster)
		case "namespace":
			resourceScopeFilters = append(resourceScopeFilters, objectcatalog.ScopeNamespace)
		default:
			return objectcatalog.QueryOptions{}, fmt.Errorf("invalid catalog resource scope filter %q", raw)
		}
	}
	family := values.Get("resourceFamily")
	if family != "" && !resourcekind.IsResourceFamily(family) {
		return objectcatalog.QueryOptions{}, fmt.Errorf("invalid catalog resource family %q", family)
	}
	opts := objectcatalog.QueryOptions{
		ResourceFamily:  family,
		Scope:           resourceScope,
		ScopeNamespaces: values["scopeNamespace"],
		Kinds:           request.Kinds,
		Namespaces:      request.Namespaces,
		Groups:          values["apiGroup"],
		ResourceScopes:  resourceScopeFilters,
		Search:          request.Search,
		SortField:       request.SortField,
		SortDirection:   request.SortDirection,
		Continue:        request.Continue,
		Limit:           request.Limit,
		CustomOnly:      values.Get("customOnly") == "true",
		MatchNone:       request.MatchNone,
		StartRank:       request.StartRank,
	}
	if anchor := request.Anchor; anchor != nil {
		// The request was validated against the scope's cluster above; the catalog
		// service owns that cluster, so its internal anchor contains object identity.
		opts.Anchor = &objectcatalog.QueryAnchor{
			Group: anchor.Group, Version: anchor.Version, Kind: anchor.Kind,
			Namespace: anchor.Namespace, Name: anchor.Name, UID: anchor.UID,
		}
	}
	return opts, nil
}

// cloneCatalogValues detaches published slices and keeps empty JSON arrays non-null.
func cloneCatalogValues[T any](values []T) []T {
	cloned := make([]T, len(values))
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
		cloned[i].Namespaces = cloneCatalogValues(group.Namespaces)
		cloned[i].SelectedNamespaces = cloneCatalogValues(group.SelectedNamespaces)
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
