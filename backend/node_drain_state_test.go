/*
 * backend/node_drain_state_test.go
 *
 * The live read behind the node Delete warning: it answers for the cluster the
 * target names and only for Nodes.
 */

package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/resources/nodes"
)

func drainStateFixture(t *testing.T, clusterID string, node *corev1.Node) *resourceGatewayFixture {
	t.Helper()
	app := wrapperResourceGatewayFixture(t)
	app.clusters = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            cgofake.NewClientset(node),
		},
	}
	return app
}

func TestReadNodeDrainStateAnswersForTheTargetCluster(t *testing.T) {
	const clusterID = "config:ctx"
	app := drainStateFixture(t, clusterID, &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node"},
		Spec:       corev1.NodeSpec{Unschedulable: true},
	})

	state, err := app.gateway.ReadNodeDrainState(objectActionTarget(clusterID, "", "v1", "Node", "", "node"))

	require.NoError(t, err)
	require.Equal(t, nodes.DrainState{Cordoned: true, EvictablePods: 0}, state)
}

func TestReadNodeDrainStateRefusesAnythingButANode(t *testing.T) {
	const clusterID = "config:ctx"
	app := drainStateFixture(t, clusterID, &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node"}})

	_, err := app.gateway.ReadNodeDrainState(objectActionTarget(clusterID, "", "v1", "Pod", "ns", "node"))

	require.Error(t, err)
}
