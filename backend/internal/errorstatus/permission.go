package errorstatus

import (
	"errors"
	"fmt"
)

// PermissionDeniedDetails names the refresh domain and resource the current
// identity may not read.
type PermissionDeniedDetails struct {
	Domain   string `json:"domain,omitempty"`
	Resource string `json:"resource,omitempty"`
}

// permissionDeniedProvider is implemented by every app permission-denied error.
type permissionDeniedProvider interface {
	error
	PermissionDeniedDetails() PermissionDeniedDetails
}

// PermissionDeniedError indicates the current identity lacks RBAC permissions for a domain.
type PermissionDeniedError struct {
	Domain   string
	Resource string
}

func (e PermissionDeniedError) Error() string {
	if e.Resource == "" {
		return fmt.Sprintf("permission denied for domain %s", e.Domain)
	}
	return fmt.Sprintf("permission denied for domain %s (%s)", e.Domain, e.Resource)
}

func (e PermissionDeniedError) PermissionDeniedDetails() PermissionDeniedDetails {
	return PermissionDeniedDetails(e)
}

// NewPermissionDenied constructs a permission-denied error for a domain.
func NewPermissionDenied(domain, resource string) error {
	return PermissionDeniedError{Domain: domain, Resource: resource}
}

// WrapPermissionDenied attaches permission details to err without changing its
// message or chain.
func WrapPermissionDenied(err error, domain, resource string) error {
	if err == nil {
		return nil
	}
	return permissionDeniedWrapper{err: err, details: PermissionDeniedDetails{Domain: domain, Resource: resource}}
}

// IsPermissionDenied reports whether err is an app permission denial.
func IsPermissionDenied(err error) bool {
	_, ok := PermissionDeniedOf(err)
	return ok
}

// PermissionDeniedOf returns the permission details carried by err, if any.
func PermissionDeniedOf(err error) (PermissionDeniedDetails, bool) {
	var provider permissionDeniedProvider
	if err != nil && errors.As(err, &provider) {
		return provider.PermissionDeniedDetails(), true
	}
	return PermissionDeniedDetails{}, false
}

type permissionDeniedWrapper struct {
	err     error
	details PermissionDeniedDetails
}

func (w permissionDeniedWrapper) Error() string { return w.err.Error() }

func (w permissionDeniedWrapper) Unwrap() error { return w.err }

func (w permissionDeniedWrapper) PermissionDeniedDetails() PermissionDeniedDetails {
	return w.details
}
