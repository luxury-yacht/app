package containerlogsstream

import (
	"errors"
	"net"
	"testing"

	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

// A fatal log-stream error says whether reconnecting can help: a missing
// target, a denial or a rejected request stays failed; anything else, even an
// error nothing classifies, reconnects.
func TestFatalErrorsSayWhetherReconnectingCanHelp(t *testing.T) {
	pods := schema.GroupResource{Resource: "pods"}
	for _, tt := range []struct {
		name      string
		err       error
		reason    errorstatus.Reason
		reconnect bool
	}{
		{name: "deleted target", err: apierrors.NewNotFound(pods, "web"), reason: errorstatus.ReasonNotFound},
		{name: "denied", err: apierrors.NewForbidden(pods, "", errors.New("rbac")), reason: errorstatus.ReasonForbidden},
		{name: "rejected request", err: apierrors.NewBadRequest("previous terminated container not found"), reason: errorstatus.ReasonBadRequest},
		{name: "invalid request", err: apierrors.NewInvalid(schema.GroupKind{Kind: "Pod"}, "web", nil), reason: errorstatus.ReasonInvalid},
		{name: "apiserver restarting", err: apierrors.NewServiceUnavailable("restarting"), reason: errorstatus.ReasonServiceUnavailable, reconnect: true},
		{name: "apiserver failure", err: apierrors.NewInternalError(errors.New("boom")), reason: errorstatus.ReasonInternalError, reconnect: true},
		{name: "apiserver timeout", err: apierrors.NewTimeoutError("slow", 1), reason: errorstatus.ReasonTimeout, reconnect: true},
		{name: "connection lost", err: &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")}, reason: errorstatus.ReasonClusterUnreachable, reconnect: true},
		{name: "unclassified", err: errors.New("follower exploded"), reason: errorstatus.ReasonUnknown, reconnect: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			payload := failurePayload(tt.err)

			require.Equal(t, tt.err.Error(), payload.Error)
			require.NotNil(t, payload.ErrorDetails)
			require.Equal(t, tt.reason, payload.ErrorDetails.Reason)
			require.Equal(t, tt.reconnect, payload.Reconnect)
		})
	}
}

// Reconnecting is the stream's own decision, separate from whether the same
// request may succeed later: an unclassified error is not retryable, yet the
// stream reconnects.
func TestUnclassifiedFatalReconnectsThoughNotRetryable(t *testing.T) {
	payload := failurePayload(errors.New("follower exploded"))

	require.False(t, payload.ErrorDetails.Retryable)
	require.True(t, payload.Reconnect)
}
