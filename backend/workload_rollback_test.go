package backend

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

// buildRevisionHistoryApp creates an App with a fake Kubernetes client pre-populated with the given objects.
func buildRevisionHistoryApp(client *cgofake.Clientset) *App {
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:              ClusterMeta{ID: "config:ctx", Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}
	return app
}

func TestGetRevisionHistoryDeployment(t *testing.T) {
	t.Helper()

	deployUID := types.UID("deploy-uid-abc")

	// Deployment at revision 3 (current).
	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "myapp",
			Namespace: "default",
			UID:       deployUID,
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "3",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "myapp"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "myapp"}},
			},
		},
	}

	isController := true

	// ReplicaSet for revision 1 — has a change-cause annotation.
	rs1 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "myapp-rs1",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
				"kubernetes.io/change-cause":        "initial deploy",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "myapp",
					UID:        deployUID,
					Controller: &isController,
				},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "myapp", "version": "v1"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app", Image: "myapp:v1"}}},
			},
		},
	}

	// ReplicaSet for revision 2.
	rs2 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "myapp-rs2",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "myapp",
					UID:        deployUID,
					Controller: &isController,
				},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "myapp", "version": "v2"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app", Image: "myapp:v2"}}},
			},
		},
	}

	// ReplicaSet for revision 3 (current).
	rs3 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "myapp-rs3",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "3",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "myapp",
					UID:        deployUID,
					Controller: &isController,
				},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "myapp", "version": "v3"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app", Image: "myapp:v3"}}},
			},
		},
	}

	// Also create a ReplicaSet owned by a different Deployment — must be excluded.
	otherUID := types.UID("other-deploy-uid")
	rsOther := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "other-rs",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "other",
					UID:        otherUID,
					Controller: &isController,
				},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "other"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "other", Image: "other:v1"}}},
			},
		},
	}

	client := cgofake.NewClientset(deploy, rs1, rs2, rs3, rsOther)
	app := buildRevisionHistoryApp(client)

	entries, err := app.GetRevisionHistory("config:ctx", "default", "myapp", "Deployment")
	require.NoError(t, err)

	// Expect exactly 3 revisions (the unrelated ReplicaSet must be filtered out).
	require.Len(t, entries, 3, "expected 3 revision entries")

	// Results must be sorted descending by revision number.
	require.Equal(t, int64(3), entries[0].Revision, "first entry should be revision 3")
	require.Equal(t, int64(2), entries[1].Revision, "second entry should be revision 2")
	require.Equal(t, int64(1), entries[2].Revision, "third entry should be revision 1")

	// Revision 3 matches the Deployment's own revision annotation → current.
	require.True(t, entries[0].Current, "revision 3 should be current")
	require.False(t, entries[1].Current, "revision 2 should not be current")
	require.False(t, entries[2].Current, "revision 1 should not be current")

	// Revision 1 has a change-cause annotation.
	require.Equal(t, "initial deploy", entries[2].ChangeCause, "revision 1 should carry change-cause")

	// All pod templates must be non-empty YAML strings.
	for i, e := range entries {
		require.NotEmpty(t, e.PodTemplate, "pod template for entry %d (revision %d) should not be empty", i, e.Revision)
	}
}

func TestGetRevisionHistoryUnsupportedKind(t *testing.T) {
	t.Helper()

	client := cgofake.NewClientset()
	app := buildRevisionHistoryApp(client)

	_, err := app.GetRevisionHistory("config:ctx", "default", "myapp", "ReplicaSet")
	require.Error(t, err)
	require.Contains(t, err.Error(), "ReplicaSet")
}

func TestGetRevisionHistoryNilClient(t *testing.T) {
	t.Helper()

	// clusterClients entry exists but has no kubernetes client set.
	app := &App{logger: NewLogger(10)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:              ClusterMeta{ID: "config:ctx", Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			// client intentionally omitted (nil)
		},
	}

	_, err := app.GetRevisionHistory("config:ctx", "default", "myapp", "Deployment")
	require.EqualError(t, err, "kubernetes client is not initialized")
}

