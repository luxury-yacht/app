package snapshot

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var detailsDeploymentGVK = schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}

func newObjectDetailsNotifierForTest(recorder *objectEventsBroadcastRecorder) *ObjectDetailsChangeNotifier {
	notifier := NewObjectDetailsChangeNotifier(&matcherBell{record: recorder.record})
	notifier.debounce = 20 * time.Millisecond
	return notifier
}

// A change rings exactly the changed object's open panels: the same identity
// in any kind casing, never a sibling, another namespace, or another version
// (eviction is per exact GVK, so another version's cached details are untouched).
func TestObjectDetailsNotifierRingsOnlyTheChangedObject(t *testing.T) {
	recorder := &objectEventsBroadcastRecorder{}
	notifier := newObjectDetailsNotifierForTest(recorder)
	defer notifier.stopForTest()

	notifier.ObjectChanged(detailsDeploymentGVK, "team-a", "web")
	waitForObjectEventsBroadcasts(t, recorder, 1)

	matches := recorder.lastMatcher()
	require.True(t, matches("team-a:apps/v1:Deployment:web"))
	require.True(t, matches("team-a:apps/v1:deployment:web"))
	require.False(t, matches("team-a:apps/v1:Deployment:api"))
	require.False(t, matches("team-b:apps/v1:Deployment:web"))
	require.False(t, matches("team-a:apps/v1beta1:Deployment:web"))
	require.False(t, matches("team-a:apps/v1:StatefulSet:web"))
	require.False(t, matches("not-an-object-scope"))
}

// A Pod change evicts the details of every pod-listing kind in its namespace,
// so it rings every open panel of that kind there.
func TestObjectDetailsNotifierRingsEveryObjectOfAKindInANamespace(t *testing.T) {
	recorder := &objectEventsBroadcastRecorder{}
	notifier := newObjectDetailsNotifierForTest(recorder)
	defer notifier.stopForTest()

	notifier.KindChangedInNamespace(detailsDeploymentGVK, "team-a")
	waitForObjectEventsBroadcasts(t, recorder, 1)

	matches := recorder.lastMatcher()
	require.True(t, matches("team-a:apps/v1:Deployment:web"))
	require.True(t, matches("team-a:apps/v1:Deployment:api"))
	require.False(t, matches("team-b:apps/v1:Deployment:web"))
	require.False(t, matches("team-a:apps/v1:StatefulSet:web"))
}

func TestObjectDetailsNotifierMatchesClusterScopedObjects(t *testing.T) {
	recorder := &objectEventsBroadcastRecorder{}
	notifier := newObjectDetailsNotifierForTest(recorder)
	defer notifier.stopForTest()

	notifier.ObjectChanged(schema.GroupVersionKind{Version: "v1", Kind: "Node"}, "", "worker-1")
	waitForObjectEventsBroadcasts(t, recorder, 1)

	matches := recorder.lastMatcher()
	require.True(t, matches("__cluster__:/v1:Node:worker-1"))
	require.False(t, matches("__cluster__:/v1:Node:worker-2"))
}
