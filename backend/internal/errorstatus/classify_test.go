package errorstatus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation/field"

	"github.com/luxury-yacht/app/backend/internal/authstate"
)

// The expected verdict is the reporting oracle: only application failures
// create Sentry issues. Kubernetes behavior and cluster conditions stay in the
// local log even when the user sees them as errors.
func TestExpectedReportsOnlyApplicationFailures(t *testing.T) {
	pods := schema.GroupResource{Resource: "pods"}
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", want: false},
		{name: "wrapped authentication failure", err: fmt.Errorf("request failed: %w", &authstate.AuthInvalidError{Reason: "credentials rejected"}), want: true},
		{name: "raw structured authentication failure", err: apierrors.NewUnauthorized("credentials rejected"), want: true},
		{name: "structured permission failure", err: apierrors.NewForbidden(pods, "pod-a", errors.New("permission denied")), want: true},
		{name: "wrapped structured not found failure", err: fmt.Errorf("resource fetch failed: %w", apierrors.NewNotFound(pods, "pod-a")), want: true},
		{name: "conflict", err: apierrors.NewConflict(pods, "pod-a", errors.New("the object has been modified")), want: true},
		{name: "already exists", err: apierrors.NewAlreadyExists(pods, "pod-a"), want: true},
		{name: "validation rejection", err: apierrors.NewInvalid(schema.GroupKind{Kind: "Pod"}, "pod-a", nil), want: true},
		{name: "API bad request", err: apierrors.NewBadRequest("container web is not valid for pod pod-a"), want: true},
		{name: "rate limited", err: apierrors.NewTooManyRequests("busy", 1), want: true},
		{name: "wrapped API server error", err: fmt.Errorf("delete: %w", apierrors.NewInternalError(errors.New("webhook failed"))), want: true},
		// client-go's status for a non-Status reply, such as a proxy's HTML 500.
		{name: "unexpected server response", err: apierrors.NewGenericServerResponse(500, "create", schema.GroupResource{Group: "authorization.k8s.io", Resource: "selfsubjectaccessreviews"}, "", "", 0, true), want: true},
		// Only the application shapes a request's verb and media types.
		{name: "method not allowed", err: apierrors.NewMethodNotSupported(pods, "patch"), want: false},
		{name: "not acceptable", err: apierrors.NewGenericServerResponse(406, "get", pods, "", "", 0, false), want: false},
		{name: "unsupported media type", err: apierrors.NewGenericServerResponse(415, "patch", pods, "", "", 0, false), want: false},
		{name: "connection closed mid-reply", err: &url.Error{Op: "Post", URL: "https://cluster.example.test", Err: io.ErrUnexpectedEOF}, want: true},
		{name: "HTTP/2 stream reset by peer", err: &url.Error{Op: "Post", URL: "https://cluster.example.test", Err: errors.New("stream error: stream ID 31135; INTERNAL_ERROR; received from peer")}, want: true},
		{name: "unstructured not found application failure", err: errors.New("cache invariant failed after 404 not found"), want: false},
		{name: "raw credential helper failure", err: errors.New("getting credentials: exec: executable aws failed with exit code 255"), want: true},
		{name: "URL connectivity failure", err: &url.Error{Op: "Get", URL: "https://cluster.example.test", Err: errors.New("connection refused")}, want: true},
		{name: "URL network operation timeout", err: &url.Error{Op: "Get", URL: "https://cluster.example.test", Err: &net.OpError{Op: "dial", Net: "tcp", Err: syntheticNetworkTimeout{}}}, want: true},
		{name: "API server unavailable", err: apierrors.NewServiceUnavailable("cluster temporarily unavailable"), want: true},
		{name: "cancellation", err: context.Canceled, want: true},
		{name: "deadline exceeded", err: context.DeadlineExceeded, want: false},
		{name: "wrapped deadline exceeded", err: fmt.Errorf("resource fetch failed: %w", context.DeadlineExceeded), want: false},
		{name: "URL application failure", err: &url.Error{Op: "Get", URL: "https://cluster.example.test", Err: errors.New("redirect policy rejected")}, want: false},
		{name: "application failure", err: errors.New("invariant violated"), want: false},
		{name: "app permission denial", err: fmt.Errorf("snapshot blocked: %w", NewPermissionDenied("pods", "core/pods")), want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, Expected(tt.err))
		})
	}
}

