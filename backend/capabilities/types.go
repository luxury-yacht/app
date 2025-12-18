package capabilities

// CheckRequest represents a single capability evaluation request.
//
// ID is an arbitrary identifier supplied by the caller so results can be
// correlated with UI actions (for example "update", "delete", "portForward").
// Verb matches the Kubernetes verb being evaluated (get, list, create, update,
// patch, delete, deletecollection, watch). ResourceKind is the Kubernetes Kind
// being queried (Deployment, Pod, Namespace, etc.). Optional Namespace, Name,
// and Subresource values scope the request; they are omitted for cluster-level
// operations or verbs that operate on collections.
type CheckRequest struct {
	ID           string `json:"id"`
	Verb         string `json:"verb"`
	ResourceKind string `json:"resourceKind"`
	Namespace    string `json:"namespace,omitempty"`
	Name         string `json:"name,omitempty"`
	Subresource  string `json:"subresource,omitempty"`
}

// CheckResult captures the outcome of a capability evaluation.
//
// Allowed indicates whether the action is permitted. DeniedReason contains any
// denial message returned by the Kubernetes API (usually an RBAC reason).
// EvaluationError captures evaluation errors returned by the API server (for
// example, malformed requests). Error is populated when the review request
// itself fails (network/RBAC errors against the SelfSubjectAccessReview API).
// The request metadata (ID, Verb, ResourceKind, Namespace, Name, Subresource)
// are echoed to simplify correlating results on the frontend.
type CheckResult struct {
	ID              string `json:"id"`
	Verb            string `json:"verb"`
	ResourceKind    string `json:"resourceKind"`
	Namespace       string `json:"namespace,omitempty"`
	Name            string `json:"name,omitempty"`
	Subresource     string `json:"subresource,omitempty"`
	Allowed         bool   `json:"allowed"`
	DeniedReason    string `json:"deniedReason,omitempty"`
	EvaluationError string `json:"evaluationError,omitempty"`
	Error           string `json:"error,omitempty"`
}
