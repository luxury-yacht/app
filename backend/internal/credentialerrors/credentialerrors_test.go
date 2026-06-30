package credentialerrors

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestClassify(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantClass Class
		wantKind  Kind
	}{
		// Missing exec helper (e.g. binary not on PATH).
		{"exec helper not found", errors.New("getting credentials: exec: executable gke-gcloud-auth-plugin not found"), ClassAuth, KindMissingHelper},
		{"go exec lookpath failure", errors.New(`exec: "aws": executable file not found in $PATH`), ClassAuth, KindMissingHelper},

		// Exec helper ran but failed (non-zero exit / plugin error).
		{"aws exec non-zero exit", errors.New("getting credentials: exec: executable aws failed with exit code 255"), ClassAuth, KindHelperFailed},
		{"gcloud exec non-zero exit", errors.New("getting credentials: exec: executable gcloud failed with exit code 1"), ClassAuth, KindHelperFailed},
		{"exec plugin error", errors.New("exec plugin: some error occurred"), ClassAuth, KindHelperFailed},
		{"executable failed", errors.New("executable some-helper failed"), ClassAuth, KindHelperFailed},
		{"generic getting credentials", errors.New("getting credentials: boom"), ClassAuth, KindHelperFailed},

		// Cluster rejected the credentials (structured HTTP 401/403).
		{"structured 401", apierrors.NewUnauthorized("Unauthorized"), ClassAuth, KindRejected},
		{"structured 403", apierrors.NewForbidden(schema.GroupResource{Resource: "nodes"}, "node-1", errors.New("forbidden")), ClassAuth, KindRejected},

		// Cluster rejected the credentials (string patterns).
		{"unauthorized string", errors.New("the server has asked for the client to provide credentials (get pods): Unauthorized"), ClassAuth, KindRejected},
		{"access denied", errors.New("access denied for user"), ClassAuth, KindRejected},
		{"permission denied", errors.New("permission denied"), ClassAuth, KindRejected},
		{"authentication required", errors.New("authentication required"), ClassAuth, KindRejected},

		// Expired credentials.
		{"token has expired", errors.New("token has expired"), ClassAuth, KindExpired},
		{"token is expired", errors.New("the token is expired"), ClassAuth, KindExpired},
		{"sso session expired", errors.New("sso session has expired"), ClassAuth, KindExpired},
		{"refresh token invalid", errors.New("refresh token is invalid"), ClassAuth, KindExpired},

		// Connectivity — says nothing about credential validity.
		{"connection refused", errors.New("dial tcp 10.0.0.1:6443: connect: connection refused"), ClassConnectivity, KindConnectivity},
		{"timeout", errors.New("context deadline exceeded"), ClassConnectivity, KindConnectivity},
		{"dns failure", errors.New("lookup example.com: no such host"), ClassConnectivity, KindConnectivity},

		// Nil error.
		{"nil error", nil, ClassUnknown, KindNone},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Classify(tt.err, Context{})
			require.Equal(t, tt.wantClass, got.Class, "class")
			require.Equal(t, tt.wantKind, got.Kind, "kind")
			if tt.wantClass == ClassUnknown {
				require.Empty(t, got.Summary, "unknown should have no summary")
			} else {
				require.NotEmpty(t, got.Summary, "classified error should have a sanitized summary")
			}
		})
	}
}

// TestClassifyWindowsErrorShapes confirms the classifier handles the error
// strings produced on Windows, where kubeconfig exec helpers run through the
// app's wrapper binary (see backend/exec_wrapper.go) and Go's exec error names
// %PATH% rather than $PATH. Every shape must still classify as auth-class so the
// affected cluster enters auth handling rather than being treated as a network
// blip.
func TestClassifyWindowsErrorShapes(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantClass Class
		wantKind  Kind
	}{
		{
			"helper not found (windows %PATH%)",
			errors.New(`exec: "gke-gcloud-auth-plugin": executable file not found in %PATH%`),
			ClassAuth, KindMissingHelper,
		},
		{
			"wrapped helper non-zero exit (windows)",
			errors.New(`getting credentials: exec: executable C:\Program Files\LuxuryYacht\app.exe failed with exit code 1`),
			ClassAuth, KindHelperFailed,
		},
		{
			"helper .exe non-zero exit (windows)",
			errors.New(`getting credentials: exec: executable aws.exe failed with exit code 255`),
			ClassAuth, KindHelperFailed,
		},
		{
			"wrapped failure carrying not-found stderr (windows)",
			errors.New(`getting credentials: exec: executable app.exe failed with exit code 1: exec: "gke-gcloud-auth-plugin": executable file not found in %PATH%`),
			ClassAuth, KindMissingHelper,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Classify(tt.err, Context{})
			require.True(t, got.IsAuth(), "windows credential error must be auth-class")
			require.Equal(t, tt.wantClass, got.Class, "class")
			require.Equal(t, tt.wantKind, got.Kind, "kind")
		})
	}
}

// TestClassifySummaryIsSanitized proves the summary never echoes raw provider
// stderr — it is a fixed, provider-neutral phrase.
func TestClassifySummaryIsSanitized(t *testing.T) {
	raw := "getting credentials: exec: executable aws failed with exit code 255: SSO token for https://sso.example.com expired"
	got := Classify(errors.New(raw), Context{})
	require.Equal(t, ClassAuth, got.Class)
	require.NotContains(t, got.Summary, "sso.example.com", "summary must not leak raw stderr")
	require.NotContains(t, got.Summary, "exit code", "summary must not leak raw stderr")
}

// TestClassifyExecCommandPassthrough proves the caller-supplied exec command is
// surfaced on the diagnostic (the reliable source; never scraped from the error).
func TestClassifyExecCommandPassthrough(t *testing.T) {
	got := Classify(errors.New("getting credentials: exec: executable gke-gcloud-auth-plugin not found"),
		Context{ExecCommand: "gke-gcloud-auth-plugin"})
	require.Equal(t, "gke-gcloud-auth-plugin", got.ExecCommand)
	require.Equal(t, KindMissingHelper, got.Kind)
}
