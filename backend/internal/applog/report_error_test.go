package applog

import (
	"errors"
	"testing"

	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/stretchr/testify/require"
)

type recordingStructuredLogger struct {
	recordingLogger
	cause     error
	recovered any
}

type recordingOperationLogger struct {
	recordingStructuredLogger
	operation sentryreporting.Operation
}

func (l *recordingOperationLogger) ErrorWithCauseAndOperation(
	err error,
	message string,
	operation sentryreporting.Operation,
	source ...string,
) {
	l.operation = operation
	l.ErrorWithCause(err, message, source...)
}

func (l *recordingStructuredLogger) ErrorWithCause(err error, message string, source ...string) {
	l.cause = err
	l.message = message
	l.source = append([]string(nil), source...)
}

func (l *recordingStructuredLogger) Panic(recovered any, message string, source ...string) {
	l.recovered = recovered
	l.message = message
	l.source = append([]string(nil), source...)
}

func TestReportErrorPreservesCauseForStructuredLogger(t *testing.T) {
	base := &recordingStructuredLogger{}
	cause := errors.New("forbidden")

	ReportError(base, cause, "load pods", "Refresh")

	require.ErrorIs(t, base.cause, cause)
	require.Equal(t, "load pods", base.message)
	require.Equal(t, []string{"Refresh"}, base.source)
}

func TestReportErrorFallsBackToReadableErrorLog(t *testing.T) {
	base := &recordingLogger{}

	ReportError(base, errors.New("forbidden"), "load pods", "Refresh")

	require.Equal(t, "error", base.method)
	require.Equal(t, "load pods: forbidden", base.message)
	require.Equal(t, []string{"Refresh"}, base.source)
}

func TestReportErrorWithNilLoggerIsNoop(t *testing.T) {
	require.NotPanics(t, func() {
		ReportError(nil, errors.New("forbidden"), "load pods", "Refresh")
	})
}

func TestReportErrorWithOperationPreservesStructuredTelemetry(t *testing.T) {
	logger := &recordingOperationLogger{}
	cause := errors.New("forbidden")
	operation := sentryreporting.NewKubernetesRequestOperation(sentryreporting.KubernetesRequest{
		Action:   sentryreporting.KubernetesActionGet,
		Version:  "v1",
		Resource: "persistentvolumeclaims",
		Scope:    sentryreporting.KubernetesScopeNamespaced,
	})

	ReportErrorWithOperation(logger, cause, "Failed to get PVC customer-prod/database", operation, "ResourceLoader")

	require.Same(t, cause, logger.cause)
	require.Equal(t, operation, logger.operation)
	require.Equal(t, "Failed to get PVC customer-prod/database", logger.message)
}

func TestReportPanicPreservesRecoveredValueForStructuredLogger(t *testing.T) {
	base := &recordingStructuredLogger{}

	ReportPanic(base, "boom", "stream container logs", "ContainerLogs")

	require.Equal(t, "boom", base.recovered)
	require.Equal(t, "stream container logs", base.message)
	require.Equal(t, []string{"ContainerLogs"}, base.source)
}

func TestReportPanicFallsBackToReadableErrorLog(t *testing.T) {
	base := &recordingLogger{}

	ReportPanic(base, "boom", "stream container logs", "ContainerLogs")

	require.Equal(t, "error", base.method)
	require.Equal(t, "stream container logs: boom", base.message)
	require.Equal(t, []string{"ContainerLogs"}, base.source)
}

func TestReportPanicWithNilLoggerIsNoop(t *testing.T) {
	require.NotPanics(t, func() {
		ReportPanic(nil, "boom", "stream container logs", "ContainerLogs")
	})
}
