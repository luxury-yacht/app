package errorstatus

import (
	"context"
	"errors"
	"net"
	"net/url"
	"slices"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
)

// Expected reports whether an error describes Kubernetes behavior or a cluster
// condition rather than an application defect. These failures remain in the
// local application log and user-visible state, even when the user sees them
// as errors, but must not create Sentry issues.
func Expected(err error) bool {
	if err == nil {
		return false
	}
	if isBareDeadline(err) || isRequestShapeRejection(err) {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return true
	}
	if isKubernetesAnswer(err) || IsPermissionDenied(err) {
		return true
	}

	var authErr *authstate.AuthInvalidError
	if errors.As(err, &authErr) {
		return true
	}
	diagnostic := credentialerrors.ClassifyKnown(err, credentialerrors.Context{})
	return diagnostic.Class == credentialerrors.ClassAuth ||
		diagnostic.Class == credentialerrors.ClassConnectivity
}

// requestShapeReasons are the API answers that reject how a request was built
// (its verb or media types), which only application code decides.
var requestShapeReasons = map[metav1.StatusReason]bool{
	metav1.StatusReasonMethodNotAllowed:     true,
	metav1.StatusReasonNotAcceptable:        true,
	metav1.StatusReasonUnsupportedMediaType: true,
}

// isKubernetesAnswer reports an API server's status reply: a denial, conflict,
// validation, quota or admission rejection, or the server's own failure. Each
// is Kubernetes behavior; Expected rules out a rejection of the request's
// shape first.
func isKubernetesAnswer(err error) bool {
	var api apierrors.APIStatus
	return errors.As(err, &api)
}

// isRequestShapeRejection reports an API status anywhere in err's chain that
// rejects how the request was built. It follows every branch of a joined
// error, where errors.As would stop at the first status, because such a
// rejection is an app failure whatever accompanies it, even inside work
// marked a cluster outcome.
func isRequestShapeRejection(err error) bool {
	if err == nil {
		return false
	}
	if api, ok := err.(apierrors.APIStatus); ok && requestShapeReasons[api.Status().Reason] {
		return true
	}
	switch wrapped := err.(type) {
	case interface{ Unwrap() []error }:
		return slices.ContainsFunc(wrapped.Unwrap(), isRequestShapeRejection)
	case interface{ Unwrap() error }:
		return isRequestShapeRejection(wrapped.Unwrap())
	}
	return false
}

// isBareDeadline reports a client-side deadline that is not a transport
// failure. It stays reportable: a deadline with no request or network error
// behind it is an application timing defect, not a cluster condition.
func isBareDeadline(err error) bool {
	if !errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var requestErr *url.Error
	var operationErr *net.OpError
	return !errors.As(err, &requestErr) && !errors.As(err, &operationErr)
}
