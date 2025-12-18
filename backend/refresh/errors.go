package refresh

import "fmt"

// PermissionDeniedError indicates the current identity lacks RBAC permissions for a domain.
type PermissionDeniedError struct {
	Domain   string
	Resource string
}

// Error implements the error interface.
func (e PermissionDeniedError) Error() string {
	if e.Resource == "" {
		return fmt.Sprintf("permission denied for domain %s", e.Domain)
	}
	return fmt.Sprintf("permission denied for domain %s (%s)", e.Domain, e.Resource)
}

// NewPermissionDeniedError constructs a PermissionDeniedError instance.
func NewPermissionDeniedError(domain, resource string) error {
	return PermissionDeniedError{Domain: domain, Resource: resource}
}

// IsPermissionDenied reports whether the error represents a permission denial.
func IsPermissionDenied(err error) bool {
	_, ok := err.(PermissionDeniedError)
	return ok
}
