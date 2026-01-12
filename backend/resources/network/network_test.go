package network

import (
	"context"
	"testing"

	"k8s.io/apimachinery/pkg/util/intstr"
	kubefake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/testsupport"
)

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

func newManager(t testing.TB, client *kubefake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(noopLogger{}),
	)
	return NewService(Dependencies{Common: deps})
}

func ptrToInt32(v int32) *int32 {
	return &v
}

func ptrToString(s string) *string {
	return &s
}

func intstrFromInt(v int) intstr.IntOrString {
	return intstr.FromInt(v)
}
