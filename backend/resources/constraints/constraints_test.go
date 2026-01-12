/*
 * backend/resources/constraints/constraints_test.go
 *
 * Tests for Constraints resource handlers.
 * - Covers Constraints resource handlers behavior and edge cases.
 */

package constraints

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/runtime"
	clientgofake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestConstraintsRequireClient(t *testing.T) {
	svc := NewService(testsupport.NewResourceDependencies())

	_, err := svc.ResourceQuota("default", "rq")
	require.Error(t, err)

	_, err = svc.LimitRange("default", "lr")
	require.Error(t, err)
}

func TestConstraintsListFailures(t *testing.T) {
	client := clientgofake.NewClientset()
	client.PrependReactor("list", "resourcequotas", func(_ k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("rq-list-fail")
	})
	client.PrependReactor("list", "limitranges", func(_ k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("lr-list-fail")
	})

	svc := newConstraintsService(t, client)

	_, err := svc.ResourceQuotas("ns1")
	require.Error(t, err)
	_, err = svc.LimitRanges("ns1")
	require.Error(t, err)
}

func newConstraintsService(t testing.TB, client *clientgofake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return NewService(deps)
}

func resourceMustParse(value string) resource.Quantity {
	return resource.MustParse(value)
}
