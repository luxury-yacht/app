package errorstatus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
)

// Classify derives the status from the error chain alone. An explicit status
// attached at a boundary wins; otherwise app permission denials, Kubernetes API
// statuses, app auth failures, and known transport conditions are recognized in
// that order. Expected and Retryable always come from the reporting and retry
// rules, so a case that differs from its reason's usual value keeps its verdict.
func Classify(err error) Status {
	if err == nil {
		return Status{}
	}
	var explicit *statusError
	if errors.As(err, &explicit) {
		status := Classify(explicit.err)
		status.Message = err.Error()
		explicit.override(&status)
		return status
	}
	retryable, _ := Transient(err)
	status := Status{
		Kind:       "Status",
		APIVersion: "v1",
		Message:    err.Error(),
		Retryable:  retryable,
		Expected:   Expected(err),
	}
	classifyReason(&status, err)
	return status
}

func classifyReason(status *Status, err error) {
	if details, ok := PermissionDeniedOf(err); ok {
		status.withReason(ReasonForbidden)
		status.Details = &Details{Domain: details.Domain, Resource: details.Resource}
		return
	}
	var api apierrors.APIStatus
	if errors.As(err, &api) {
		applyAPIStatus(status, api.Status())
		return
	}
	var authErr *authstate.AuthInvalidError
	if errors.As(err, &authErr) {
		status.withReason(ReasonCredentialsRejected)
		return
	}
	status.withReason(transportReason(err))
}

// transportReason classifies an error that carries no API status.
func transportReason(err error) Reason {
	switch {
	case errors.Is(err, context.Canceled):
		return ReasonCanceled
	case isBareDeadline(err):
		return ReasonDeadlineExceeded
	case isDecodeError(err):
		return ReasonBadRequest
	}
	switch credentialerrors.ClassifyKnown(err, credentialerrors.Context{}).Class {
	case credentialerrors.ClassAuth:
		return ReasonCredentialsRejected
	case credentialerrors.ClassConnectivity:
		return ReasonClusterUnreachable
	}
	return ReasonUnknown
}

func isDecodeError(err error) bool {
	var syntaxErr *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	return errors.As(err, &syntaxErr) || errors.As(err, &typeErr)
}

var apiReasons = map[metav1.StatusReason]Reason{
	metav1.StatusReasonUnauthorized:       ReasonUnauthorized,
	metav1.StatusReasonForbidden:          ReasonForbidden,
	metav1.StatusReasonNotFound:           ReasonNotFound,
	metav1.StatusReasonAlreadyExists:      ReasonAlreadyExists,
	metav1.StatusReasonConflict:           ReasonConflict,
	metav1.StatusReasonGone:               ReasonGone,
	metav1.StatusReasonExpired:            ReasonGone,
	metav1.StatusReasonInvalid:            ReasonInvalid,
	metav1.StatusReasonBadRequest:         ReasonBadRequest,
	metav1.StatusReasonTimeout:            ReasonTimeout,
	metav1.StatusReasonServerTimeout:      ReasonServerTimeout,
	metav1.StatusReasonTooManyRequests:    ReasonTooManyRequests,
	metav1.StatusReasonInternalError:      ReasonInternalError,
	metav1.StatusReasonServiceUnavailable: ReasonServiceUnavailable,
}

// applyAPIStatus copies a Kubernetes status: its reason (or, for an unlisted
// reason, the reason implied by its code), its code, and its details.
func applyAPIStatus(status *Status, api metav1.Status) {
	reason, ok := apiReasons[api.Reason]
	if !ok {
		reason = reasonForCode(int(api.Code))
	}
	status.withReason(reason)
	if api.Code != 0 {
		status.Code = int(api.Code)
	}
	status.Details = apiDetails(api.Details)
}

func reasonForCode(code int) Reason {
	switch {
	case code == 401:
		return ReasonUnauthorized
	case code == 403:
		return ReasonForbidden
	case code == 404:
		return ReasonNotFound
	case code == 409:
		return ReasonConflict
	case code == 429:
		return ReasonTooManyRequests
	case code >= 400 && code < 500:
		return ReasonBadRequest
	case code == 503:
		return ReasonServiceUnavailable
	case code >= 500:
		return ReasonInternalError
	}
	return ReasonUnknown
}