// The transient verdicts are the retry oracle carried over unchanged from the
// resource fetch retry loop, including the reason logged for each retry.
func TestTransientPreservesRetryVerdicts(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		retryable bool
		reason    string
	}{
		{name: "nil", err: nil},
		{name: "deadline", err: context.DeadlineExceeded, retryable: true, reason: "request timeout"},
		{name: "wrapped deadline", err: fmt.Errorf("fetch: %w", context.DeadlineExceeded), retryable: true, reason: "request timeout"},
		{name: "canceled", err: context.Canceled},
		{name: "net timeout", err: &net.DNSError{IsTimeout: true}, retryable: true, reason: "network timeout"},
		{name: "url timeout", err: &url.Error{Err: &net.DNSError{IsTimeout: true}, Op: "GET", URL: "https://x"}, retryable: true, reason: "network timeout"},
		{name: "url connection refused", err: &url.Error{Err: errors.New("dial tcp: connection refused"), Op: "GET", URL: "https://x"}, retryable: true, reason: "connection refused"},
		{name: "url connection reset", err: &url.Error{Err: errors.New("read: connection reset by peer"), Op: "GET", URL: "https://x"}, retryable: true, reason: "connection reset"},
		{name: "url dns", err: &url.Error{Err: errors.New("lookup x: no such host"), Op: "GET", URL: "https://x"}, retryable: true, reason: "dns lookup failure"},
		{name: "url tls", err: &url.Error{Err: errors.New("remote error: tls handshake failure"), Op: "GET", URL: "https://x"}, retryable: true, reason: "tls handshake"},
		{name: "url redirect policy", err: &url.Error{Err: errors.New("redirect policy rejected"), Op: "GET", URL: "https://x"}},
		{name: "io eof", err: io.EOF, retryable: true, reason: "unexpected eof"},
		{name: "wrapped io eof", err: fmt.Errorf("decode: %w", io.EOF), retryable: true, reason: "unexpected eof"},
		{name: "plain connection refused", err: errors.New("dial tcp: connection refused"), retryable: true, reason: "connection refused"},
		{name: "plain connection reset", err: errors.New("read: connection reset by peer"), retryable: true, reason: "connection reset"},
		{name: "plain dns", err: errors.New("lookup x: no such host"), retryable: true, reason: "no such host"},
		{name: "plain dns server", err: errors.New("lookup x: server misbehaving"), retryable: true, reason: "server misbehaving"},
		{name: "plain io timeout", err: errors.New("read: i/o timeout"), retryable: true, reason: "i/o timeout"},
		{name: "plain tls", err: errors.New("remote error: tls handshake failure"), retryable: true, reason: "tls handshake"},
		{name: "kubernetes timeout", err: apierrors.NewTimeoutError("slow", 1), retryable: true, reason: "kubernetes timeout"},
		{name: "kubernetes server timeout", err: apierrors.NewServerTimeout(schema.GroupResource{Resource: "pods"}, "list", 1), retryable: true, reason: "kubernetes timeout"},
		{name: "api status 500", err: apierrors.NewGenericServerResponse(500, "get", schema.GroupResource{}, "x", "boom", 0, false), retryable: true, reason: "apiserver 500"},
		{name: "api status 503", err: apierrors.NewGenericServerResponse(503, "get", schema.GroupResource{}, "x", "boom", 0, false), retryable: true, reason: "apiserver 503"},
		{name: "too many requests", err: apierrors.NewTooManyRequests("busy", 0), retryable: true, reason: "rate limited"},
		{name: "unauthorized", err: apierrors.NewUnauthorized("login")},
		{name: "forbidden", err: apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "x", errors.New("denied"))},
		{name: "not found", err: apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, "x")},
		{name: "non retryable", err: errors.New("bad")},
		{name: "url error without inner error", err: &url.Error{Op: "GET", URL: "https://x"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			retryable, reason := Transient(tt.err)
			require.Equal(t, tt.retryable, retryable)
			require.Equal(t, tt.reason, reason)
		})
	}
}

