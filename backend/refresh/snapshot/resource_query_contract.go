package snapshot

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// ResourceQueryProvider identifies the backend producer family behind a
// resource inventory query. The frontend controller is provider-agnostic once
// the result envelope is normalized; the distinction exists only because the
// producers differ.
type ResourceQueryProvider string

const (
	// ResourceQueryProviderTypedResource owns known Kubernetes resource family
	// rows (nodes, pods, workloads, config, rbac, storage, ...).
	ResourceQueryProviderTypedResource ResourceQueryProvider = "typed-resource"
	// ResourceQueryProviderCatalog owns Browse and generic Custom resource rows
	// via the object catalog query path.
	ResourceQueryProviderCatalog ResourceQueryProvider = "catalog"
)

// ResourceQueryScope identifies the breadth of a resource inventory query.
type ResourceQueryScope string

const (
	ResourceQueryScopeCluster       ResourceQueryScope = "cluster"
	ResourceQueryScopeNamespace     ResourceQueryScope = "namespace"
	ResourceQueryScopeAllNamespaces ResourceQueryScope = "all-namespaces"
)

// ResourceQueryCompleteness is truthfulness metadata on a result: whether the
// rows represent the complete matching set for the query, or only a truncated,
// recent, degraded, or windowed view.
type ResourceQueryCompleteness string

const (
	ResourceQueryComplete ResourceQueryCompleteness = "complete"
	ResourceQueryPartial  ResourceQueryCompleteness = "partial"
)

// ResourceQueryRequest is the shared request contract for query-backed resource
// inventory tables. Both the typed-resource and catalog providers accept it.
type ResourceQueryRequest struct {
	ClusterID  string                `json:"clusterId"`
	Provider   ResourceQueryProvider `json:"provider,omitempty"`
	Table      string                `json:"table"`
	Scope      ResourceQueryScope    `json:"scope,omitempty"`
	Namespaces []string              `json:"namespaces,omitempty"`
	Kinds      []string              `json:"kinds,omitempty"`
	Facets     map[string][]string   `json:"facets,omitempty"`
	MatchNone  bool                  `json:"matchNone,omitempty"`
	Search     string                `json:"search,omitempty"`
	// IncludeMetadata extends Search to also match each row's labels and annotations.
	IncludeMetadata bool                     `json:"includeMetadata,omitempty"`
	Predicates      []ResourceQueryPredicate `json:"predicates,omitempty"`
	SortField       string                   `json:"sortField,omitempty"`
	SortDirection   string                   `json:"sortDirection,omitempty"`
	Limit           int                      `json:"limit,omitempty"`
	Continue        string                   `json:"continue,omitempty"`
	// Anchor asks for the page CONTAINING this object under the request's
	// sort+filters instead of a cursor-addressed page. Mutually exclusive with
	// Continue and StartRank (validate); the response mints ordinary keyset
	// cursors, so pagination after a jump is indistinguishable from arriving by
	// clicking.
	Anchor *ResourceQueryAnchor `json:"anchor,omitempty"`
	// StartRank asks for the page starting at this 0-based rank among matching
	// rows — the bounded offset contract behind numbered page jumps (offered by
	// the UI only while totals are exact). Mutually exclusive with Continue and
	// Anchor; the engine clamps past-the-end starts to the last aligned page.
	StartRank *int `json:"startRank,omitempty"`
}

