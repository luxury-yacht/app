/*
 * backend/object_action_delete_uid_test.go
 *
 * Batch-select can retry a delete whose first attempt succeeded but lost its
 * response. By then a controller may have recreated the object under the same
 * name, so a delete carrying the UID the user saw must only ever remove that
 * object. The fake clients do not evaluate preconditions, so these tests assert
 * what is sent to the API server, which is what enforces them.
 */

package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

type deleteUIDFixture struct {
	app     *resourceGatewayFixture
	target  ObjectActionTargetRef
	actions func() []clienttesting.Action
}

func typedDeleteUIDFixture(t *testing.T, target ObjectActionTargetRef, object runtime.Object) deleteUIDFixture {
	t.Helper()
	app := wrapperResourceGatewayFixture(t)
	client := cgofake.NewClientset(object)
	allowSelfSubjectAccessReviews(client)
	app.clusters = map[string]*clusterClients{
		target.ClusterID: {
			meta:              ClusterMeta{ID: target.ClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}
	return deleteUIDFixture{app: app, target: target, actions: client.Actions}
}

func deleteOptionsSent(t *testing.T, actions []clienttesting.Action) metav1.DeleteOptions {
	t.Helper()
	for _, action := range actions {
		if deletion, ok := action.(clienttesting.DeleteAction); ok && action.GetVerb() == "delete" {
			return deletion.GetDeleteOptions()
		}
	}
	require.Fail(t, "expected a delete request", "actions: %v", actions)
	return metav1.DeleteOptions{}
}

func TestRunObjectActionDeleteHonorsTheTargetUID(t *testing.T) {
	const clusterID = "config:ctx"
	kinds := []struct {
		name  string
		setup func(t *testing.T) deleteUIDFixture
	}{
		{"Pod", func(t *testing.T) deleteUIDFixture {
			return typedDeleteUIDFixture(t, objectActionTarget(clusterID, "", "v1", "Pod", "ns", "pod"),
				&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod", Namespace: "ns"}})
		}},
		{"Node", func(t *testing.T) deleteUIDFixture {
			return typedDeleteUIDFixture(t, objectActionTarget(clusterID, "", "v1", "Node", "", "node"),
				&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node"}})
		}},
		{"custom resource", func(t *testing.T) deleteUIDFixture {
			app := newCollidingDBInstanceCluster(t, clusterID)
			dynamicClient := app.clusters[clusterID].dynamicClient.(*dynamicfake.FakeDynamicClient)
			return deleteUIDFixture{
				app:     app,
				target:  objectActionTarget(clusterID, "kinda.rocks", "v1beta1", "DbInstance", "default", "my-db"),
				actions: dynamicClient.Actions,
			}
		}},
		{"Job", func(t *testing.T) deleteUIDFixture {
			app := newCollidingDBInstanceCluster(t, clusterID)
			dynamicClient := app.clusters[clusterID].dynamicClient.(*dynamicfake.FakeDynamicClient)
			dynamicClient.PrependReactor("delete", "jobs", func(clienttesting.Action) (bool, runtime.Object, error) {
				return true, nil, nil
			})
			return deleteUIDFixture{
				app:     app,
				target:  objectActionTarget(clusterID, "batch", "v1", "Job", "default", "nightly"),
				actions: dynamicClient.Actions,
			}
		}},
	}

	for _, kind := range kinds {
		t.Run(kind.name+" is deleted only if it still has the UID the user saw", func(t *testing.T) {
			fixture := kind.setup(t)
			target := fixture.target
			target.UID = "uid-the-user-saw"

			_, err := fixture.app.gateway.RunObjectAction(ObjectActionRequest{Action: ObjectActionDelete, Target: target})
			require.NoError(t, err)

			preconditions := deleteOptionsSent(t, fixture.actions()).Preconditions
			require.NotNil(t, preconditions, "the API server has nothing to compare the object against")
			require.NotNil(t, preconditions.UID)
			require.Equal(t, types.UID("uid-the-user-saw"), *preconditions.UID)
		})

		// Left unset, the API server orphans the Pods of a batch/v1 Job.
		t.Run(kind.name+" takes what it owns with it, as kubectl does", func(t *testing.T) {
			fixture := kind.setup(t)

			_, err := fixture.app.gateway.RunObjectAction(ObjectActionRequest{Action: ObjectActionDelete, Target: fixture.target})
			require.NoError(t, err)

			policy := deleteOptionsSent(t, fixture.actions()).PropagationPolicy
			require.NotNil(t, policy, "the API server would fall back to the kind's own default")
			require.Equal(t, metav1.DeletePropagationBackground, *policy)
		})

		t.Run(kind.name+" without a UID is deleted by name", func(t *testing.T) {
			fixture := kind.setup(t)

			_, err := fixture.app.gateway.RunObjectAction(ObjectActionRequest{Action: ObjectActionDelete, Target: fixture.target})
			require.NoError(t, err)

			require.Nil(t, deleteOptionsSent(t, fixture.actions()).Preconditions)
		})
	}
}

// A 404 is only proof the object is gone when the Kubernetes API said so. The batch
// counts a confirmed delete as done, so anything else must stay a failure.
func TestRunObjectActionDeleteConfirmsAbsenceOnlyFromTheAPI(t *testing.T) {
	const clusterID = uidGuardCluster
	pods := corev1.Resource("pods")
	dbInstances := schema.GroupResource{Group: "kinda.rocks", Resource: "dbinstances"}
	unservedVersion := apierrors.NewGenericServerResponse(404, "DELETE", schema.GroupResource{}, "", "404 page not found", 0, true)

	setups := []struct {
		name         string
		target       ObjectActionTargetRef
		answerDelete func(t *testing.T, answer error) *resourceGatewayFixture
		missing      error
		mismatched   error
	}{
		{
			name:   "Pod",
			target: objectActionTarget(clusterID, "", "v1", "Pod", "default", "pod"),
			answerDelete: func(t *testing.T, answer error) *resourceGatewayFixture {
				app, client := uidGuardFixture(t, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod", Namespace: "default"}})
				client.PrependReactor("delete", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
					return true, nil, answer
				})
				return app
			},
			missing:    apierrors.NewNotFound(pods, "pod"),
			mismatched: apierrors.NewNotFound(corev1.Resource("namespaces"), "default"),
		},
		{
			name:   "custom resource",
			target: objectActionTarget(clusterID, "kinda.rocks", "v1beta1", "DbInstance", "default", "my-db"),
			answerDelete: func(t *testing.T, answer error) *resourceGatewayFixture {
				app := newCollidingDBInstanceCluster(t, clusterID)
				app.clusters[clusterID].dynamicClient.(*dynamicfake.FakeDynamicClient).PrependReactor(
					"delete", "*", func(clienttesting.Action) (bool, runtime.Object, error) {
						return true, nil, answer
					},
				)
				return app
			},
			missing:    apierrors.NewNotFound(dbInstances, "my-db"),
			mismatched: apierrors.NewNotFound(dbInstances, "other-db"),
		},
	}

	for _, setup := range setups {
		answers := []struct {
			name      string
			answer    error
			confirmed bool
		}{
			{"the API reports the object missing", setup.missing, true},
			{"the API reports something else missing", setup.mismatched, false},
			{"a plain 404 from an API version no longer served", unservedVersion, false},
		}
		for _, tc := range answers {
			t.Run(setup.name+": "+tc.name, func(t *testing.T) {
				app := setup.answerDelete(t, tc.answer)

				_, err := app.gateway.RunObjectAction(ObjectActionRequest{Action: ObjectActionDelete, Target: setup.target})

				status := errorstatus.Classify(err)
				require.Equal(t, errorstatus.ReasonNotFound, status.Reason)
				if tc.confirmed {
					expected := objectActionStatusRef(setup.target)
					require.Equal(t, &expected, status.Ref)
				} else {
					require.Nil(t, status.Ref, "this 404 says nothing about whether the object exists")
				}
			})
		}
	}
}
