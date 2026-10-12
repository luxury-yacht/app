package errorstatus

import (
	"context"
	"errors"
	"net"
	"net/url"

	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
)

// Expected reports whether an error describes an expected cluster state rather
// than an application defect. These failures remain in the local application
// log and user-visible lifecycle state, but must not create Sentry issues.
func Expected(err error) bool {
	if err == nil {
		return false
	}
	if isBareDeadline(err) {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return true
	}
	if apierrors.IsNotFound(err) || apierrors.IsForbidden(err) || IsPermissionDenied(err) {
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
