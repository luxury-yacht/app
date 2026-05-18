package backend

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	cgofake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

const workloadClusterID = "config:ctx"

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
		object *cgofake.Clientset
		get    func(context.Context, *cgofake.Clientset) (map[string]string, error)
	}{
		{
			name: "deployment",
			kind: "Deployment",
			object: cgofake.NewClientset(
				deployment.DeepCopy(),
			),
			get: func(ctx context.Context, client *cgofake.Clientset) (map[string]string, error) {
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
			object: cgofake.NewClientset(
				statefulSet.DeepCopy(),
			),
			get: func(ctx context.Context, client *cgofake.Clientset) (map[string]string, error) {
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
			object: cgofake.NewClientset(
				daemonSet.DeepCopy(),
			),
			get: func(ctx context.Context, client *cgofake.Clientset) (map[string]string, error) {
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
			allowSelfSubjectAccessReviews(tc.object)

			// Per-cluster clients are stored in clusterClients, not in global fields.
			app := &App{
				logger:        NewLogger(100),
				responseCache: newResponseCache(time.Minute, 10),
			}
			app.clusterClients = map[string]*clusterClients{
				workloadClusterID: {
					meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
					kubeconfigPath:    "/path",
					kubeconfigContext: "ctx",
					client:            tc.object,
				},
			}
			detailKey := objectDetailCacheKey(tc.kind, "default", "demo")
			app.responseCacheStore(workloadClusterID, detailKey, "stale")

			err := app.restartWorkload(workloadClusterID, "default", "apps", "v1", tc.kind, "demo")
			require.NoError(t, err)
			_, cached := app.responseCacheLookup(workloadClusterID, detailKey)
			require.False(t, cached, "expected workload detail cache to be evicted after restart")

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

	// Per-cluster clients are stored in clusterClients, not in global fields.
	fakeClient := cgofake.NewClientset()
	allowSelfSubjectAccessReviews(fakeClient)
	app := &App{
		logger: NewLogger(10),
	}
	app.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
		},
	}

	err := app.restartWorkload(workloadClusterID, "default", "batch", "v1", "Job", "demo")
	require.EqualError(t, err, `restart not supported for workload kind "Job"`)

	appNilClient := &App{}
	appNilClient.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}
	err = appNilClient.restartWorkload(workloadClusterID, "default", "apps", "v1", "Deployment", "demo")
	require.EqualError(t, err, "kubernetes client is not initialized")
}

func TestWorkloadActionsRequireNamespacedObjectIdentity(t *testing.T) {
	app := NewApp()

	require.EqualError(t,
		app.restartWorkload("", "", "apps", "v1", "Deployment", "demo"),
		"namespace is required",
	)
	require.EqualError(t,
		app.restartWorkload("", "default", "apps", "v1", "Deployment", ""),
		"name is required",
	)
	require.EqualError(t,
		app.scaleWorkload("", "", "apps", "v1", "Deployment", "demo", 1),
		"namespace is required",
	)
	require.EqualError(t,
		app.scaleWorkload("", "default", "apps", "v1", "Deployment", "", 1),
		"name is required",
	)

	_, err := app.triggerCronJob("", "", "backup")
	require.EqualError(t, err, "namespace is required")
	_, err = app.triggerCronJob("", "default", "")
	require.EqualError(t, err, "name is required")

	require.EqualError(t, app.suspendCronJob("", "", "backup", true), "namespace is required")
	require.EqualError(t, app.suspendCronJob("", "default", "", true), "name is required")
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

			client := cgofake.NewClientset()
			allowSelfSubjectAccessReviews(client)
			var observed capture
			client.Fake.PrependReactor("update", tc.resource, func(action cgotesting.Action) (handled bool, ret runtime.Object, err error) {
				updateAction, ok := action.(cgotesting.UpdateAction)
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

			// Per-cluster clients are stored in clusterClients, not in global fields.
			app := &App{
				logger:        NewLogger(100),
				responseCache: newResponseCache(time.Minute, 10),
			}
			app.clusterClients = map[string]*clusterClients{
				workloadClusterID: {
					meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
					kubeconfigPath:    "/path",
					kubeconfigContext: "ctx",
					client:            client,
				},
			}
			detailKey := objectDetailCacheKey(tc.kind, "default", "demo")
			app.responseCacheStore(workloadClusterID, detailKey, "stale")

			err := app.scaleWorkload(workloadClusterID, "default", "apps", "v1", tc.kind, "demo", 3)
			require.NoError(t, err)
			_, cached := app.responseCacheLookup(workloadClusterID, detailKey)
			require.False(t, cached, "expected workload detail cache to be evicted after scale")

			require.Equal(t, int32(3), observed.replicas, "expected replicas to be updated")
			require.Equal(t, "demo", observed.name)
		})
	}
}

