package backend

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	kubetesting "k8s.io/client-go/testing"
)

func TestRestartWorkloadAddsRestartAnnotation(t *testing.T) {
	t.Helper()

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo",
			Namespace: "default",
		},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"app": "demo"},
				},
			},
		},
	}

	statefulSet := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo",
			Namespace: "default",
		},
		Spec: appsv1.StatefulSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"app": "demo"},
				},
			},
		},
	}

	daemonSet := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo",
			Namespace: "default",
		},
		Spec: appsv1.DaemonSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"app": "demo"},
				},
			},
		},
	}

	tests := []struct {
		name   string
		kind   string
		object *kubefake.Clientset
		get    func(context.Context, *kubefake.Clientset) (map[string]string, error)
	}{
		{
			name: "deployment",
			kind: "Deployment",
			object: kubefake.NewSimpleClientset(
				deployment.DeepCopy(),
			),
			get: func(ctx context.Context, client *kubefake.Clientset) (map[string]string, error) {
				result, err := client.AppsV1().Deployments("default").Get(ctx, "demo", metav1.GetOptions{})
				if err != nil {
					return nil, err
				}
				return result.Spec.Template.Annotations, nil
			},
		},
		{
			name: "statefulset",
			kind: "StatefulSet",
			object: kubefake.NewSimpleClientset(
				statefulSet.DeepCopy(),
			),
			get: func(ctx context.Context, client *kubefake.Clientset) (map[string]string, error) {
				result, err := client.AppsV1().StatefulSets("default").Get(ctx, "demo", metav1.GetOptions{})
				if err != nil {
					return nil, err
				}
				return result.Spec.Template.Annotations, nil
			},
		},
		{
			name: "daemonset",
			kind: "DaemonSet",
			object: kubefake.NewSimpleClientset(
				daemonSet.DeepCopy(),
			),
			get: func(ctx context.Context, client *kubefake.Clientset) (map[string]string, error) {
				result, err := client.AppsV1().DaemonSets("default").Get(ctx, "demo", metav1.GetOptions{})
				if err != nil {
					return nil, err
				}
				return result.Spec.Template.Annotations, nil
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			app := &App{
				client: tc.object,
				logger: NewLogger(100),
			}

			err := app.RestartWorkload("default", "demo", tc.kind)
			require.NoError(t, err)

			annotations, err := tc.get(context.Background(), tc.object)
			require.NoError(t, err)
			require.NotNil(t, annotations)

			value := annotations[rolloutAnnotation]
			require.NotEmpty(t, value)

			_, err = time.Parse(time.RFC3339, value)
			require.NoError(t, err, "annotation should contain RFC3339 timestamp")
		})
	}
}

func TestRestartWorkloadErrors(t *testing.T) {
	t.Helper()

	app := &App{
		client: kubefake.NewSimpleClientset(),
		logger: NewLogger(10),
	}

	err := app.RestartWorkload("default", "demo", "Job")
	require.EqualError(t, err, `restart not supported for workload kind "Job"`)

	appNilClient := &App{}
	err = appNilClient.RestartWorkload("default", "demo", "Deployment")
	require.EqualError(t, err, "kubernetes client is not initialized")
}

func TestScaleWorkloadUpdatesScaleSubresource(t *testing.T) {
	t.Helper()

	type capture struct {
		replicas int32
		name     string
	}

	tests := []struct {
		name      string
		kind      string
		resource  string
		namespace string
	}{
		{name: "deployment", kind: "Deployment", resource: "deployments"},
		{name: "statefulset", kind: "StatefulSet", resource: "statefulsets"},
		{name: "replicaset", kind: "ReplicaSet", resource: "replicasets"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			client := kubefake.NewSimpleClientset()
			var observed capture
			client.Fake.PrependReactor("update", tc.resource, func(action kubetesting.Action) (handled bool, ret runtime.Object, err error) {
				updateAction, ok := action.(kubetesting.UpdateAction)
				if !ok {
					return false, nil, nil
				}

				if action.GetSubresource() != "scale" {
					return false, nil, nil
				}

				scale, ok := updateAction.GetObject().(*autoscalingv1.Scale)
				require.True(t, ok, "expected autoscalingv1.Scale")
				observed = capture{
					replicas: scale.Spec.Replicas,
					name:     scale.Name,
				}
				return true, scale, nil
			})

			app := &App{
				client: client,
				logger: NewLogger(100),
			}

			err := app.ScaleWorkload("default", "demo", tc.kind, 3)
			require.NoError(t, err)

			require.Equal(t, int32(3), observed.replicas, "expected replicas to be updated")
			require.Equal(t, "demo", observed.name)
		})
	}
}

func TestScaleWorkloadErrors(t *testing.T) {
	t.Helper()

	client := kubefake.NewSimpleClientset()
	app := &App{
		client: client,
		logger: NewLogger(10),
	}

	err := app.ScaleWorkload("default", "demo", "Deployment", -1)
	require.EqualError(t, err, "replicas must be non-negative")

	err = app.ScaleWorkload("default", "demo", "CronJob", 1)
	require.EqualError(t, err, `scaling not supported for workload kind "CronJob"`)

	appNilClient := &App{}
	err = appNilClient.ScaleWorkload("default", "demo", "Deployment", 1)
	require.EqualError(t, err, "kubernetes client is not initialized")
}
