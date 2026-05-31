package snapshot

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
	Previous      string                   `json:"previous,omitempty"`
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

// QuerySelectionDescriptor is the durable selector used for query-wide export,
// selection, and bulk-action flows. It intentionally carries the same scoped
// query identity as ResourceQueryRequest so callers do not send thousands of
// concrete frontend rows back to the backend.
type QuerySelectionDescriptor struct {
	ClusterID      string                   `json:"clusterId"`
	Table          string                   `json:"table"`
	Namespaces     []string                 `json:"namespaces,omitempty"`
	Kinds          []string                 `json:"kinds,omitempty"`
	Search         string                   `json:"search,omitempty"`
	Predicates     []ResourceQueryPredicate `json:"predicates,omitempty"`
	SortField      string                   `json:"sortField,omitempty"`
	SortDirection  string                   `json:"sortDirection,omitempty"`
	QuerySignature string                   `json:"querySignature,omitempty"`
}

type QueryBulkActionRequest struct {
	Selection QuerySelectionDescriptor `json:"selection"`
	Action    string                   `json:"action"`
	DryRun    bool                     `json:"dryRun,omitempty"`
	Confirmed bool                     `json:"confirmed,omitempty"`
	Limit     int                      `json:"limit,omitempty"`
	Continue  string                   `json:"continue,omitempty"`
}

type QueryBulkActionResult struct {
	RequiresConfirmation bool                     `json:"requiresConfirmation,omitempty"`
	Processed            int                      `json:"processed"`
	Succeeded            int                      `json:"succeeded"`
	Failed               int                      `json:"failed"`
	Continue             string                   `json:"continue,omitempty"`
	Failures             []QueryBulkActionFailure `json:"failures,omitempty"`
	Issues               []ResourceQueryIssue     `json:"issues,omitempty"`
}

type QueryBulkActionFailure struct {
	Ref     ResourceQueryRow `json:"ref"`
	Message string           `json:"message"`
}