func TestScaleWorkloadErrors(t *testing.T) {
	t.Helper()

	// Per-cluster clients are stored in clusterClients, not in global fields.
	client := cgofake.NewClientset()
	allowSelfSubjectAccessReviews(client)
	app := &App{
		logger: NewLogger(10),
	}
	app.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	err := app.scaleWorkload(workloadClusterID, "default", "apps", "v1", "Deployment", "demo", -1)
	require.EqualError(t, err, "replicas must be non-negative")

	if strconv.IntSize > 32 {
		err = app.scaleWorkload(workloadClusterID, "default", "apps", "v1", "Deployment", "demo", maxScaleReplicas+1)
		require.EqualError(t, err, "replicas must be less than or equal to 2147483647")
	}

	err = app.scaleWorkload(workloadClusterID, "default", "batch", "v1", "CronJob", "demo", 1)
	require.EqualError(t, err, `scaling not supported for workload kind "CronJob"`)

	appNilClient := &App{}
	appNilClient.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}
	err = appNilClient.scaleWorkload(workloadClusterID, "default", "apps", "v1", "Deployment", "demo", 1)
	require.EqualError(t, err, "kubernetes client is not initialized")
}

func TestTriggerCronJobCreatesJob(t *testing.T) {
	t.Helper()

	cronJob := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "backup",
			Namespace: "default",
			UID:       "cronjob-uid-123",
		},
		Spec: batchv1.CronJobSpec{
			Schedule: "0 * * * *",
			JobTemplate: batchv1.JobTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"job": "backup"},
				},
				Spec: batchv1.JobSpec{
					Template: corev1.PodTemplateSpec{
						Spec: corev1.PodSpec{
							Containers: []corev1.Container{
								{Name: "backup", Image: "backup:latest"},
							},
							RestartPolicy: corev1.RestartPolicyNever,
						},
					},
				},
			},
		},
	}

	client := cgofake.NewClientset(cronJob)
	allowSelfSubjectAccessReviews(client)
	app := &App{
		logger:        NewLogger(100),
		responseCache: newResponseCache(time.Minute, 10),
	}
	app.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}
	detailKey := objectDetailCacheKey("CronJob", "default", "backup")
	app.responseCacheStore(workloadClusterID, detailKey, "stale")

	jobName, err := app.triggerCronJob(workloadClusterID, "default", "backup")
	require.NoError(t, err)
	_, cached := app.responseCacheLookup(workloadClusterID, detailKey)
	require.False(t, cached, "expected cronjob detail cache to be evicted after manual trigger")
	require.True(t, strings.HasPrefix(jobName, "backup-manual-"), "job name should have manual prefix")

	// Verify the job was created
	createdJob, err := client.BatchV1().Jobs("default").Get(context.Background(), jobName, metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, createdJob)

	// Verify owner reference
	require.Len(t, createdJob.OwnerReferences, 1)
	require.Equal(t, "CronJob", createdJob.OwnerReferences[0].Kind)
	require.Equal(t, "backup", createdJob.OwnerReferences[0].Name)

	// Verify annotation
	require.Equal(t, "manual", createdJob.Annotations["cronjob.kubernetes.io/instantiate"])

	// Verify job spec came from cronjob template
	require.Len(t, createdJob.Spec.Template.Spec.Containers, 1)
	require.Equal(t, "backup", createdJob.Spec.Template.Spec.Containers[0].Name)
}

