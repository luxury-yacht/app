/*
 * backend/resources/common/deps_test.go
 *
 * Tests for Shared dependency bundle for resource services.
 * - Covers Shared dependency bundle for resource services behavior and edge cases.
 */

package common

import (
	"context"
	"fmt"
	"net/url"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/stretchr/testify/require"
)

type testContextKey string

type recordingDepsLogger struct {
	level   string
	message string
	source  []string
}

type recordingStructuredDepsLogger struct {
	recordingDepsLogger
	cause     error
	operation sentryreporting.Operation
}

func (l *recordingStructuredDepsLogger) ErrorWithCause(err error, message string, source ...string) {
	l.cause = err
	l.record("error", message, source...)
}

func (l *recordingStructuredDepsLogger) ErrorWithCauseAndOperation(
	err error,
	message string,
	operation sentryreporting.Operation,
	source ...string,
) {
	l.operation = operation
	l.ErrorWithCause(err, message, source...)
}

func testRequestOperation() sentryreporting.Operation {
	return sentryreporting.NewKubernetesRequestOperation(sentryreporting.KubernetesRequest{
		Action:   sentryreporting.KubernetesActionGet,
		Group:    "apps",
		Version:  "v1",
		Resource: "deployments",
		Scope:    sentryreporting.KubernetesScopeNamespaced,
	})
}

func (l *recordingDepsLogger) record(level, message string, source ...string) {
	l.level = level
	l.message = message
	l.source = source
}

func (l *recordingDepsLogger) Debug(message string, source ...string) {
	l.record("debug", message, source...)
}
func (l *recordingDepsLogger) Info(message string, source ...string) {
	l.record("info", message, source...)
}
func (l *recordingDepsLogger) Warn(message string, source ...string) {
	l.record("warn", message, source...)
}
func (l *recordingDepsLogger) Error(message string, source ...string) {
	l.record("error", message, source...)
}

// A cancelled read is an expected lifecycle event: the panel closed, the user
// navigated away, or the cluster disconnected. Logging it at ERROR forwards it
// to error reporting as though the app had failed.
func TestLogRequestFailureKeepsCancellationOffTheErrorPath(t *testing.T) {
	logger := &recordingDepsLogger{}
	deps := Dependencies{Logger: logger}

	// Shaped like a real client-go failure, which wraps the cause in url.Error.
	cancelled := &url.Error{
		Op:  "Get",
		URL: "https://example.test/apis/apps/v1/deployments/web",
		Err: context.Canceled,
	}

	deps.LogRequestFailure(cancelled, "Failed to get deployment default/web", testRequestOperation(), "ResourceLoader")

	if logger.level != "debug" {
		t.Fatalf("expected cancellation at debug level, got %q (%s)", logger.level, logger.message)
	}
}

func TestLogRequestFailureReportsRealErrors(t *testing.T) {
	logger := &recordingDepsLogger{}
	deps := Dependencies{Logger: logger}

	deps.LogRequestFailure(fmt.Errorf("forbidden"), "Failed to get deployment default/web", testRequestOperation(), "ResourceLoader")

	if logger.level != "error" {
		t.Fatalf("expected error level, got %q", logger.level)
	}
	want := "Failed to get deployment default/web: forbidden"
	if logger.message != want {
		t.Fatalf("expected %q, got %q", want, logger.message)
	}
	if len(logger.source) != 1 || logger.source[0] != "ResourceLoader" {
		t.Fatalf("expected source to be forwarded, got %v", logger.source)
	}
}

func TestLogRequestFailurePreservesOriginalErrorForStructuredLogger(t *testing.T) {
	logger := &recordingStructuredDepsLogger{}
	deps := Dependencies{Logger: logger}
	cause := fmt.Errorf("forbidden")

	operation := testRequestOperation()
	deps.LogRequestFailure(cause, "Failed to get deployment default/web", operation, "ResourceLoader")

	if logger.cause != cause {
		t.Fatalf("expected original cause to be forwarded, got %v", logger.cause)
	}
	if logger.message != "Failed to get deployment default/web" {
		t.Fatalf("expected operation to remain separate, got %q", logger.message)
	}
	require.Equal(t, operation, logger.operation)
}

func TestResourceRequestHelpersBuildStructuredOperations(t *testing.T) {
	logger := &recordingStructuredDepsLogger{}
	deps := Dependencies{Logger: logger}
	identity := resourcekind.Identity{
		Group:      "storage.k8s.io",
		Version:    "v1",
		Resource:   "storageclasses",
		Namespaced: false,
	}

	deps.LogResourceRequestFailure(
		fmt.Errorf("forbidden"),
		"Failed to get storage class customer-prod",
		"get",
		identity,
		"ResourceLoader",
	)

	require.Equal(t, ResourceRequestOperation("get", identity), logger.operation)
}

func TestDynamicRequestHelperBuildsCustomResourceOperation(t *testing.T) {
	logger := &recordingStructuredDepsLogger{}
	deps := Dependencies{Logger: logger}

	deps.LogDynamicResourceRequestFailure(
		fmt.Errorf("forbidden"),
		"Failed to delete DatabaseBackup customer-prod/backup-7",
		"delete",
		"storage.example.com",
		"v1alpha1",
		"databasebackups",
		"status",
		true,
		"GenericResource",
	)

	require.Equal(t, DynamicResourceRequestOperation(
		"delete",
		"storage.example.com",
		"v1alpha1",
		"databasebackups",
		"status",
		true,
	), logger.operation)
}

func TestOperationalFailurePreservesCauseWithoutInventingOperation(t *testing.T) {
	logger := &recordingStructuredDepsLogger{}
	deps := Dependencies{Logger: logger}
	cause := fmt.Errorf("discovery unavailable")

	deps.LogOperationalFailure(cause, "Failed to resolve GVR", "GenericResource")

	require.Same(t, cause, logger.cause)
	require.Equal(t, sentryreporting.Operation{}, logger.operation)
}

func TestLogRequestFailureToleratesNilLogger(t *testing.T) {
	deps := Dependencies{}

	deps.LogRequestFailure(fmt.Errorf("forbidden"), "Failed to get deployment default/web", testRequestOperation(), "ResourceLoader")
}

func TestCloneWithContext(t *testing.T) {
	original := Dependencies{Context: context.Background()}
	newCtx := context.WithValue(context.Background(), testContextKey("k"), "v")

	clone := original.CloneWithContext(newCtx)
	if clone.Context != newCtx {
		t.Fatalf("expected context to be replaced")
	}
	if original.Context == newCtx {
		t.Fatalf("expected original context to remain unchanged")
	}
}

func TestCloneWithContextScopesLoggerToOperation(t *testing.T) {
	logger := &recordingStructuredDepsLogger{}
	ctx := applog.ContextWithOperationID(context.Background(), "snapshot-op-4")

	clone := (Dependencies{Logger: logger}).CloneWithContext(ctx)
	clone.LogRequestFailure(fmt.Errorf("forbidden"), "load pods", testRequestOperation(), "Refresh")

	if got := logger.source; len(got) != 4 || got[3] != "snapshot-op-4" {
		t.Fatalf("expected operation metadata, got %#v", got)
	}
}
