package errorcapture

import (
	"context"
	"errors"
	"net"

	"github.com/luxury-yacht/app/backend/internal/authstate"
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
	if errors.Is(err, context.Canceled) {
		return true
	}

	var authErr *authstate.AuthInvalidError
	if errors.As(err, &authErr) {
		return true
	}
	if apierrors.IsServiceUnavailable(err) || apierrors.IsTimeout(err) || apierrors.IsServerTimeout(err) {
		return true
	}

	var networkErr net.Error
	return errors.As(err, &networkErr)
}
