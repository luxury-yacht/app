package namespaces_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/namespaces"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type stubLogger struct{}

func (stubLogger) Debug(string, ...string) {}
func (stubLogger) Info(string, ...string)  {}
func (stubLogger) Warn(string, ...string)  {}
func (stubLogger) Error(string, ...string) {}

func TestServiceNamespaceDetailsIncludesUsage(t *testing.T) {
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-2 * time.Hour)),
			Labels:            map[string]string{"env": "prod"},
		},
		Status: corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}

	quota := &corev1.ResourceQuota{ObjectMeta: metav1.ObjectMeta{Name: "quota", Namespace: "default"}}
	limit := &corev1.LimitRange{ObjectMeta: metav1.ObjectMeta{Name: "limits", Namespace: "default"}}

	deploy := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}}
	job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "job", Namespace: "default"}}

	client := kubefake.NewSimpleClientset(ns.DeepCopy(), quota.DeepCopy(), limit.DeepCopy(), deploy.DeepCopy(), job.DeepCopy())
	service := newNamespaceService(t, client)

	detail, err := service.Namespace("default")
	require.NoError(t, err)
	require.Equal(t, "Namespace", detail.Kind)
	require.True(t, detail.HasWorkloads)
	require.Contains(t, detail.ResourceQuotas, "quota")
	require.Contains(t, detail.LimitRanges, "limits")
}

func TestServiceNamespaceEnsureClientError(t *testing.T) {
	client := kubefake.NewSimpleClientset()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(stubLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error { return fmt.Errorf("ensure fail") }),
	)

	service := namespaces.NewService(namespaces.Dependencies{Common: deps})

	_, err := service.Namespace("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "ensure fail")
}

func TestServiceNamespaceMarksWorkloadsUnknownOnForbidden(t *testing.T) {
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}}
	client := kubefake.NewSimpleClientset(ns)
	client.PrependReactor("list", "deployments", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "apps", Resource: "deployments"}, "deployments", fmt.Errorf("forbidden"))
	})

	service := newNamespaceService(t, client)
	detail, err := service.Namespace("default")
	require.NoError(t, err)
	require.True(t, detail.WorkloadsUnknown)
	require.False(t, detail.HasWorkloads)
}

func newNamespaceService(t testing.TB, client *kubefake.Clientset) *namespaces.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(stubLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return namespaces.NewService(namespaces.Dependencies{Common: deps})
}
