/*
 * backend/capabilities/query.go
 *
 * Defines types for the QueryPermissions endpoint, which replaces
 * per-check SSAR calls with per-namespace SSRR calls.
 */

package capabilities

// PermissionQuery is a single permission check request from the frontend.
//
// Group and Version together MUST carry a fully-qualified GroupVersionKind
// — this is what lets the RBAC gate distinguish between two CRDs that
// share a Kind (e.g. DBInstance under different operators). The backend
// rejects queries with an empty Version: the legacy kind-only resolver
// was first-match-wins across colliding CRDs and has been retired. See
// docs/plans/kind-only-objects.md step 4 and resolveGVRForPermissionQuery
// in backend/app_permissions.go.
type PermissionQuery struct {
	ID           string `json:"id"`
	ClusterId    string `json:"clusterId"`
	Group        string `json:"group,omitempty"`
	Version      string `json:"version,omitempty"`
	ResourceKind string `json:"resourceKind"`
	Verb         string `json:"verb"`
	Namespace    string `json:"namespace,omitempty"`
	Subresource  string `json:"subresource,omitempty"`
	Name         string `json:"name,omitempty"`
}

// PermissionResult is the response for a single permission check.
type PermissionResult struct {
	ID           string `json:"id"`
	ClusterId    string `json:"clusterId"`
	Group        string `json:"group,omitempty"`
	Version      string `json:"version,omitempty"`
	ResourceKind string `json:"resourceKind"`
	Verb         string `json:"verb"`
	Namespace    string `json:"namespace,omitempty"`
	Subresource  string `json:"subresource,omitempty"`
	Name         string `json:"name,omitempty"`
	Allowed      bool   `json:"allowed"`
	// Source indicates how the result was determined:
	// "ssrr" (matched cached rules), "ssar" (incomplete fallback or
	// cluster-scoped resource routed to SSAR), "denied" (no match,
	// complete rules), "error" (check failed).
	Source string `json:"source"`
	// Reason is the denial explanation from the K8s API (SSAR path)
	// or a human-readable "no matching rule" for SSRR denials. Populated
	// when Allowed is false and Source is not "error". Maps to
	// CheckResult.DeniedReason for SSAR results. Used by
	// ClusterResourcesManager to display "Insufficient permissions" or
	// a specific K8s reason string.
	Reason string `json:"reason,omitempty"`
	// Error is set only when the check itself failed (Source "error").
	// Not set for clean denials — use Reason for those.
	Error string `json:"error,omitempty"`
}

// NamespaceDiagnostics reports per-namespace SSRR metadata for diagnostics.
type NamespaceDiagnostics struct {
	Key               string `json:"key"` // "clusterId|namespace" or "clusterId|__cluster__"
	ClusterId         string `json:"clusterId"`
	Namespace         string `json:"namespace,omitempty"` // empty for cluster-scoped SSAR batch
	Method            string `json:"method"`              // "ssrr" or "ssar"
	SSRRIncomplete    bool   `json:"ssrrIncomplete"`      // was the SSRR response incomplete?
	SSRRRuleCount     int    `json:"ssrrRuleCount"`       // number of rules in the SSRR response
	SSARFallbackCount int    `json:"ssarFallbackCount"`   // checks that fell through to SSAR
	CheckCount        int    `json:"checkCount"`          // total checks in this namespace batch
}

// QueryPermissionsResponse wraps per-item results with batch-level
// diagnostics metadata. The frontend reads Diagnostics to populate
// the DiagnosticsPanel without fabricating metadata locally.
type QueryPermissionsResponse struct {
	Results     []PermissionResult     `json:"results"`
	Diagnostics []NamespaceDiagnostics `json:"diagnostics"`
}

// ResultFromQuery creates a PermissionResult pre-populated from a query.
func ResultFromQuery(q PermissionQuery) PermissionResult {
	return PermissionResult{
		ID:           q.ID,
		ClusterId:    q.ClusterId,
		Group:        q.Group,
		Version:      q.Version,
		ResourceKind: q.ResourceKind,
		Verb:         q.Verb,
		Namespace:    q.Namespace,
		Subresource:  q.Subresource,
		Name:         q.Name,
	}
}