// ResourceQueryAnchor is the full object reference of an anchor jump target.
// ClusterID must equal the request's cluster (cross-cluster anchors are a
// validation error — navigate first, then anchor). UID, when present, is an
// identity cross-check applied only where the resolved row carries a UID (the
// catalog); it is never a lookup key — engine row keys are name-shaped.
type ResourceQueryAnchor struct {
	ClusterID string `json:"clusterId"`
	Group     string `json:"group"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
	UID       string `json:"uid,omitempty"`
}

// ResourceQueryAnchorResult reports how the serve resolved the request's
// anchor. A missing anchor (found=false) still serves the FIRST page — one
// round trip, sane landing — with Reason saying why: "filtered" (the object
// exists but the request's filters/search exclude it) or "not-found" (deleted,
// or identity mismatch). Rank is the anchor row's 0-based position among the
// matching rows under THIS request's sort+filters (-1 when not found).
type ResourceQueryAnchorReason string

const (
	ResourceQueryAnchorFiltered ResourceQueryAnchorReason = "filtered"
	ResourceQueryAnchorNotFound ResourceQueryAnchorReason = "not-found"
)

type ResourceQueryAnchorResult struct {
	Found  bool                      `json:"found"`
	Rank   int                       `json:"rank"`
	Reason ResourceQueryAnchorReason `json:"reason,omitempty"`
}

// validate enforces the request's page-address contract: continue, anchor,
// and startRank are three mutually exclusive ways to address a page, and each
// carries its own field rules.
func (r ResourceQueryRequest) validate() error {
	if r.StartRank != nil {
		if r.Continue != "" || r.Anchor != nil {
			return fmt.Errorf("resource query: startRank, anchor, and continue are mutually exclusive")
		}
		if *r.StartRank < 0 {
			return fmt.Errorf("resource query: startRank must be non-negative")
		}
	}
	return r.validateAnchor()
}

// validateAnchor enforces the anchor contract: a full object reference
// (clusterId, version, kind, name; group may be empty for the core group) on
// the SAME cluster as the request, mutually exclusive with a continue token.
func (r ResourceQueryRequest) validateAnchor() error {
	if r.Anchor == nil {
		return nil
	}
	if r.Continue != "" {
		return fmt.Errorf("resource query: anchor and continue are mutually exclusive")
	}
	a := r.Anchor
	switch {
	case a.ClusterID == "":
		return fmt.Errorf("resource query anchor: clusterId is required")
	case a.Version == "":
		return fmt.Errorf("resource query anchor: version is required")
	case a.Kind == "":
		return fmt.Errorf("resource query anchor: kind is required")
	case a.Name == "":
		return fmt.Errorf("resource query anchor: name is required")
	}
	if a.ClusterID != r.ClusterID {
		return fmt.Errorf("resource query anchor: cluster %q does not match request cluster %q", a.ClusterID, r.ClusterID)
	}
	return nil
}

type ResourceQueryPredicate struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value string `json:"value,omitempty"`
}

type ResourceQueryRow struct {
	ClusterID string `json:"clusterId"`
	Group     string `json:"group"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
	UID       string `json:"uid,omitempty"`

	Status  string `json:"status,omitempty"`
	Ready   string `json:"ready,omitempty"`
	Details string `json:"details,omitempty"`
	Age     string `json:"age,omitempty"`

	Restarts int    `json:"restarts,omitempty"`
	Owner    string `json:"owner,omitempty"`
	Node     string `json:"node,omitempty"`

	CRDName        string `json:"crdName,omitempty"`
	CRDGroup       string `json:"crdGroup,omitempty"`
	CRDScope       string `json:"crdScope,omitempty"`
	StorageVersion string `json:"storageVersion,omitempty"`

	StorageClass string `json:"storageClass,omitempty"`
	Capacity     string `json:"capacity,omitempty"`
	Claim        string `json:"claim,omitempty"`

	ChartVersion string `json:"chartVersion,omitempty"`
	AppVersion   string `json:"appVersion,omitempty"`
	HelmRevision string `json:"helmRevision,omitempty"`
	HelmUpdated  string `json:"helmUpdated,omitempty"`

	AutoscalingTarget  string `json:"autoscalingTarget,omitempty"`
	AutoscalingCurrent string `json:"autoscalingCurrent,omitempty"`
	AutoscalingDesired string `json:"autoscalingDesired,omitempty"`

	CPU    string `json:"cpu,omitempty"`
	Memory string `json:"memory,omitempty"`
}

type ResourceQueryIssue struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

type ResourceQueryDynamicRef struct {
	Source   string `json:"source"`
	Revision string `json:"revision"`
	Policy   string `json:"policy"`
}

// ResourceQueryFacetDescriptor is provider-owned metadata for one query facet.
// Key is the stable selection/persistence identity; the remaining fields tell
// every frontend surface how to render the control without key-specific logic.
type ResourceQueryFacetDescriptor struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Placeholder string `json:"placeholder"`
	Searchable  bool   `json:"searchable"`
	BulkActions bool   `json:"bulkActions"`
}

// ResourceQueryFacetOption is one stable wire selection plus its display label.
type ResourceQueryFacetOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// ResourceQueryFacetValues carries the current structural-scope option set for
// one provider-declared facet and whether that option set is exact.
type ResourceQueryFacetValues struct {
	Key     string                     `json:"key"`
	Options []ResourceQueryFacetOption `json:"options"`
	Exact   bool                       `json:"exact"`
}

