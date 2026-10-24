package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	cgofake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

// Actions are offered only after the UI permission gate allows them, so a
// permission rejection of an offered action means the gate and the server
// disagree: it is reported (expected: false) and names the target.
func TestGatedActionPermissionRejectionIsUnexpected(t *testing.T) {
	const clusterID = "cluster-a"
	podRef := &errorstatus.ObjectRef{ClusterID: clusterID, Version: "v1", Kind: "Pod", Namespace: "default", Name: "web"}
	newCluster := func(configure func(*cgofake.Clientset)) *resourceGatewayFixture {
		client := cgofake.NewClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}})
		configure(client)
		fixture := newResourceGatewayFixture()
		fixture.setCluster(clusterID, &clusterClients{meta: ClusterMeta{ID: clusterID, Name: "Alpha"}, client: client})
		return fixture
	}
	deletePod := func(fixture *resourceGatewayFixture) error {
		_, err := fixture.gateway.RunObjectAction(ObjectActionRequest{
			Action: ObjectActionDelete,
			Target: objectActionTarget(clusterID, "", "v1", "Pod", "default", "web"),
		})
		return err
	}

	t.Run("backend permission check denies", func(t *testing.T) {
		fixture := newCluster(func(client *cgofake.Clientset) {
			denySelfSubjectAccessReviews(client, "no delete")
		})

		status := errorstatus.Classify(deletePod(fixture))

		require.Equal(t, errorstatus.ReasonForbidden, status.Reason)
		require.False(t, status.Expected)
		require.Equal(t, podRef, status.Ref)
	})

	t.Run("API server denies after the check allowed", func(t *testing.T) {
		fixture := newCluster(func(client *cgofake.Clientset) {
			allowSelfSubjectAccessReviews(client)
			client.Fake.PrependReactor("delete", "pods", func(cgotesting.Action) (bool, runtime.Object, error) {
				return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "web", nil)
			})
		})

		status := errorstatus.Classify(deletePod(fixture))

		require.Equal(t, errorstatus.ReasonForbidden, status.Reason)
		require.False(t, status.Expected)
		require.Equal(t, podRef, status.Ref)
	})
}

func TestYAMLApplyPermissionRejectionIsUnexpected(t *testing.T) {
	request := ObjectYAMLMutationRequest{
		BaseYAML:   baseYAML(),
		YAML:       baseYAML(),
		Kind:       "Deployment",
		APIVersion: "apps/v1",
		Namespace:  "default",
		Name:       "demo",
		UID:        "demo-uid",
	}

	t.Run("patch permission check denies", func(t *testing.T) {
		app, _, clusterID := setupYAMLTestApp(t)
		deps, _, err := app.resolveClusterDependencies(clusterID)
		require.NoError(t, err)
		denySelfSubjectAccessReviews(deps.KubernetesClient.(*cgofake.Clientset), "no patch")

		_, err = app.ApplyObjectYaml(clusterID, request)
		status := errorstatus.Classify(err)

		require.Equal(t, errorstatus.ReasonForbidden, status.Reason)
		require.False(t, status.Expected)
	})

	t.Run("API server denies the patch", func(t *testing.T) {
		app, dynamicClient, clusterID := setupYAMLTestApp(t)
		dynamicClient.Fake.PrependReactor("patch", "*", func(cgotesting.Action) (bool, runtime.Object, error) {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "apps", Resource: "deployments"}, "demo", nil)
		})

		_, err := app.ApplyObjectYaml(clusterID, request)
		status := errorstatus.Classify(err)

		require.Equal(t, errorstatus.ReasonForbidden, status.Reason)
		require.False(t, status.Expected)
	})
}

// A refresh read denied by RBAC is an ordinary, expected condition.
func TestRefreshPermissionDenialStaysExpected(t *testing.T) {
	require.True(t, errorstatus.Classify(errorstatus.NewPermissionDenied("pods", "core/pods")).Expected)
}
