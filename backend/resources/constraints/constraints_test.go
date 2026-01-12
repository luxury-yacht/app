package constraints

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/testsupport"
)

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

func TestConstraintsRequireClient(t *testing.T) {
	svc := NewService(Dependencies{Common: testsupport.NewResourceDependencies()})

	_, err := svc.ResourceQuota("default", "rq")
	require.Error(t, err)

	_, err = svc.LimitRange("default", "lr")
	require.Error(t, err)
}

func TestConstraintsListFailures(t *testing.T) {
	client := kubefake.NewClientset()
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

func newConstraintsService(t testing.TB, client *kubefake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(noopLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return NewService(Dependencies{Common: deps})
}

func resourceMustParse(value string) resource.Quantity {
	return resource.MustParse(value)
}
