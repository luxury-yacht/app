/*
 * backend/capabilities/types.go
 *
 * Defines types used for capability evaluation.
 */

package capabilities

// CheckRequest represents a single capability evaluation request.
type CheckRequest struct {
	ID           string `json:"id"`                    // Arbitrary identifier supplied by the caller.
	ClusterID    string `json:"clusterId,omitempty"`   // Optional cluster identifier.
	Group        string `json:"group,omitempty"`       // Optional API group; required to disambiguate colliding kinds (e.g. two CRDs with the same Kind from different operators).
	Version      string `json:"version,omitempty"`     // Optional API version paired with Group; when both are set the backend uses the strict GVK resolver and bypasses kind-only first-match-wins discovery.
	Verb         string `json:"verb"`                  // Kubernetes verb being evaluated (get, list, create, update, patch, delete, deletecollection, watch).
	ResourceKind string `json:"resourceKind"`          // Kubernetes Kind being queried (Deployment, Pod, Namespace, etc.).
	Namespace    string `json:"namespace,omitempty"`   // Optional namespace scope.
	Name         string `json:"name,omitempty"`        // Optional resource name.
	Subresource  string `json:"subresource,omitempty"` // Optional subresource (e.g., "status", "scale").
}

// CheckResult captures the outcome of a capability evaluation.
type CheckResult struct {
	ID              string `json:"id"`                        // Arbitrary identifier supplied by the caller.
	ClusterID       string `json:"clusterId,omitempty"`       // Optional cluster identifier.
	Group           string `json:"group,omitempty"`           // API group echoed back from the request so the frontend can rebuild GVK-aware cache keys.
	Version         string `json:"version,omitempty"`         // API version echoed back from the request.
	Verb            string `json:"verb"`                      // Kubernetes verb being evaluated (get, list, create, update, patch, delete, deletecollection, watch).
	ResourceKind    string `json:"resourceKind"`              // Kubernetes Kind being queried (Deployment, Pod, Namespace, etc.).
	Namespace       string `json:"namespace,omitempty"`       // Optional namespace scope.
	Name            string `json:"name,omitempty"`            // Optional resource name.
	Subresource     string `json:"subresource,omitempty"`     // Optional subresource (e.g., "status", "scale").
	Allowed         bool   `json:"allowed"`                   // Indicates whether the action is permitted.
	DeniedReason    string `json:"deniedReason,omitempty"`    // Contains any denial message returned by the Kubernetes API.
	EvaluationError string `json:"evaluationError,omitempty"` // Captures evaluation errors returned by the API server.
	Error           string `json:"error,omitempty"`           // Populated when the review request itself fails.
}