func TestClassifyAssignsReasonCategoryAndCode(t *testing.T) {
	pods := schema.GroupResource{Resource: "pods"}
	tests := []struct {
		name     string
		err      error
		reason   Reason
		category Category
		code     int
	}{
		{"unauthorized", apierrors.NewUnauthorized("login"), ReasonUnauthorized, CategoryAuthentication, 401},
		// A Kubernetes 403 is an RBAC denial even though credentialerrors treats
		// it as rejected credentials; the API status is checked first.
		{"forbidden", fmt.Errorf("delete: %w", apierrors.NewForbidden(pods, "web", errors.New("denied"))), ReasonForbidden, CategoryPermission, 403},
		{"app permission denial", NewPermissionDenied("pods", "core/pods"), ReasonForbidden, CategoryPermission, 403},
		{"not found", fmt.Errorf("get: %w", apierrors.NewNotFound(pods, "web")), ReasonNotFound, CategoryNotFound, 404},
		{"conflict", apierrors.NewConflict(pods, "web", errors.New("the object has been modified")), ReasonConflict, CategoryConflict, 409},
		{"already exists", apierrors.NewAlreadyExists(pods, "web"), ReasonAlreadyExists, CategoryConflict, 409},
		{"invalid", apierrors.NewInvalid(schema.GroupKind{Kind: "Pod"}, "web", nil), ReasonInvalid, CategoryValidation, 422},
		{"bad request", apierrors.NewBadRequest("bad"), ReasonBadRequest, CategoryValidation, 400},
		{"expired", apierrors.NewResourceExpired("expired"), ReasonGone, CategoryValidation, 410},
		{"api timeout", apierrors.NewTimeoutError("slow", 1), ReasonTimeout, CategoryTimeout, 504},
		{"too many requests", apierrors.NewTooManyRequests("busy", 0), ReasonTooManyRequests, CategoryRateLimit, 429},
		{"internal error", apierrors.NewInternalError(errors.New("boom")), ReasonInternalError, CategoryServerError, 500},
		{"service unavailable", apierrors.NewServiceUnavailable("down"), ReasonServiceUnavailable, CategoryServerError, 503},
		{"credentials rejected", fmt.Errorf("list: %w", &authstate.AuthInvalidError{Reason: "expired"}), ReasonCredentialsRejected, CategoryAuthentication, 401},
		{"exec helper failure", errors.New("getting credentials: exec: executable aws failed with exit code 255"), ReasonCredentialsRejected, CategoryAuthentication, 401},
		{"connectivity", &url.Error{Op: "Get", URL: "https://x", Err: &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")}}, ReasonClusterUnreachable, CategoryNetwork, 503},
		{"connection closed mid-reply", &url.Error{Op: "Post", URL: "https://x", Err: io.ErrUnexpectedEOF}, ReasonClusterUnreachable, CategoryNetwork, 503},
		{"bare client deadline", fmt.Errorf("fetch: %w", context.DeadlineExceeded), ReasonDeadlineExceeded, CategoryTimeout, 504},
		{"canceled", context.Canceled, ReasonCanceled, CategoryUnknown, 499},
		{"json decode", &json.SyntaxError{}, ReasonBadRequest, CategoryValidation, 400},
		{"url redirect policy", &url.Error{Op: "Get", URL: "https://x", Err: errors.New("redirect policy rejected")}, ReasonUnknown, CategoryUnknown, 500},
		{"unknown", errors.New("invariant violated"), ReasonUnknown, CategoryUnknown, 500},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := Classify(tt.err)
			require.Equal(t, tt.reason, status.Reason)
			require.Equal(t, tt.category, status.Category)
			require.Equal(t, tt.code, status.Code)
			require.Equal(t, "Status", status.Kind)
			require.Equal(t, "v1", status.APIVersion)
			require.Equal(t, tt.err.Error(), status.Message)
			require.Equal(t, Expected(tt.err), status.Expected, "expected must come from the reporting rule")
			retryable, _ := Transient(tt.err)
			require.Equal(t, retryable, status.Retryable, "retryable must come from the retry rule")
		})
	}
}