// ResourceQueryCapabilities is the provider-published source of truth for what
// table behavior is globally supported. The frontend must not infer global
// capability from the visible row slice.
type ResourceQueryCapabilities struct {
	SortableFields   []string `json:"sortableFields,omitempty"`
	FilterableFields []string `json:"filterableFields,omitempty"`
	SearchableFields []string `json:"searchableFields,omitempty"`
	// KindVocabulary is the closed set of kinds this family can emit — the
	// option list the frontend's Kinds dropdown renders. It is the single owner
	// of that list: the kind FACETS on results collapse to the active selection
	// by design (they describe the matched rows) and must never be used as the
	// dropdown options. Families with an open kind set (events: involved-object
	// kinds) publish none and must not render a kind dropdown.
	KindVocabulary []string `json:"kindVocabulary,omitempty"`
	// QueryFacets owns the stable keys and display behavior for provider-specific
	// query dimensions. Dynamic option values travel on the result envelope.
	QueryFacets []ResourceQueryFacetDescriptor `json:"queryFacets,omitempty"`
}

// ResourceQueryEnvelope is the one canonical metadata envelope shared by every
// backend-query resource inventory result. Domain result structs embed it and
// add a typed `Rows` slice; Go JSON inlining flattens these fields to the top
// level, so the frontend sees a single uniform envelope plus provider-owned
// projected rows. This is the "one backend query result envelope" target: one
// envelope type, not one row DTO.
//
// Structural kind/namespace facets remain flat. Provider-owned facets use the
// generic FacetValues collection and are paired by stable key with capability
// descriptors; frontend code does not branch on provider facet names.
type ResourceQueryEnvelope struct {
	Provider      ResourceQueryProvider `json:"provider"`
	Table         string                `json:"table"`
	QueryIdentity string                `json:"queryIdentity,omitempty"`
	Continue      string                `json:"continue,omitempty"`
	Previous      string                `json:"previous,omitempty"`
	// Self addresses the served page itself — present on counted serves
	// (anchor/offset landings, which have no request token of their own) so a
	// live refetch can reproduce the page instead of re-anchoring or resetting.
	Self          string `json:"self,omitempty"`
	CursorInvalid bool   `json:"cursorInvalid,omitempty"`
	// Anchor is present iff the request carried one (see ResourceQueryAnchorResult).
	Anchor *ResourceQueryAnchorResult `json:"anchor,omitempty"`
	// PageStartRank is the 0-based rank of the served page's first row among the
	// matching rows — serve-time position honesty for the footer. A POINTER so
	// rank 0 (page 1) stays distinguishable from "not computed" under omitempty:
	// absent means the serve did not pay the counted walk (plain cursor pages
	// until P9's benchmark gate), never "first page".
	PageStartRank *int `json:"pageStartRank,omitempty"`
	Total         int  `json:"total"`
	// UnfilteredTotal is the in-scope item count before the request's filters, so the
	// frontend can render "showing {Total} of {UnfilteredTotal} items due to filters".
	UnfilteredTotal int                        `json:"unfilteredTotal"`
	TotalIsExact    bool                       `json:"totalIsExact"`
	Kinds           []string                   `json:"kinds,omitempty"`
	Namespaces      []string                   `json:"namespaces,omitempty"`
	FacetValues     []ResourceQueryFacetValues `json:"facetValues,omitempty"`
	FacetsExact     bool                       `json:"facetsExact"`
	Completeness    ResourceQueryCompleteness  `json:"completeness,omitempty"`
	Issues          []ResourceQueryIssue       `json:"issues,omitempty"`
	Dynamic         *ResourceQueryDynamicRef   `json:"dynamic,omitempty"`
	Capabilities    ResourceQueryCapabilities  `json:"capabilities"`
}

// newTypedResourceCapabilities builds capabilities for a typed-resource table:
// the query surface (sortable/filterable/searchable fields) the frontend reads,
// plus the family's closed kind vocabulary (nil for open kind sets).
func newTypedResourceCapabilities(sortable, filterable, searchable, kindVocabulary []string, queryFacets ...ResourceQueryFacetDescriptor) ResourceQueryCapabilities {
	return ResourceQueryCapabilities{
		SortableFields:   sortable,
		FilterableFields: filterable,
		SearchableFields: searchable,
		KindVocabulary:   kindVocabulary,
		QueryFacets:      queryFacets,
	}
}

// resourceQueryCompleteness maps a "is this the complete matching set" boolean
// to the truthfulness enum carried on the envelope.
func resourceQueryCompleteness(complete bool) ResourceQueryCompleteness {
	if complete {
		return ResourceQueryComplete
	}
	return ResourceQueryPartial
}

