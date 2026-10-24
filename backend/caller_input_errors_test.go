package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

// A request the backend rejects for its own arguments reaches the frontend as
// BadRequest (VALIDATION, specific message); a missing dependency is not the
// caller's fault and stays Unknown.
func TestCallerInputErrorsAreBadRequest(t *testing.T) {
	const clusterID = "cluster-a"
	fixture := newResourceGatewayFixture()
	fixture.setCluster(clusterID, &clusterClients{
		meta:          ClusterMeta{ID: clusterID, Name: "Alpha"},
		client:        cgofake.NewClientset(),
		dynamicClient: dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
	})
	finalizer := "example.com/cleanup"

	t.Run("missing action option", func(t *testing.T) {
		_, err := fixture.gateway.RunObjectAction(ObjectActionRequest{
			Action:    ObjectActionRemoveFinalizer,
			Target:    objectActionTarget(clusterID, "", "v1", "ConfigMap", "default", "settings"),
			Finalizer: finalizer,
		})
		status := errorstatus.Classify(err)
		require.Equal(t, errorstatus.ReasonBadRequest, status.Reason)
		require.Equal(t, errorstatus.CategoryValidation, status.Category)
		require.Contains(t, status.Message, "requires finalizerPath")
	})

	t.Run("incomplete target identity", func(t *testing.T) {
		_, err := fixture.gateway.RunObjectAction(ObjectActionRequest{
			Action: ObjectActionDelete,
			Target: objectActionTarget(clusterID, "", "v1", "ConfigMap", "default", ""),
		})
		require.Equal(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason)
	})

	t.Run("unparseable YAML", func(t *testing.T) {
		_, err := fixture.gateway.ApplyObjectYaml(clusterID, ObjectYAMLMutationRequest{
			BaseYAML: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: default\n",
			YAML:     "kind: [",
			Kind:     "ConfigMap", APIVersion: "v1", Namespace: "default", Name: "settings",
		})
		require.Equal(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason)
	})

	t.Run("missing dependency", func(t *testing.T) {
		const unconfigured = "cluster-without-client"
		fixture.setCluster(unconfigured, &clusterClients{meta: ClusterMeta{ID: unconfigured, Name: "Bare"}})
		_, err := fixture.gateway.RunObjectAction(ObjectActionRequest{
			Action: ObjectActionDelete,
			Target: objectActionTarget(unconfigured, "", "v1", "Pod", "default", "web"),
		})
		require.Error(t, err)
		require.NotEqual(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason)
	})
}