func TestClassifyCarriesKubernetesDetailsAndCauses(t *testing.T) {
	err := apierrors.NewInvalid(schema.GroupKind{Group: "apps", Kind: "Deployment"}, "web", field.ErrorList{})
	err.ErrStatus.Details.Causes = []metav1.StatusCause{
		{Type: metav1.CauseTypeFieldValueRequired, Field: "spec.template", Message: "Required value"},
	}

	status := Classify(fmt.Errorf("apply: %w", err))

	require.NotNil(t, status.Details)
	require.Equal(t, "apps", status.Details.Group)
	require.Equal(t, "Deployment", status.Details.Kind)
	require.Equal(t, "web", status.Details.Name)
	require.Equal(t, []string{"spec.template: Required value (FieldValueRequired)"}, status.Details.Causes)
	require.Nil(t, status.Ref, "Kubernetes details never become an object reference")
}

func TestClassifyCarriesPermissionDeniedDetails(t *testing.T) {
	status := Classify(WrapPermissionDenied(errors.New("RBAC denied"), "pods", "core/pods"))

	require.Equal(t, ReasonForbidden, status.Reason)
	require.NotNil(t, status.Details)
	require.Equal(t, "pods", status.Details.Domain)
	require.Equal(t, "core/pods", status.Details.Resource)
}

// An explicit status attached at a boundary wins over the wrapped error's own
// classification; the inner error stays in the chain.
func TestExplicitBadRequestOverridesInnerStatus(t *testing.T) {
	inner := apierrors.NewInternalError(errors.New("boom"))
	err := BadRequest(fmt.Errorf("parse scope: %w", inner))

	status := Classify(err)

	require.Equal(t, ReasonBadRequest, status.Reason)
	require.Equal(t, CategoryValidation, status.Category)
	require.Equal(t, 400, status.Code)
	require.False(t, status.Retryable)
	require.False(t, status.Expected)
	require.ErrorIs(t, err, inner)
	require.Equal(t, "parse scope: Internal error occurred: boom", err.Error())
}

type syntheticNetworkTimeout struct{}

func (syntheticNetworkTimeout) Error() string { return "synthetic network timeout" }

func (syntheticNetworkTimeout) Timeout() bool { return true }

func (syntheticNetworkTimeout) Is(target error) bool { return target == context.DeadlineExceeded }

// A boundary's explicit status decides how the frontend treats the failure:
// whether it is shown, reported, retried, or held as warm-up. Each keeps the
// original message and chain.
func TestExplicitStatusesCarryTheirVerdicts(t *testing.T) {
	base := errors.New("underlying failure")
	for _, tt := range []struct {
		name      string
		err       error
		reason    Reason
		code      int
		retryable bool
		expected  bool
	}{
		{"credentials rejected", CredentialsRejected(base), ReasonCredentialsRejected, 401, false, true},
		{"cluster not ready", ClusterNotReady(base), ReasonClusterNotReady, 503, true, true},
		{"refresh unavailable", RefreshUnavailable(base), ReasonRefreshUnavailable, 503, true, true},
		{"not found", NotFound(base), ReasonNotFound, 404, false, true},
		// Keeps its classification, so the user still sees its own message.
		{"cluster outcome", ClusterOutcome(base), ReasonUnknown, 500, false, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			status := Classify(tt.err)

			require.Equal(t, tt.reason, status.Reason)
			require.Equal(t, tt.code, status.Code)
			require.Equal(t, tt.retryable, status.Retryable)
			require.Equal(t, tt.expected, status.Expected)
			require.Equal(t, base.Error(), status.Message)
			require.ErrorIs(t, tt.err, base)
		})
	}
}

// Marking work the cluster did not complete never hides a request only the app
// could have built wrong, including under an action boundary.
func TestClusterOutcomeKeepsRequestShapeRejectionsReportable(t *testing.T) {
	pods := schema.GroupResource{Resource: "pods"}
	target := ObjectRef{ClusterID: "c1", Version: "v1", Kind: "Pod", Namespace: "default", Name: "web"}
	unsupported := fmt.Errorf("warning: Hook pre-delete failed: %w",
		apierrors.NewGenericServerResponse(415, "create", pods, "", "", 0, false))

	require.False(t, Classify(ClusterOutcome(unsupported)).Expected)
	require.False(t, Classify(UserAction(target, ClusterOutcome(unsupported))).Expected)
	// Behind another failure, as when several hooks fail in one run.
	denied := apierrors.NewForbidden(pods, "web", errors.New("quota exceeded"))
	require.False(t, Classify(ClusterOutcome(errors.Join(denied, unsupported))).Expected)
	require.True(t, Classify(ClusterOutcome(errors.Join(denied, errors.New("job failed")))).Expected)
}

