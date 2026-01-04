package refresh

import (
	"errors"
	"fmt"
	"net/http"
)

// PermissionDeniedError indicates the current identity lacks RBAC permissions for a domain.
type PermissionDeniedError struct {
	Domain   string
	Resource string
}

// PermissionDeniedDetails captures domain/resource metadata for permission errors.
type PermissionDeniedDetails struct {
	Domain   string `json:"domain,omitempty"`
	Resource string `json:"resource,omitempty"`
}

// PermissionDeniedDetailsProvider exposes permission metadata for structured error responses.
type PermissionDeniedDetailsProvider interface {
	error
	PermissionDeniedDetails() PermissionDeniedDetails
}

// Error implements the error interface.
func (e PermissionDeniedError) Error() string {
	if e.Resource == "" {
		return fmt.Sprintf("permission denied for domain %s", e.Domain)
	}
	return fmt.Sprintf("permission denied for domain %s (%s)", e.Domain, e.Resource)
}

// PermissionDeniedDetails exposes the domain/resource metadata for structured responses.
func (e PermissionDeniedError) PermissionDeniedDetails() PermissionDeniedDetails {
	return PermissionDeniedDetails(e)
}

// NewPermissionDeniedError constructs a PermissionDeniedError instance.
func NewPermissionDeniedError(domain, resource string) error {
	return PermissionDeniedError{Domain: domain, Resource: resource}
}

// IsPermissionDenied reports whether the error represents a permission denial.
func IsPermissionDenied(err error) bool {
	_, ok := permissionDeniedDetails(err)
	return ok
}

// PermissionDeniedStatus is a Status-like payload for permission-denied responses.
type PermissionDeniedStatus struct {
	Kind       string                  `json:"kind"`
	APIVersion string                  `json:"apiVersion"`
	Message    string                  `json:"message"`
	Reason     string                  `json:"reason"`
	Details    PermissionDeniedDetails `json:"details,omitempty"`
	Code       int                     `json:"code"`
}

// PermissionDeniedStatusFromError converts a permission error into a structured status payload.
func PermissionDeniedStatusFromError(err error) (*PermissionDeniedStatus, bool) {
	details, ok := permissionDeniedDetails(err)
	if !ok {
		return nil, false
	}
	status := &PermissionDeniedStatus{
		Kind:       "Status",
		APIVersion: "v1",
		Message:    err.Error(),
		Reason:     "Forbidden",
		Details:    details,
		Code:       http.StatusForbidden,
	}
	return status, true
}

func permissionDeniedDetails(err error) (PermissionDeniedDetails, bool) {
	if err == nil {
		return PermissionDeniedDetails{}, false
	}
	var provider PermissionDeniedDetailsProvider
	if errors.As(err, &provider) {
		return provider.PermissionDeniedDetails(), true
	}
	return PermissionDeniedDetails{}, false
}
