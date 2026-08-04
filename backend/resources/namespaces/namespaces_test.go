/*
 * backend/resources/namespaces/namespaces_test.go
 *
 * Tests for Namespace resource handlers.
 * - Covers Namespace resource handlers behavior and edge cases.
 */

package namespaces

import (
	"context"
	"errors"
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
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/luxury-yacht/app/internal/sentry"
)

type recordingNamespaceLogger struct {
	cause     error
	operation sentryreporting.Operation
}

func (*recordingNamespaceLogger) Debug(string, ...string) {}
func (*recordingNamespaceLogger) Info(string, ...string)  {}
func (*recordingNamespaceLogger) Warn(string, ...string)  {}
func (*recordingNamespaceLogger) Error(string, ...string) {}

func (l *recordingNamespaceLogger) ErrorWithCauseAndOperation(
	err error,
	_ string,
	operation sentryreporting.Operation,
	_ ...string,
) {
	l.cause = err
	l.operation = operation
}

func TestHasWorkloadsWithoutClient(t *testing.T) {
	service := NewService(testsupport.NewResourceDependencies())

	has, unknown := service.hasWorkloads("default")
	require.False(t, has)
	require.True(t, unknown)
}

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

	client := fake.NewClientset(ns.DeepCopy(), quota.DeepCopy(), limit.DeepCopy(), deploy.DeepCopy(), job.DeepCopy())
	service := newNamespaceService(t, client)

	detail, err := service.Namespace("default")
	require.NoError(t, err)
	require.Equal(t, "Namespace", detail.Kind)
	require.Equal(t, "Active", detail.Status)
	require.Equal(t, "Active", detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
	require.Equal(t, "status.phase", detail.StatusReason)
	require.True(t, detail.HasWorkloads)
	require.Len(t, detail.ResourceQuotas, 1)
	require.Equal(t, "cluster-a", detail.ResourceQuotas[0].ClusterID)
	require.Equal(t, "", detail.ResourceQuotas[0].Group)
	require.Equal(t, "v1", detail.ResourceQuotas[0].Version)
	require.Equal(t, "ResourceQuota", detail.ResourceQuotas[0].Kind)
	require.Equal(t, "resourcequotas", detail.ResourceQuotas[0].Resource)
	require.Equal(t, "default", detail.ResourceQuotas[0].Namespace)
	require.Equal(t, "quota", detail.ResourceQuotas[0].Name)
	require.Len(t, detail.LimitRanges, 1)
	require.Equal(t, "cluster-a", detail.LimitRanges[0].ClusterID)
	require.Equal(t, "", detail.LimitRanges[0].Group)
	require.Equal(t, "v1", detail.LimitRanges[0].Version)
	require.Equal(t, "LimitRange", detail.LimitRanges[0].Kind)
	require.Equal(t, "limitranges", detail.LimitRanges[0].Resource)
	require.Equal(t, "default", detail.LimitRanges[0].Namespace)
	require.Equal(t, "limits", detail.LimitRanges[0].Name)
}

func TestServiceNamespaceEnsureClientError(t *testing.T) {
	client := fake.NewClientset()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
		testsupport.WithDepsEnsureClient(func(string) error { return fmt.Errorf("ensure fail") }),
	)

	service := NewService(deps)

	_, err := service.Namespace("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "ensure fail")
}

func TestServiceNamespaceMarksWorkloadsUnknownOnForbidden(t *testing.T) {
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}}
	client := fake.NewClientset(ns)
	client.PrependReactor("list", "deployments", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "apps", Resource: "deployments"}, "deployments", fmt.Errorf("forbidden"))
	})

	service := newNamespaceService(t, client)
	detail, err := service.Namespace("default")
	require.NoError(t, err)
	require.True(t, detail.WorkloadsUnknown)
	require.False(t, detail.HasWorkloads)
}

func TestHasWorkloadsReportsEachProbeWithItsActualAPIIdentity(t *testing.T) {
	tests := []struct {
		group    string
		resource string
	}{
		{group: "apps", resource: "deployments"},
		{group: "apps", resource: "statefulsets"},
		{group: "apps", resource: "daemonsets"},
		{group: "batch", resource: "jobs"},
		{group: "batch", resource: "cronjobs"},
		{group: "", resource: "pods"},
	}

	for _, test := range tests {
		t.Run(test.resource, func(t *testing.T) {
			cause := errors.New("probe failed")
			client := fake.NewClientset()
			client.PrependReactor("list", test.resource, func(cgotesting.Action) (bool, runtime.Object, error) {
				return true, nil, cause
			})
			logger := &recordingNamespaceLogger{}
			deps := testsupport.NewResourceDependencies(
				testsupport.WithDepsContext(context.Background()),
				testsupport.WithDepsKubeClient(client),
				testsupport.WithDepsLogger(logger),
			)
			service := NewService(deps)

			has, unknown := service.hasWorkloads("default")

			require.False(t, has)
			require.True(t, unknown)
			require.ErrorIs(t, logger.cause, cause)
			require.Equal(t, sentryreporting.NewKubernetesRequestOperation(sentryreporting.KubernetesRequest{
				Action:   sentryreporting.KubernetesActionList,
				Group:    test.group,
				Version:  "v1",
				Resource: test.resource,
				Scope:    sentryreporting.KubernetesScopeNamespaced,
			}), logger.operation)
		})
	}
}

func newNamespaceService(t testing.TB, client *fake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	deps.ClusterID = "cluster-a"
	deps.ClusterName = "Cluster A"
	return NewService(deps)
}
