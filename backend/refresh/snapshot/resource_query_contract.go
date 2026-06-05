package snapshot

import (
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// ResourceQueryRequest is the shared contract for future query-backed typed
// resource tables. It is deliberately separate from the catalog query because
// typed rows include projected status, owner, storage, Helm, autoscaling, and
// metric fields in addition to catalog identity.
type ResourceQueryRequest struct {
	ClusterID     string                   `json:"clusterId"`
	Table         string                   `json:"table"`
	Namespaces    []string                 `json:"namespaces,omitempty"`
	Kinds         []string                 `json:"kinds,omitempty"`
	Search        string                   `json:"search,omitempty"`
	Predicates    []ResourceQueryPredicate `json:"predicates,omitempty"`
	SortField     string                   `json:"sortField,omitempty"`
	SortDirection string                   `json:"sortDirection,omitempty"`
	Limit         int                      `json:"limit,omitempty"`
	Continue      string                   `json:"continue,omitempty"`
}

type ResourceQueryPredicate struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value string `json:"value,omitempty"`
}

type ResourceQueryResult struct {
	Rows          []ResourceQueryRow       `json:"rows"`
	Continue      string                   `json:"continue,omitempty"`
	CursorInvalid bool                     `json:"cursorInvalid,omitempty"`
	Total         int                      `json:"total"`
	TotalIsExact  bool                     `json:"totalIsExact"`
	Facets        ResourceQueryFacets      `json:"facets"`
	FacetsExact   bool                     `json:"facetsExact"`
	Partial       []ResourceQueryIssue     `json:"partial,omitempty"`
	Dynamic       *ResourceQueryDynamicRef `json:"dynamic,omitempty"`
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

func resourceQueryRequestFromValues(clusterID, table string, values url.Values, defaults ResourceQueryRequest) ResourceQueryRequest {
	request := defaults
	request.ClusterID = clusterID
	request.Table = table
	request.Search = strings.TrimSpace(values.Get("search"))
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

// QuerySelectionDescriptor is the durable selector used for query-wide export
// flows. It intentionally carries the same scoped query identity as
// ResourceQueryRequest so callers do not send thousands of concrete frontend
// rows back to the backend.
type QuerySelectionDescriptor struct {
	ClusterID     string                   `json:"clusterId"`
	Table         string                   `json:"table"`
	Namespaces    []string                 `json:"namespaces,omitempty"`
	Kinds         []string                 `json:"kinds,omitempty"`
	Search        string                   `json:"search,omitempty"`
	Predicates    []ResourceQueryPredicate `json:"predicates,omitempty"`
	SortField     string                   `json:"sortField,omitempty"`
	SortDirection string                   `json:"sortDirection,omitempty"`
	CustomOnly    bool                     `json:"customOnly,omitempty"`
}