// An action's outcome is marked as one, so the UI shows a denial of it that no
// view presents; a denial is the cluster's answer, never reported. A denial
// that does not name its object names the action's target.
func TestUserActionMarksTheActionOutcome(t *testing.T) {
	target := ObjectRef{ClusterID: "c1", Group: "apps", Version: "v1", Kind: "Deployment", Namespace: "default", Name: "web"}
	other := ObjectRef{ClusterID: "c1", Version: "v1", Kind: "Pod", Namespace: "default", Name: "web-0"}
	pods := schema.GroupResource{Resource: "pods"}

	denied := Classify(UserAction(target, apierrors.NewForbidden(pods, "web-0", errors.New("rbac"))))
	require.Equal(t, ReasonForbidden, denied.Reason)
	require.True(t, denied.Expected)
	require.True(t, denied.UserAction)
	require.Equal(t, &target, denied.Ref)

	alreadyNamed := Classify(UserAction(target, Denied(&other, Details{Resource: "pods"}, errors.New("permission denied"))))
	require.Equal(t, &other, alreadyNamed.Ref)
	require.True(t, alreadyNamed.Expected)
	require.True(t, alreadyNamed.UserAction)

	missing := Classify(UserAction(target, apierrors.NewNotFound(pods, "web-0")))
	require.Equal(t, ReasonNotFound, missing.Reason)
	require.True(t, missing.UserAction)
	require.Nil(t, missing.Ref)

	appFailure := Classify(UserAction(target, errors.New("invariant violated")))
	require.False(t, appFailure.Expected)
	require.True(t, appFailure.UserAction)

	require.False(t, Classify(apierrors.NewForbidden(pods, "web-0", errors.New("rbac"))).UserAction)

	require.NoError(t, UserAction(target, nil))
}

func TestObjectNotFoundNamesTheConfirmedObject(t *testing.T) {
	ref := ObjectRef{ClusterID: "c1", Group: "apps", Version: "v1", Kind: "Deployment", Namespace: "default", Name: "web"}
	err := ObjectNotFound(ref, apierrors.NewNotFound(schema.GroupResource{Group: "apps", Resource: "deployments"}, "web"))

	status := Classify(err)

	require.Equal(t, ReasonNotFound, status.Reason)
	require.Equal(t, &ref, status.Ref)
	require.True(t, apierrors.IsNotFound(err))
	require.NoError(t, ObjectNotFound(ref, nil))
}

// An API status with a reason outside Kubernetes' known set is classified by
// its code, so the frontend still gets a meaningful reason.
func TestUnlistedAPIReasonsAreClassifiedByCode(t *testing.T) {
	for _, tt := range []struct {
		code   int32
		reason Reason
	}{
		{401, ReasonUnauthorized},
		{403, ReasonForbidden},
		{404, ReasonNotFound},
		{405, ReasonBadRequest},
		{409, ReasonConflict},
		{429, ReasonTooManyRequests},
		{502, ReasonInternalError},
		{503, ReasonServiceUnavailable},
	} {
		err := &apierrors.StatusError{ErrStatus: metav1.Status{Status: metav1.StatusFailure, Code: tt.code, Reason: "SomethingNew", Message: "odd"}}

		status := Classify(err)

		require.Equal(t, tt.reason, status.Reason, tt.code)
		require.Equal(t, int(tt.code), status.Code, tt.code)
	}
}

// A friendlier message keeps the failure's status behind it.
func TestWithMessageKeepsTheStatus(t *testing.T) {
	denied := apierrors.NewForbidden(schema.GroupResource{Resource: "nodes/proxy"}, "node-a", errors.New("rbac"))
	err := WithMessage("node logs are not accessible with the current permissions", denied)

	status := Classify(err)

	require.Equal(t, ReasonForbidden, status.Reason)
	require.Equal(t, "node logs are not accessible with the current permissions", status.Message)
	require.ErrorIs(t, err, denied)
	require.NoError(t, WithMessage("ignored", nil))
}
