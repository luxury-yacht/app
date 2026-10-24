// Package errorstatus classifies backend errors into the one typed status that
// crosses every backend/frontend boundary, so no layer re-derives an error's
// meaning from its message text.
package errorstatus

// Reason is the precise outcome. Kubernetes status reasons pass through; the
// app reasons cover errors that carry no API status.
type Reason string

const (
	ReasonUnauthorized        Reason = "Unauthorized"
	ReasonForbidden           Reason = "Forbidden"
	ReasonNotFound            Reason = "NotFound"
	ReasonAlreadyExists       Reason = "AlreadyExists"
	ReasonConflict            Reason = "Conflict"
	ReasonGone                Reason = "Gone"
	ReasonInvalid             Reason = "Invalid"
	ReasonBadRequest          Reason = "BadRequest"
	ReasonTimeout             Reason = "Timeout"
	ReasonServerTimeout       Reason = "ServerTimeout"
	ReasonTooManyRequests     Reason = "TooManyRequests"
	ReasonInternalError       Reason = "InternalError"
	ReasonServiceUnavailable  Reason = "ServiceUnavailable"
	ReasonCredentialsRejected Reason = "CredentialsRejected"
	ReasonClusterUnreachable  Reason = "ClusterUnreachable"
	ReasonClusterNotReady     Reason = "ClusterNotReady"
	ReasonRefreshUnavailable  Reason = "RefreshUnavailable"
	ReasonDeadlineExceeded    Reason = "DeadlineExceeded"
	ReasonCanceled            Reason = "Canceled"
	ReasonUnknown             Reason = "Unknown"
)

// Category is the coarse grouping the frontend presents.
type Category string

const (
	CategoryNetwork        Category = "NETWORK"
	CategoryAuthentication Category = "AUTHENTICATION"
	CategoryPermission     Category = "PERMISSION"
	CategoryNotFound       Category = "NOT_FOUND"
	CategoryValidation     Category = "VALIDATION"
	CategoryConflict       Category = "CONFLICT"
	CategoryTimeout        Category = "TIMEOUT"
	CategoryRateLimit      Category = "RATE_LIMIT"
	CategoryServerError    Category = "SERVER_ERROR"
	CategoryUnknown        Category = "UNKNOWN"
)

// ObjectRef is the complete identity of the object whose lookup failed. Only
// the producer that performed that lookup sets it; it is never inferred from
// Kubernetes status details, whose kind is the plural resource.
type ObjectRef struct {
	ClusterID string `json:"clusterId"`
	Group     string `json:"group"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
}

// Details is informational context. Group, Kind and Name are Kubernetes' own
// status details (Kind is the plural resource) and are never compared for
// identity; use Status.Ref for that.
type Details struct {
	Domain   string   `json:"domain,omitempty"`
	Resource string   `json:"resource,omitempty"`
	Group    string   `json:"group,omitempty"`
	Kind     string   `json:"kind,omitempty"`
	Name     string   `json:"name,omitempty"`
	Causes   []string `json:"causes,omitempty"`
}

// Status is the Kubernetes Status-shaped error the frontend reads.
type Status struct {
	Kind       string     `json:"kind"`
	APIVersion string     `json:"apiVersion"`
	Code       int        `json:"code"`
	Reason     Reason     `json:"reason"`
	Category   Category   `json:"category"`
	Message    string     `json:"message"`
	Retryable  bool       `json:"retryable"`
	Expected   bool       `json:"expected"`
	Ref        *ObjectRef `json:"ref,omitempty"`
	Details    *Details   `json:"details,omitempty"`
}

var reasonCategories = map[Reason]Category{
	ReasonUnauthorized:        CategoryAuthentication,
	ReasonCredentialsRejected: CategoryAuthentication,
	ReasonForbidden:           CategoryPermission,
	ReasonNotFound:            CategoryNotFound,
	ReasonAlreadyExists:       CategoryConflict,
	ReasonConflict:            CategoryConflict,
	ReasonGone:                CategoryValidation,
	ReasonInvalid:             CategoryValidation,
	ReasonBadRequest:          CategoryValidation,
	ReasonTimeout:             CategoryTimeout,
	ReasonServerTimeout:       CategoryTimeout,
	ReasonDeadlineExceeded:    CategoryTimeout,
	ReasonTooManyRequests:     CategoryRateLimit,
	ReasonInternalError:       CategoryServerError,
	ReasonServiceUnavailable:  CategoryServerError,
	ReasonClusterNotReady:     CategoryServerError,
	ReasonRefreshUnavailable:  CategoryServerError,
	ReasonClusterUnreachable:  CategoryNetwork,
	ReasonCanceled:            CategoryUnknown,
	ReasonUnknown:             CategoryUnknown,
}

// reasonCodes is the HTTP code for reasons without a Kubernetes status code.
// 499 is the conventional "client closed request" code for cancellation.
var reasonCodes = map[Reason]int{
	ReasonUnauthorized:        401,
	ReasonCredentialsRejected: 401,
	ReasonForbidden:           403,
	ReasonNotFound:            404,
	ReasonAlreadyExists:       409,
	ReasonConflict:            409,
	ReasonGone:                410,
	ReasonInvalid:             422,
	ReasonBadRequest:          400,
	ReasonTooManyRequests:     429,
	ReasonCanceled:            499,
	ReasonInternalError:       500,
	ReasonServerTimeout:       500,
	ReasonUnknown:             500,
	ReasonServiceUnavailable:  503,
	ReasonClusterUnreachable:  503,
	ReasonClusterNotReady:     503,
	ReasonRefreshUnavailable:  503,
	ReasonTimeout:             504,
	ReasonDeadlineExceeded:    504,
}

// withReason sets the reason with its category and default code.
func (s *Status) withReason(reason Reason) {
	s.Reason = reason
	s.Category = reasonCategories[reason]
	s.Code = reasonCodes[reason]
}
