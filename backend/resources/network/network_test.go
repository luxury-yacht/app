/*
 * backend/resources/network/network_test.go
 *
 * Test helpers for network resources.
 * - Provides shared helpers for network tests.
 */

package network

import (
	"context"
	"testing"

	"k8s.io/apimachinery/pkg/util/intstr"
	clientgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func newManager(t testing.TB, client *clientgofake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
	)
	return NewService(deps)
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