func apiDetails(details *metav1.StatusDetails) *Details {
	if details == nil {
		return nil
	}
	out := &Details{Group: details.Group, Kind: details.Kind, Name: details.Name}
	for _, cause := range details.Causes {
		if formatted := FormatStatusCause(cause); formatted != "" {
			out.Causes = append(out.Causes, formatted)
		}
	}
	return out
}

// FormatStatusCause renders one Kubernetes status cause for display.
func FormatStatusCause(cause metav1.StatusCause) string {
	if cause.Message == "" && cause.Field == "" {
		return ""
	}

	if cause.Type == metav1.CauseTypeFieldManagerConflict {
		switch {
		case cause.Field != "" && cause.Message != "":
			return fmt.Sprintf("%s: %s", cause.Field, cause.Message)
		case cause.Field != "":
			return fmt.Sprintf("%s: owned by another field manager", cause.Field)
		default:
			return cause.Message
		}
	}

	builder := strings.Builder{}
	if cause.Field != "" {
		builder.WriteString(cause.Field)
		builder.WriteString(": ")
	}
	if cause.Message != "" {
		builder.WriteString(cause.Message)
	}
	if cause.Type != "" {
		builder.WriteString(fmt.Sprintf(" (%s)", cause.Type))
	}
	return builder.String()
}

// statusError attaches an explicit status decision to an error without
// changing its message or chain.
type statusError struct {
	err      error
	override func(*Status)
}

func (e *statusError) Error() string { return e.err.Error() }

func (e *statusError) Unwrap() error { return e.err }

// Denied marks err as an RBAC denial of one operation. details names the
// resource; ref is set only when the operation targets one concrete object.
func Denied(ref *ObjectRef, details Details, err error) error {
	if err == nil {
		return nil
	}
	return &statusError{err: err, override: func(status *Status) {
		status.withReason(ReasonForbidden)
		status.Ref = ref
		status.Details = &details
		status.Retryable = false
		status.Expected = true
	}}
}

// UserAction marks err as the outcome of a permission-gated user action on
// ref. The UI offers an action only after its permission gate allows it, so a
// Forbidden here means the gate and the server disagree: it is reported, and
// names the target when the error does not already.
func UserAction(ref ObjectRef, err error) error {
	if err == nil {
		return nil
	}
	return &statusError{err: err, override: func(status *Status) {
		if status.Reason != ReasonForbidden {
			return
		}
		status.Expected = false
		if status.Ref == nil {
			target := ref
			status.Ref = &target
		}
	}}
}

// CredentialsRejected marks err as a request blocked because the cluster's
// credentials are invalid; the auth overlay owns that state.
func CredentialsRejected(err error) error {
	return withExplicitReason(err, ReasonCredentialsRejected, false, true)
}

// ClusterNotReady marks err as a request for a cluster with no active client or
// refresh subsystem yet.
func ClusterNotReady(err error) error {
	return withExplicitReason(err, ReasonClusterNotReady, true, true)
}

// RefreshUnavailable marks err as a refresh request made before the refresh
// service was published.
func RefreshUnavailable(err error) error {
	return withExplicitReason(err, ReasonRefreshUnavailable, true, true)
}

func withExplicitReason(err error, reason Reason, retryable, expected bool) error {
	if err == nil {
		return nil
	}
	return &statusError{err: err, override: func(status *Status) {
		status.withReason(reason)
		status.Details = nil
		status.Retryable = retryable
		status.Expected = expected
	}}
}

// BadRequest marks err as a rejected request: the caller sent arguments the
// boundary will not accept. Use it where a binding or HTTP handler validates
// its own input.
func BadRequest(err error) error {
	return withExplicitReason(err, ReasonBadRequest, false, false)
}

// NotFound marks err as a lookup of something that does not exist, for errors
// that carry no Kubernetes status.
func NotFound(err error) error {
	return withExplicitReason(err, ReasonNotFound, false, true)
}

// ObjectNotFound marks err as the confirmed absence of the object ref names.
// Only the producer that looked that exact object up may attach ref.
func ObjectNotFound(ref ObjectRef, err error) error {
	if err == nil {
		return nil
	}
	return &statusError{err: err, override: func(status *Status) {
		status.withReason(ReasonNotFound)
		status.Ref = &ref
	}}
}

// WithMessage replaces err's message for display and keeps err, with its
// status, in the chain.
func WithMessage(message string, err error) error {
	if err == nil {
		return nil
	}
	return &messageError{message: message, err: err}
}

type messageError struct {
	message string
	err     error
}

func (e *messageError) Error() string { return e.message }

func (e *messageError) Unwrap() error { return e.err }
