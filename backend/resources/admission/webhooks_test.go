package admission

import (
	"context"
	"testing"

	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func newAdmissionService(t testing.TB, objects ...runtime.Object) *Service {
	t.Helper()

	runtimeObjects := make([]runtime.Object, len(objects))
	for i, obj := range objects {
		runtimeObjects[i] = obj.DeepCopyObject()
	}

	client := kubefake.NewClientset(runtimeObjects...)
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return NewService(deps)
}

func ptrToInt32(value int32) *int32 {
	return &value
}

func ptrToString(value string) *string {
	return &value
}

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
