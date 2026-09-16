package errorcapture

import (
	"context"
	"errors"
	"net"
	"net/url"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
	"github.com/luxury-yacht/app/backend/refresh"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// IsExpectedClusterFailure reports whether an error describes an expected
// cluster state rather than an application defect. These failures remain in
// the local application log and user-visible lifecycle state, but must not
// create Sentry issues.
func IsExpectedClusterFailure(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		var requestErr *url.Error
		var operationErr *net.OpError
		if !errors.As(err, &requestErr) && !errors.As(err, &operationErr) {
			return false
		}
	}
	if errors.Is(err, context.Canceled) {
		return true
	}
	if apierrors.IsNotFound(err) || apierrors.IsForbidden(err) || refresh.IsPermissionDenied(err) {
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
