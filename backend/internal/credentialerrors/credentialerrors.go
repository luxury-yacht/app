// Package credentialerrors classifies Kubernetes client errors into a typed
// diagnostic that distinguishes credential/auth failures from connectivity
// failures. It centralizes logic that was previously duplicated (and divergent)
// across cluster client setup, the auth transport, and heartbeat health checks.
package credentialerrors

import (
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// Class is the high-level verdict used to gate auth state. Auth-class failures
// prove the cluster rejected the credentials (or the credential plugin failed)
// and should drive auth-failure handling; connectivity-class failures say
// nothing about credential validity and should keep the recovery loop probing.
type Class string

const (
	// ClassUnknown is returned only for a nil error.
	ClassUnknown Class = ""
	// ClassAuth means the credentials were rejected or the credential plugin failed.
	ClassAuth Class = "auth"
	// ClassConnectivity means the cluster could not be reached.
	ClassConnectivity Class = "connectivity"
)

// Kind is a finer classification used for richer, provider-neutral diagnostics.
type Kind string

const (
	// KindNone is returned for a nil error.
	KindNone Kind = ""
	// KindMissingHelper means a kubeconfig exec credential helper was not found.
	KindMissingHelper Kind = "missing-helper"
	// KindHelperFailed means a kubeconfig exec credential helper ran but failed.
	KindHelperFailed Kind = "helper-failed"
	// KindExpired means the credentials (token/SSO session) have expired.
	KindExpired Kind = "expired-credentials"
	// KindRejected means the cluster rejected the credentials (HTTP 401/403).
	KindRejected Kind = "rejected"
	// KindConnectivity means the cluster could not be reached.
	KindConnectivity Kind = "connectivity"
)

// Context carries optional, caller-supplied facts that the error string cannot
// reliably provide. ExecCommand is the kubeconfig exec credential command, read
// from rest.Config.ExecProvider at config-construction time (never scraped from
// the error string).
type Context struct {
	ExecCommand string
}

// Diagnostic is the typed result of classifying a credential/connectivity error.
// Summary is a sanitized, provider-neutral, UI-safe phrase; it never echoes raw
// provider stderr.
type Diagnostic struct {
	Class       Class
	Kind        Kind
	Summary     string
	ExecCommand string
}

// IsAuth reports whether the diagnostic is an auth-class failure.
func (d Diagnostic) IsAuth() bool { return d.Class == ClassAuth }

// Provider-neutral, sanitized summaries. These never echo raw provider stderr;
// any provider-specific detail belongs on a dedicated diagnostics surface.
const (
	summaryMissingHelper = "The kubeconfig's credential helper could not be found."
	summaryHelperFailed  = "The kubeconfig's credential helper failed to run."
	summaryExpired       = "The cluster credentials have expired."
	summaryRejected      = "The cluster rejected the credentials."
	summaryConnectivity  = "The cluster could not be reached."
)

// Classify maps an error (and optional context) to a typed Diagnostic.
//
// The pattern set is the union of the three classifiers it replaces, so every
// input that any of them previously treated as a credential failure stays
// auth-class. The order of checks matters: a "not found" exec error is reported
// as a missing helper before the more general helper-failed bucket.
func Classify(err error, ctx Context) Diagnostic {
	d := Diagnostic{ExecCommand: strings.TrimSpace(ctx.ExecCommand)}
	if err == nil {
		return d
	}

	// Structured HTTP 401/403 prove the cluster rejected the credentials. This
	// runs before string matching so it is robust to message wording.
	if apierrors.IsUnauthorized(err) || apierrors.IsForbidden(err) {
		d.Class, d.Kind, d.Summary = ClassAuth, KindRejected, summaryRejected
		return d
	}

	msg := strings.ToLower(err.Error())
	switch {
	case isMissingHelper(msg):
		d.Class, d.Kind, d.Summary = ClassAuth, KindMissingHelper, summaryMissingHelper
	case isHelperFailed(msg):
		d.Class, d.Kind, d.Summary = ClassAuth, KindHelperFailed, summaryHelperFailed
	case isExpired(msg):
		d.Class, d.Kind, d.Summary = ClassAuth, KindExpired, summaryExpired
	case isRejected(msg):
		d.Class, d.Kind, d.Summary = ClassAuth, KindRejected, summaryRejected
	default:
		d.Class, d.Kind, d.Summary = ClassConnectivity, KindConnectivity, summaryConnectivity
	}
	return d
}

// isMissingHelper reports an exec credential helper that could not be located.
func isMissingHelper(msg string) bool {
	missing := strings.Contains(msg, "not found") || strings.Contains(msg, "no such file")
	return missing && (strings.Contains(msg, "exec") || strings.Contains(msg, "executable"))
}

// isHelperFailed reports an exec credential helper that ran but did not succeed.
func isHelperFailed(msg string) bool {
	return strings.Contains(msg, "getting credentials") ||
		strings.Contains(msg, "exec: executable") ||
		strings.Contains(msg, "failed with exit code") ||
		strings.Contains(msg, "exec plugin") ||
		(strings.Contains(msg, "executable") && strings.Contains(msg, "failed"))
}

// isExpired reports credentials (token or SSO session) that have expired.
func isExpired(msg string) bool {
	return strings.Contains(msg, "token has expired") ||
		strings.Contains(msg, "token is expired") ||
		strings.Contains(msg, "sso session") ||
		strings.Contains(msg, "refresh token")
}

// isRejected reports credentials the cluster refused (by string, e.g. an
// unstructured 401/403 or a provider authorization message).
func isRejected(msg string) bool {
	return strings.Contains(msg, "authentication required") ||
		strings.Contains(msg, "unauthorized") ||
		strings.Contains(msg, "access denied") ||
		strings.Contains(msg, "permission denied")
}
