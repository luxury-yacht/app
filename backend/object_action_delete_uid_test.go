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
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
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

// A delete's 404 can come from an admission webhook, or from an API version the
// cluster stopped serving, while the object still exists. The batch counts a
// confirmed delete as done, so only a read of that exact object may confirm it.
func TestRunObjectActionDeleteConfirmsAbsenceOnlyByReadingTheObject(t *testing.T) {
	const clusterID = uidGuardCluster
	objectStillThere := &unstructured.Unstructured{Object: map[string]any{"metadata": map[string]any{"name": "still-here"}}}
	unservedVersion := apierrors.NewGenericServerResponse(404, "DELETE", schema.GroupResource{}, "", "404 page not found", 0, true)
	routeWithNoHandler := apierrors.NewGenericServerResponse(404, "", schema.GroupResource{}, "", "the route was not found", 0, false)

	setups := []struct {
		name         string
		target       ObjectActionTargetRef
		resource     schema.GroupResource
		answerDelete func(t *testing.T, answer error) (*resourceGatewayFixture, *dynamicfake.FakeDynamicClient)
	}{
		{
			name:     "Pod",
			target:   objectActionTarget(clusterID, "", "v1", "Pod", "default", "target"),
			resource: corev1.Resource("pods"),
			answerDelete: func(t *testing.T, answer error) (*resourceGatewayFixture, *dynamicfake.FakeDynamicClient) {
				app, client := uidGuardFixture(t, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "target", Namespace: "default"}})
				client.PrependReactor("delete", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
					return true, nil, answer
				})
				dynamicClient := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())
				app.clusters[clusterID].dynamicClient = dynamicClient
				return app, dynamicClient
			},
		},
		{
			name:     "custom resource",
			target:   objectActionTarget(clusterID, "kinda.rocks", "v1beta1", "DbInstance", "default", "my-db"),
			resource: schema.GroupResource{Group: "kinda.rocks", Resource: "dbinstances"},
			answerDelete: func(t *testing.T, answer error) (*resourceGatewayFixture, *dynamicfake.FakeDynamicClient) {
				app := newCollidingDBInstanceCluster(t, clusterID)
				dynamicClient := app.clusters[clusterID].dynamicClient.(*dynamicfake.FakeDynamicClient)
				dynamicClient.PrependReactor("delete", "*", func(clienttesting.Action) (bool, runtime.Object, error) {
					return true, nil, answer
				})
				return app, dynamicClient
			},
		},
	}

	for _, setup := range setups {
		gone := apierrors.NewNotFound(setup.resource, setup.target.Name)
		answers := []struct {
			name         string
			deleteAnswer error
			readObject   *unstructured.Unstructured
			readError    error
			confirmed    bool
		}{
			{name: "the object is really gone", deleteAnswer: gone, readError: gone, confirmed: true},
			{name: "a webhook's 404 about something else", deleteAnswer: apierrors.NewNotFound(corev1.Resource("configmaps"), setup.target.Name), readObject: objectStillThere},
			{name: "a webhook's 404 naming this object", deleteAnswer: gone, readObject: objectStillThere},
			{name: "an API version no longer served", deleteAnswer: unservedVersion, readError: unservedVersion},
			{name: "a route the API server has no handler for", deleteAnswer: routeWithNoHandler, readError: routeWithNoHandler},
		}
		for _, tc := range answers {
			t.Run(setup.name+": "+tc.name, func(t *testing.T) {
				app, dynamicClient := setup.answerDelete(t, tc.deleteAnswer)
				dynamicClient.PrependReactor("get", "*", func(clienttesting.Action) (bool, runtime.Object, error) {
					if tc.readError != nil {
						return true, nil, tc.readError
					}
					return true, tc.readObject, nil
				})

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