func resourceQueryRequestFromValues(clusterID, table string, values url.Values, defaults ResourceQueryRequest) ResourceQueryRequest {
	request := defaults
	request.ClusterID = clusterID
	request.Table = table
	request.Search = strings.TrimSpace(values.Get("search"))
	request.IncludeMetadata = strings.TrimSpace(values.Get("includeMetadata")) == "true"
	request.Namespaces = resourceQueryListValues(values, "namespaces", "namespace")
	request.Kinds = resourceQueryListValues(values, "kinds", "kind")
	request.Facets = resourceQueryFacetSelections(values)
	request.MatchNone = strings.TrimSpace(values.Get("matchNone")) == "true"
	request.SortField = strings.TrimSpace(values.Get("sort"))
	if request.SortField == "" {
		request.SortField = defaults.SortField
	}
	request.SortDirection = normalizeResourceQuerySortDirection(values.Get("sortDirection"), request.SortDirection)
	request.Continue = strings.TrimSpace(values.Get("continue"))
	if limit, err := strconv.Atoi(strings.TrimSpace(values.Get("limit"))); err == nil && limit > 0 {
		request.Limit = limit
	}

	predicates := map[string]string{}
	for key, valuesForKey := range values {
		if !strings.HasPrefix(key, "predicate.") || len(valuesForKey) == 0 {
			continue
		}
		field := strings.TrimPrefix(key, "predicate.")
		if field == "" {
			continue
		}
		predicates[field] = strings.TrimSpace(valuesForKey[0])
	}
	request.Predicates = resourceQueryPredicateMapToList(predicates)
	request.Anchor = resourceQueryAnchorFromValues(values)
	if raw := strings.TrimSpace(values.Get("startRank")); raw != "" {
		if rank, err := strconv.Atoi(raw); err == nil {
			request.StartRank = &rank
		}
	}
	return request
}

func resourceQueryFacetSelections(values url.Values) map[string][]string {
	result := map[string][]string{}
	for rawKey := range values {
		key, ok := strings.CutPrefix(rawKey, "facet.")
		key = strings.TrimSpace(key)
		if !ok || key == "" {
			continue
		}
		selected := normalizeResourceQueryValues(values[rawKey])
		if len(selected) > 0 {
			result[key] = selected
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// resourceQueryAnchorFromValues builds the anchor object reference from the
// anchor.* query params — the same scope-string channel the continue token
// rides. Returns nil when no anchor.name/anchor.kind param is present;
// validateAnchor enforces field completeness afterward.
func resourceQueryAnchorFromValues(values url.Values) *ResourceQueryAnchor {
	name := strings.TrimSpace(values.Get("anchor.name"))
	kind := strings.TrimSpace(values.Get("anchor.kind"))
	if name == "" && kind == "" {
		return nil
	}
	return &ResourceQueryAnchor{
		ClusterID: strings.TrimSpace(values.Get("anchor.clusterId")),
		Group:     strings.TrimSpace(values.Get("anchor.group")),
		Version:   strings.TrimSpace(values.Get("anchor.version")),
		Kind:      kind,
		Namespace: strings.TrimSpace(values.Get("anchor.namespace")),
		Name:      name,
		UID:       strings.TrimSpace(values.Get("anchor.uid")),
	}
}

func resourceQueryListValues(values url.Values, pluralKey, singularKey string) []string {
	raw := make([]string, 0)
	for _, value := range values[pluralKey] {
		raw = append(raw, strings.Split(value, ",")...)
	}
	if singularKey != "" {
		raw = append(raw, values[singularKey]...)
	}
	return normalizeResourceQueryValues(raw)
}

// Provider-owned facet values are opaque. Unlike structural namespace/kind
// lists, they must not be comma-split: a value may itself be a structured
// identity containing commas. Multiple selections use repeated query keys.
func normalizeResourceQueryValues(raw []string) []string {
	if len(raw) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(raw))
	result := make([]string, 0, len(raw))
	for _, value := range raw {
		item := strings.TrimSpace(value)
		if item == "" {
			continue
		}
		key := strings.ToLower(item)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, item)
	}
	sort.Strings(result)
	return result
}

func normalizeResourceQuerySortDirection(value, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "desc":
		return "desc"
	case "asc":
		return "asc"
	default:
		return strings.TrimSpace(fallback)
	}
}

func resourceQueryPredicatesToMap(predicates []ResourceQueryPredicate) map[string]string {
	if len(predicates) == 0 {
		return nil
	}
	result := make(map[string]string, len(predicates))
	for _, predicate := range predicates {
		if predicate.Field == "" {
			continue
		}
		result[predicate.Field] = predicate.Value
	}
	return result
}

func resourceQueryPredicateMapToList(predicates map[string]string) []ResourceQueryPredicate {
	if len(predicates) == 0 {
		return nil
	}
	result := make([]ResourceQueryPredicate, 0, len(predicates))
	for field, value := range predicates {
		result = append(result, ResourceQueryPredicate{
			Field: field,
			Op:    "eq",
			Value: value,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Field < result[j].Field
	})
	return result
}