func TestTriggerCronJobErrors(t *testing.T) {
	t.Helper()

	// Test with non-existent cronjob
	client := cgofake.NewClientset()
	allowSelfSubjectAccessReviews(client)
	app := &App{
		logger: NewLogger(10),
	}
	app.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	_, err := app.triggerCronJob(workloadClusterID, "default", "nonexistent")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get cronjob")

	// Test with nil client
	appNilClient := &App{}
	appNilClient.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}
	_, err = appNilClient.triggerCronJob(workloadClusterID, "default", "backup")
	require.EqualError(t, err, "kubernetes client is not initialized")
}

func TestSuspendCronJobTogglesSuspendField(t *testing.T) {
	t.Helper()

	tests := []struct {
		name           string
		initialSuspend bool
		setSuspend     bool
	}{
		{name: "suspend active cronjob", initialSuspend: false, setSuspend: true},
		{name: "resume suspended cronjob", initialSuspend: true, setSuspend: false},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			cronJob := &batchv1.CronJob{
				ObjectMeta: metav1.ObjectMeta{
					Name:      "backup",
					Namespace: "default",
				},
				Spec: batchv1.CronJobSpec{
					Schedule: "0 * * * *",
					Suspend:  &tc.initialSuspend,
					JobTemplate: batchv1.JobTemplateSpec{
						Spec: batchv1.JobSpec{
							Template: corev1.PodTemplateSpec{
								Spec: corev1.PodSpec{
									Containers:    []corev1.Container{{Name: "c", Image: "img"}},
									RestartPolicy: corev1.RestartPolicyNever,
								},
							},
						},
					},
				},
			}

			client := cgofake.NewClientset(cronJob)
			allowSelfSubjectAccessReviews(client)
			app := &App{
				logger:        NewLogger(100),
				responseCache: newResponseCache(time.Minute, 10),
			}
			app.clusterClients = map[string]*clusterClients{
				workloadClusterID: {
					meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
					kubeconfigPath:    "/path",
					kubeconfigContext: "ctx",
					client:            client,
				},
			}
			detailKey := objectDetailCacheKey("CronJob", "default", "backup")
			app.responseCacheStore(workloadClusterID, detailKey, "stale")

			err := app.suspendCronJob(workloadClusterID, "default", "backup", tc.setSuspend)
			require.NoError(t, err)
			_, cached := app.responseCacheLookup(workloadClusterID, detailKey)
			require.False(t, cached, "expected cronjob detail cache to be evicted after suspend update")

			// Verify the cronjob was updated
			updated, err := client.BatchV1().CronJobs("default").Get(context.Background(), "backup", metav1.GetOptions{})
			require.NoError(t, err)
			require.NotNil(t, updated.Spec.Suspend)
			require.Equal(t, tc.setSuspend, *updated.Spec.Suspend)
		})
	}
}

func TestSuspendCronJobErrors(t *testing.T) {
	t.Helper()

	// Test with non-existent cronjob
	client := cgofake.NewClientset()
	allowSelfSubjectAccessReviews(client)
	app := &App{
		logger: NewLogger(10),
	}
	app.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	err := app.suspendCronJob(workloadClusterID, "default", "nonexistent", true)
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to update cronjob")

	// Test with nil client
	appNilClient := &App{}
	appNilClient.clusterClients = map[string]*clusterClients{
		workloadClusterID: {
			meta:              ClusterMeta{ID: workloadClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}
	err = appNilClient.suspendCronJob(workloadClusterID, "default", "backup", true)
	require.EqualError(t, err, "kubernetes client is not initialized")
}
