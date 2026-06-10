package snapshot

import (
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
	Search     string                `json:"search,omitempty"`
	// IncludeMetadata extends Search to also match each row's labels and annotations.
	IncludeMetadata bool                     `json:"includeMetadata,omitempty"`
	Predicates      []ResourceQueryPredicate `json:"predicates,omitempty"`
	SortField       string                   `json:"sortField,omitempty"`
	SortDirection   string                   `json:"sortDirection,omitempty"`
	Limit           int                      `json:"limit,omitempty"`
	Continue        string                   `json:"continue,omitempty"`
}

type ResourceQueryPredicate struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value string `json:"value,omitempty"`
}

type ResourceQueryResult struct {
	Rows          []ResourceQueryRow `json:"rows"`
	Continue      string             `json:"continue,omitempty"`
	CursorInvalid bool               `json:"cursorInvalid,omitempty"`
	Total         int                `json:"total"`
	// UnfilteredTotal is the in-scope item count before the request's filters, for the
	// "showing {Total} of {UnfilteredTotal} items due to filters" banner.
	UnfilteredTotal int                      `json:"unfilteredTotal"`
	TotalIsExact    bool                     `json:"totalIsExact"`
	Facets          ResourceQueryFacets      `json:"facets"`
	FacetsExact     bool                     `json:"facetsExact"`
	Partial         []ResourceQueryIssue     `json:"partial,omitempty"`
	Dynamic         *ResourceQueryDynamicRef `json:"dynamic,omitempty"`
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

type ResourceQueryFacets struct {
	Kinds      []string `json:"kinds,omitempty"`
	Namespaces []string `json:"namespaces,omitempty"`
	Statuses   []string `json:"statuses,omitempty"`
	Nodes      []string `json:"nodes,omitempty"`
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

// ResourceQueryCapabilities is the provider-published source of truth for what
// table behavior is globally supported. The frontend must not infer global
// capability from the visible row slice.
type ResourceQueryCapabilities struct {
	SortableFields   []string `json:"sortableFields,omitempty"`
	FilterableFields []string `json:"filterableFields,omitempty"`
	SearchableFields []string `json:"searchableFields,omitempty"`
}

// ResourceQueryEnvelope is the one canonical metadata envelope shared by every
// backend-query resource inventory result. Domain result structs embed it and
// add a typed `Rows` slice; Go JSON inlining flattens these fields to the top
// level, so the frontend sees a single uniform envelope plus provider-owned
// projected rows. This is the "one backend query result envelope" target: one
// envelope type, not one row DTO.
//
// Facet fields (kinds/namespaces/statuses/nodes/facetsExact) are flat to match
// the existing typed payload wire format the frontend already reads, so a domain
// migrates by embedding this envelope without any shared frontend helper change.
type ResourceQueryEnvelope struct {
	Provider      ResourceQueryProvider `json:"provider"`
	Table         string                `json:"table"`
	QueryIdentity string                `json:"queryIdentity,omitempty"`
	Continue      string                `json:"continue,omitempty"`
	Previous      string                `json:"previous,omitempty"`
	CursorInvalid bool                  `json:"cursorInvalid,omitempty"`
	Total         int                   `json:"total"`
	// UnfilteredTotal is the in-scope item count before the request's filters, so the
	// frontend can render "showing {Total} of {UnfilteredTotal} items due to filters".
	UnfilteredTotal int                       `json:"unfilteredTotal"`
	TotalIsExact    bool                      `json:"totalIsExact"`
	Kinds           []string                  `json:"kinds,omitempty"`
	Namespaces      []string                  `json:"namespaces,omitempty"`
	Statuses        []string                  `json:"statuses,omitempty"`
	Nodes           []string                  `json:"nodes,omitempty"`
	FacetsExact     bool                      `json:"facetsExact"`
	Completeness    ResourceQueryCompleteness `json:"completeness,omitempty"`
	Issues          []ResourceQueryIssue      `json:"issues,omitempty"`
	Dynamic         *ResourceQueryDynamicRef  `json:"dynamic,omitempty"`
	Capabilities    ResourceQueryCapabilities `json:"capabilities"`
}

// newTypedResourceCapabilities builds capabilities for a typed-resource table:
// the query surface (sortable/filterable/searchable fields) the frontend reads.
func newTypedResourceCapabilities(sortable, filterable, searchable []string) ResourceQueryCapabilities {
	return ResourceQueryCapabilities{
		SortableFields:   sortable,
		FilterableFields: filterable,
		SearchableFields: searchable,
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
	return request
}

func resourceQueryListValues(values url.Values, pluralKey, singularKey string) []string {
	raw := make([]string, 0)
	for _, value := range values[pluralKey] {
		raw = append(raw, strings.Split(value, ",")...)
	}
	raw = append(raw, values[singularKey]...)
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