func TestGetRevisionHistoryStatefulSet(t *testing.T) {
	t.Helper()

	stsUID := types.UID("sts-uid-abc")

	// StatefulSet at currentRevision "db-rev3".
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db",
			Namespace: "default",
			UID:       stsUID,
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: "db-rev3",
		},
	}

	isController := true

	// ControllerRevision for revision 1.
	cr1 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db-rev1",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "StatefulSet",
					Name:       "db",
					UID:        stsUID,
					Controller: &isController,
				},
			},
		},
		Revision: 1,
		Data: mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{{Name: "db", Image: "postgres:12"}},
					},
				},
			},
		}),
	}

	// ControllerRevision for revision 2.
	cr2 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db-rev2",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "StatefulSet",
					Name:       "db",
					UID:        stsUID,
					Controller: &isController,
				},
			},
		},
		Revision: 2,
		Data: mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{{Name: "db", Image: "postgres:13"}},
					},
				},
			},
		}),
	}

	// ControllerRevision for revision 3 — matches currentRevision name.
	cr3 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db-rev3",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "StatefulSet",
					Name:       "db",
					UID:        stsUID,
					Controller: &isController,
				},
			},
		},
		Revision: 3,
		Data: mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{{Name: "db", Image: "postgres:14"}},
					},
				},
			},
		}),
	}

	client := cgofake.NewClientset(sts, cr1, cr2, cr3)
	app := buildRevisionHistoryApp(client)

	entries, err := app.GetRevisionHistory("config:ctx", "default", "db", "StatefulSet")
	require.NoError(t, err)

	// Expect exactly 3 revisions.
	require.Len(t, entries, 3, "expected 3 revision entries")

	// Results must be sorted descending by revision number.
	require.Equal(t, int64(3), entries[0].Revision, "first entry should be revision 3")
	require.Equal(t, int64(2), entries[1].Revision, "second entry should be revision 2")
	require.Equal(t, int64(1), entries[2].Revision, "third entry should be revision 1")

	// Only revision 3 (name "db-rev3") should be marked as current.
	require.True(t, entries[0].Current, "revision 3 should be current (matches currentRevision name)")
	require.False(t, entries[1].Current, "revision 2 should not be current")
	require.False(t, entries[2].Current, "revision 1 should not be current")

	// All pod templates must be non-empty YAML strings.
	for i, e := range entries {
		require.NotEmpty(t, e.PodTemplate, "pod template for entry %d (revision %d) should not be empty", i, e.Revision)
	}
}

func TestGetRevisionHistoryDaemonSet(t *testing.T) {
	t.Helper()

	dsUID := types.UID("ds-uid-xyz")

	// DaemonSet — no currentRevision exposed in status.
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "logging-agent",
			Namespace: "kube-system",
			UID:       dsUID,
		},
	}

	isController := true

	// ControllerRevision for revision 1.
	cr1 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "logging-agent-rev1",
			Namespace: "kube-system",
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "DaemonSet",
					Name:       "logging-agent",
					UID:        dsUID,
					Controller: &isController,
				},
			},
		},
		Revision: 1,
		Data: mustMarshalControllerRevisionData(t, &appsv1.DaemonSet{
			Spec: appsv1.DaemonSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{{Name: "agent", Image: "fluent/fluent-bit:1.9"}},
					},
				},
			},
		}),
	}

	// ControllerRevision for revision 2 — highest, so must be current.
	cr2 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "logging-agent-rev2",
			Namespace: "kube-system",
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "DaemonSet",
					Name:       "logging-agent",
					UID:        dsUID,
					Controller: &isController,
				},
			},
		},
		Revision: 2,
		Data: mustMarshalControllerRevisionData(t, &appsv1.DaemonSet{
			Spec: appsv1.DaemonSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{{Name: "agent", Image: "fluent/fluent-bit:2.0"}},
					},
				},
			},
		}),
	}

	client := cgofake.NewClientset(ds, cr1, cr2)
	app := buildRevisionHistoryApp(client)

	entries, err := app.GetRevisionHistory("config:ctx", "kube-system", "logging-agent", "DaemonSet")
	require.NoError(t, err)

	// Expect exactly 2 revisions.
	require.Len(t, entries, 2, "expected 2 revision entries")

	// Results must be sorted descending by revision number.
	require.Equal(t, int64(2), entries[0].Revision, "first entry should be revision 2")
	require.Equal(t, int64(1), entries[1].Revision, "second entry should be revision 1")

	// Highest revision (2) must be marked as current since DaemonSet has no currentRevision name.
	require.True(t, entries[0].Current, "revision 2 (highest) should be current")
	require.False(t, entries[1].Current, "revision 1 should not be current")

	// All pod templates must be non-empty YAML strings.
	for i, e := range entries {
		require.NotEmpty(t, e.PodTemplate, "pod template for entry %d (revision %d) should not be empty", i, e.Revision)
	}
}

// mustMarshalControllerRevisionData JSON-marshals obj into a runtime.RawExtension.
// It fails the test immediately if marshalling fails.
func mustMarshalControllerRevisionData(t *testing.T, obj interface{}) runtime.RawExtension {
	t.Helper()
	raw, err := json.Marshal(obj)
	require.NoError(t, err, "failed to marshal controller revision data")
	return runtime.RawExtension{Raw: raw}
}

