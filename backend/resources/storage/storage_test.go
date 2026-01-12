package storage

import (
	"context"
	"testing"

	kubefake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/testsupport"
)

type logEntry struct {
	level   string
	message string
}

type capturingLogger struct {
	entries []logEntry
}

func (l *capturingLogger) Debug(msg string, source ...string) {
	l.entries = append(l.entries, logEntry{level: "DEBUG", message: msg})
}

func (l *capturingLogger) Info(msg string, source ...string) {
	l.entries = append(l.entries, logEntry{level: "INFO", message: msg})
}

func (l *capturingLogger) Warn(msg string, source ...string) {
	l.entries = append(l.entries, logEntry{level: "WARN", message: msg})
}

func (l *capturingLogger) Error(msg string, source ...string) {
	l.entries = append(l.entries, logEntry{level: "ERROR", message: msg})
}

func newStorageService(t testing.TB, client *kubefake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
	)
	return NewService(Dependencies{Common: deps})
}
