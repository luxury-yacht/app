/*
 * backend/object_action_uid_guard_test.go
 *
 * An object can be deleted and recreated under its name while a batch dialog is
 * open. A write carrying the UID the user selected must only ever change that
 * object. The fake clients do not evaluate these guards, so the tests assert what
 * is sent to the API server, which is what enforces them.
 */

package backend

import (
	"encoding/json"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	cgofake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

const uidGuardCluster = "config:ctx"

func uidGuardFixture(t *testing.T, object runtime.Object) (*resourceGatewayFixture, *cgofake.Clientset) {
	t.Helper()
	app := wrapperResourceGatewayFixture(t)
	client := cgofake.NewClientset(object)
	allowSelfSubjectAccessReviews(client)
	client.PrependReactor("update", "deployments", func(action clienttesting.Action) (bool, runtime.Object, error) {
		update, ok := action.(clienttesting.UpdateAction)
		if !ok || action.GetSubresource() != "scale" {
			return false, nil, nil
		}
		return true, update.GetObject(), nil
	})
	app.clusters = map[string]*clusterClients{
		uidGuardCluster: {
			meta:              ClusterMeta{ID: uidGuardCluster, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}
	return app, client
}

func patchBodies(t *testing.T, actions []clienttesting.Action) []map[string]any {
	t.Helper()
	bodies := []map[string]any{}
	for _, action := range actions {
		patch, ok := action.(clienttesting.PatchAction)
		if !ok {
			continue
		}
		var body map[string]any
		require.NoError(t, json.Unmarshal(patch.GetPatch(), &body))
		bodies = append(bodies, body)
	}
	return bodies
}

func uidInPatch(t *testing.T, actions []clienttesting.Action) string {
	t.Helper()
	bodies := patchBodies(t, actions)
	require.NotEmpty(t, bodies, "expected a patch request")
	metadata, _ := bodies[0]["metadata"].(map[string]any)
	uid, _ := metadata["uid"].(string)
	return uid
}

func uidInScale(t *testing.T, actions []clienttesting.Action) string {
	t.Helper()
	for _, action := range actions {
		if update, ok := action.(clienttesting.UpdateAction); ok && action.GetSubresource() == "scale" {
			return string(update.GetObject().(*autoscalingv1.Scale).UID)
		}
	}
	require.Fail(t, "expected a scale update")
	return ""
}

func TestRunObjectActionWritesOnlyTheObjectTheUserSelected(t *testing.T) {
	deployment := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}}
	cronJob := &batchv1.CronJob{ObjectMeta: metav1.ObjectMeta{Name: "nightly", Namespace: "default"}}
	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node"}}
	deploymentTarget := objectActionTarget(uidGuardCluster, "apps", "v1", "Deployment", "default", "demo")
	cronJobTarget := objectActionTarget(uidGuardCluster, "batch", "v1", "CronJob", "default", "nightly")
	nodeTarget := objectActionTarget(uidGuardCluster, "", "v1", "Node", "", "node")
	replicas := 0
	suspend := true

	cases := []struct {
		name    string
		request ObjectActionRequest
		object  runtime.Object
		sentUID func(*testing.T, []clienttesting.Action) string
	}{
		{"restart", ObjectActionRequest{Action: ObjectActionRestart, Target: deploymentTarget}, deployment, uidInPatch},
		{"scale", ObjectActionRequest{Action: ObjectActionScale, Target: deploymentTarget, Replicas: &replicas}, deployment, uidInScale},
		{"suspend", ObjectActionRequest{Action: ObjectActionSuspend, Target: cronJobTarget, Suspend: &suspend}, cronJob, uidInPatch},
		{"cordon", ObjectActionRequest{Action: ObjectActionCordon, Target: nodeTarget}, node, uidInPatch},
		{"uncordon", ObjectActionRequest{Action: ObjectActionUncordon, Target: nodeTarget}, &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node"},
			Spec:       corev1.NodeSpec{Unschedulable: true},
		}, uidInPatch},
	}

	for _, tc := range cases {
		t.Run(tc.name+" sends the UID the user selected", func(t *testing.T) {
			app, client := uidGuardFixture(t, tc.object)
			request := tc.request
			request.Target.UID = "uid-the-user-saw"

			_, err := app.gateway.RunObjectAction(request)

			require.NoError(t, err)
			require.Equal(t, "uid-the-user-saw", tc.sentUID(t, client.Actions()))
		})

		t.Run(tc.name+" without a UID goes by name", func(t *testing.T) {
			app, client := uidGuardFixture(t, tc.object)

			_, err := app.gateway.RunObjectAction(tc.request)

			require.NoError(t, err)
			require.Empty(t, tc.sentUID(t, client.Actions()))
		})
	}
}

// A drain is many writes, so both ways of starting one compare the node's UID
// themselves before touching it.
func TestDrainRefusesANodeReplacedSinceItWasSelected(t *testing.T) {
	for _, action := range []string{ObjectActionDrain, ObjectActionStartDrain} {
		t.Run(action, func(t *testing.T) {
			app, client := uidGuardFixture(t, &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node", UID: "uid-now"}})
			target := objectActionTarget(uidGuardCluster, "", "v1", "Node", "", "node")
			target.UID = "uid-the-user-saw"

			_, err := app.gateway.RunObjectAction(ObjectActionRequest{
				Action: action, Target: target, DrainOptions: &DrainNodeOptions{DisableEviction: true},
			})

			require.True(t, apierrors.IsConflict(err), "got %v", err)
			require.Empty(t, patchBodies(t, client.Actions()), "the replacement must not be cordoned")
		})
	}
}

// A UID is the caller's promise that only that object changes. An action that
// cannot hold the cluster to it must refuse before sending anything, not act on
// whatever now holds the name.
func TestRunObjectActionRefusesAUIDItCannotEnforce(t *testing.T) {
	cronJob := &batchv1.CronJob{ObjectMeta: metav1.ObjectMeta{Name: "nightly", Namespace: "default"}}
	deployment := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}}
	helmRelease := resourcemodel.HelmReleaseGVK

	cases := []struct {
		name    string
		request ObjectActionRequest
		object  runtime.Object
	}{
		{"trigger", ObjectActionRequest{
			Action: ObjectActionTrigger,
			Target: objectActionTarget(uidGuardCluster, "batch", "v1", "CronJob", "default", "nightly"),
		}, cronJob},
		{"remove finalizer", ObjectActionRequest{
			Action:        ObjectActionRemoveFinalizer,
			Target:        objectActionTarget(uidGuardCluster, "apps", "v1", "Deployment", "default", "demo"),
			Finalizer:     "example.com/hold",
			FinalizerPath: objectFinalizerPathMetadata,
		}, deployment},
		// Delete binds a UID for cluster objects, but a Helm release is not one.
		{"delete of a Helm release", ObjectActionRequest{
			Action: ObjectActionDelete,
			Target: objectActionTarget(uidGuardCluster, helmRelease.Group, helmRelease.Version, helmRelease.Kind, "default", "release"),
		}, deployment},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, client := uidGuardFixture(t, tc.object)
			request := tc.request
			request.Target.UID = "uid-the-user-saw"

			_, err := app.gateway.RunObjectAction(request)

			require.Error(t, err)
			require.Equal(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason, "got %v", err)
			require.Empty(t, client.Actions(), "nothing may reach the cluster")
		})
	}
}