// TestRollbackWorkloadDeployment verifies that rolling back a Deployment to a previous
// revision replaces its pod template with the one from the target ReplicaSet.
func TestRollbackWorkloadDeployment(t *testing.T) {
	t.Helper()

	deployUID := types.UID("rollback-deploy-uid")
	isController := true

	// Deployment currently at revision 2 (nginx:1.25).
	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "webapp",
			Namespace: "default",
			UID:       deployUID,
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "webapp"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "webapp"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Image: "nginx:1.25"}}},
			},
		},
	}

	// ReplicaSet for revision 1 (nginx:1.23) — the rollback target.
	rs1 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "webapp-rs1",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "webapp",
					UID:        deployUID,
					Controller: &isController,
				},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "webapp"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Image: "nginx:1.23"}}},
			},
		},
	}

	// ReplicaSet for revision 2 (current, nginx:1.25).
	rs2 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "webapp-rs2",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "webapp",
					UID:        deployUID,
					Controller: &isController,
				},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "webapp"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Image: "nginx:1.25"}}},
			},
		},
	}

	client := cgofake.NewClientset(deploy, rs1, rs2)
	app := buildRevisionHistoryApp(client)

	err := app.RollbackWorkload("config:ctx", "default", "webapp", "Deployment", 1)
	require.NoError(t, err)

	// Read the deployment back from the fake client and verify the container image was rolled back.
	updated, err := client.AppsV1().Deployments("default").Get(t.Context(), "webapp", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.Spec.Template.Spec.Containers, 1)
	require.Equal(t, "nginx:1.23", updated.Spec.Template.Spec.Containers[0].Image,
		"deployment container image should be rolled back to nginx:1.23")
}

// TestRollbackWorkloadStatefulSet verifies that rolling back a StatefulSet to a previous
// revision replaces its pod template using the stored ControllerRevision data.
func TestRollbackWorkloadStatefulSet(t *testing.T) {
	t.Helper()

	stsUID := types.UID("rollback-sts-uid")
	isController := true

	// StatefulSet currently at revision 2 (redis:7).
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cache",
			Namespace: "default",
			UID:       stsUID,
		},
		Spec: appsv1.StatefulSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "cache"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "cache"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "cache", Image: "redis:7"}}},
			},
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: "cache-rev2",
		},
	}

	// ControllerRevision for revision 1 (postgres:14) — the rollback target.
	cr1 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cache-rev1",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "StatefulSet",
					Name:       "cache",
					UID:        stsUID,
					Controller: &isController,
				},
			},
		},
		Revision: 1,
		Data: mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "cache"}},
					Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "cache", Image: "postgres:14"}}},
				},
			},
		}),
	}

	// ControllerRevision for revision 2 (current, redis:7).
	cr2 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cache-rev2",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "StatefulSet",
					Name:       "cache",
					UID:        stsUID,
					Controller: &isController,
				},
			},
		},
		Revision: 2,
		Data: mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "cache"}},
					Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "cache", Image: "redis:7"}}},
				},
			},
		}),
	}

	client := cgofake.NewClientset(sts, cr1, cr2)
	app := buildRevisionHistoryApp(client)

	err := app.RollbackWorkload("config:ctx", "default", "cache", "StatefulSet", 1)
	require.NoError(t, err)

	// Read the statefulset back and verify the container image changed.
	updated, err := client.AppsV1().StatefulSets("default").Get(t.Context(), "cache", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.Spec.Template.Spec.Containers, 1)
	require.Equal(t, "postgres:14", updated.Spec.Template.Spec.Containers[0].Image,
		"statefulset container image should be rolled back to postgres:14")
}

// TestRollbackWorkloadRevisionNotFound verifies that requesting a non-existent revision
// returns an error without modifying the workload.
func TestRollbackWorkloadRevisionNotFound(t *testing.T) {
	t.Helper()

	deployUID := types.UID("notfound-deploy-uid")
	isController := true

	// Deployment at revision 1 only.
	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api",
			Namespace: "default",
			UID:       deployUID,
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "api"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api", Image: "myapi:v1"}}},
			},
		},
	}

	rs1 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-rs1",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "api",
					UID:        deployUID,
					Controller: &isController,
				},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "api"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api", Image: "myapi:v1"}}},
			},
		},
	}

	client := cgofake.NewClientset(deploy, rs1)
	app := buildRevisionHistoryApp(client)

	// Revision 99 does not exist — expect an error.
	err := app.RollbackWorkload("config:ctx", "default", "api", "Deployment", 99)
	require.Error(t, err)
	require.Contains(t, err.Error(), "revision 99 not found")
}

// TestRollbackWorkloadUnsupportedKind verifies that attempting to roll back an unsupported
// workload kind (e.g. ReplicaSet) returns an error immediately.
func TestRollbackWorkloadUnsupportedKind(t *testing.T) {
	t.Helper()

	client := cgofake.NewClientset()
	app := buildRevisionHistoryApp(client)

	err := app.RollbackWorkload("config:ctx", "default", "myset", "ReplicaSet", 1)
	require.Error(t, err)
	require.Contains(t, err.Error(), "ReplicaSet")
}
