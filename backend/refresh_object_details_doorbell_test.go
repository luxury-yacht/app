package backend

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

const detailsSignalWait = 3 * time.Second

// detailsSignalQuiet outlasts the doorbell debounce, so a missing signal is a
// suppressed one rather than a pending one.
const detailsSignalQuiet = 1500 * time.Millisecond

func subscribeObjectDetails(t *testing.T, subsystem *system.Subsystem, clusterID, scope string) *resourcestream.Subscription {
	t.Helper()
	selector, err := resourcestream.ParseStreamSelector(clusterID, "object-details", scope)
	require.NoError(t, err)
	sub, err := subsystem.ResourceStream.SubscribeSelector(selector)
	require.NoError(t, err)
	t.Cleanup(sub.Cancel)
	return sub
}

// requireDetailsSignal waits for the scope's object doorbell and checks, at the
// moment it arrives, that the cached details it announces are already gone: a
// read triggered by the signal can never return the pre-change copy.
func requireDetailsSignal(t *testing.T, app *workspaceCoordinatorTestFixture, clusterID string, sub *resourcestream.Subscription, contract string, evictedKeys ...string) {
	t.Helper()
	select {
	case update := <-sub.Updates:
		require.Equal(t, "object-details", update.Domain, contract)
		require.Equal(t, resourcestream.SourceObject, update.Source, contract)
		for _, key := range evictedKeys {
			_, cached := app.Resources.responseCacheLookup(clusterID, key)
			require.False(t, cached, "%s: the signal rang before %s was evicted", contract, key)
		}
	case <-time.After(detailsSignalWait):
		t.Fatalf("%s: no object-details signal before the cache expiry", contract)
	}
}

func requireNoDetailsSignal(t *testing.T, sub *resourcestream.Subscription, contract string) {
	t.Helper()
	select {
	case update := <-sub.Updates:
		t.Fatalf("%s: unexpected object-details signal %+v", contract, update)
	case <-time.After(detailsSignalQuiet):
	}
}

// Only Kubernetes clients are fake: subsystem construction, informers, ingest
// stores and sinks, response-cache eviction, and the outbound doorbell are the
// production path. Ingest-owned kinds are written to their stores directly, as
// their reflectors would.
func TestObjectDetailsSignalFollowsEvictionThroughProductionWiring(t *testing.T) {
	app, target := catalogLifecycleTestApp(t, system.TierForeground, false)
	clusterID := target.meta.ID
	clients := app.ClusterRuntime.clusterClientsForID(clusterID)
	kube := clients.client.(*kubefake.Clientset)
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		// ReplicaSets take the informer path. Ingest kinds stay unlaunched: their
		// reflectors need a real API server, so the test writes to their stores
		// the way a reflector would.
		review.Status.Allowed = review.Spec.ResourceAttributes.Resource == "replicasets"
		return true, review, nil
	})
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	subsystem, err := system.NewSubsystemWithServices(context.Background(), system.Config{
		KubernetesClient: kube, APIExtensionsClient: clients.apiextensionsClient, DynamicClient: clients.dynamicClient,
		ClusterID: clusterID, ClusterName: target.meta.Name, Logger: app.AppLogs.Logger(), ResyncInterval: time.Minute,
		ObjectDetailsProvider: app.Resources.objectDetailProvider(), NodeMaintenanceStore: app.NodeMaintenanceStore,
	})
	require.NoError(t, err)
	app.Refresh.setRefreshSubsystem(clusterID, subsystem)
	app.Resources.responseCache = newResponseCache(time.Minute, 10)
	app.Refresh.registerResponseCacheInvalidation(subsystem, clusterID)
	t.Cleanup(func() {
		cancel()
		subsystem.StopDoorbellNotifiers()
		subsystem.ResourceStream.Stop()
		subsystem.IngestManager.Stop()
		_ = subsystem.InformerFactory.Shutdown()
	})
	subsystem.IngestManager.Start(ctx)
	require.NoError(t, subsystem.InformerFactory.Start(ctx))

	replicaSetGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "ReplicaSet"}
	replicaSetKeys := []string{
		objectDetailCacheKeyForGVK(replicaSetGVK, "team-a", "web"),
		objectHeaderMetadataCacheKey(replicaSetGVK, "team-a", "web"),
	}
	replicaSetPanel := subscribeObjectDetails(t, subsystem, clusterID, "team-a:apps/v1:ReplicaSet:web")
	deploymentPanel := subscribeObjectDetails(t, subsystem, clusterID, "team-a:apps/v1:Deployment:web")
	configMapPanel := subscribeObjectDetails(t, subsystem, clusterID, "team-a:/v1:ConfigMap:settings")
	otherNamespacePanel := subscribeObjectDetails(t, subsystem, clusterID, "team-b:apps/v1:ReplicaSet:web")
	seed := func(keys []string) {
		for _, key := range keys {
			app.Resources.seedResponseCache(clusterID, key, "pre-change copy")
		}
	}
	replicaSets := kube.AppsV1().ReplicaSets("team-a")

	// Informer path (ReplicaSet): create, update, resync echo, completed delete.
	seed(replicaSetKeys)
	replicaSet := &appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web", ResourceVersion: "1"}}
	_, err = replicaSets.Create(ctx, replicaSet, metav1.CreateOptions{})
	require.NoError(t, err)
	requireDetailsSignal(t, app, clusterID, replicaSetPanel, "create", replicaSetKeys...)

	seed(replicaSetKeys)
	updated := replicaSet.DeepCopy()
	updated.ResourceVersion = "2"
	updated.Labels = map[string]string{"tier": "web"}
	_, err = replicaSets.Update(ctx, updated, metav1.UpdateOptions{})
	require.NoError(t, err)
	requireDetailsSignal(t, app, clusterID, replicaSetPanel, "update", replicaSetKeys...)

	// The fake tracker keeps the supplied resourceVersion, so this update is a
	// resync-shaped echo: same object, same version.
	_, err = replicaSets.Update(ctx, updated.DeepCopy(), metav1.UpdateOptions{})
	require.NoError(t, err)
	requireNoDetailsSignal(t, replicaSetPanel, "resync echo")

	seed(replicaSetKeys)
	require.NoError(t, replicaSets.Delete(ctx, "web", metav1.DeleteOptions{}))
	requireDetailsSignal(t, app, clusterID, replicaSetPanel, "completed delete", replicaSetKeys...)

	// Ingest path (ConfigMap): a change rings only its own panel, and a relist of
	// the unchanged row rings nothing.
	configMaps := subsystem.IngestManager.StoreFor(corev1.SchemeGroupVersion.WithResource("configmaps"))
	require.NotNil(t, configMaps)
	settings := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "settings", UID: "settings-uid", ResourceVersion: "1"}}
	require.NoError(t, configMaps.Add(settings))
	requireDetailsSignal(t, app, clusterID, configMapPanel, "ingest create")
	requireNoDetailsSignal(t, deploymentPanel, "a ConfigMap change is not a Deployment's")
	require.NoError(t, configMaps.Replace([]interface{}{settings.DeepCopy()}, "5"))
	requireNoDetailsSignal(t, configMapPanel, "relist of an unchanged row")
	changedSettings := settings.DeepCopy()
	changedSettings.ResourceVersion = "6"
	require.NoError(t, configMaps.Update(changedSettings))
	requireDetailsSignal(t, app, clusterID, configMapPanel, "real update after a relist echo")

	// A Pod change rings every open panel in its namespace whose details list pods.
	pods := subsystem.IngestManager.StoreFor(corev1.SchemeGroupVersion.WithResource("pods"))
	require.NotNil(t, pods)
	deploymentKey := objectDetailCacheKeyForGVK(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}, "team-a", "web")
	seed([]string{deploymentKey})
	require.NoError(t, pods.Add(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web-abc", UID: "pod-uid", ResourceVersion: "1"}}))
	requireDetailsSignal(t, app, clusterID, deploymentPanel, "pod change for a Deployment", deploymentKey)
	requireDetailsSignal(t, app, clusterID, replicaSetPanel, "pod change for a ReplicaSet")
	requireNoDetailsSignal(t, configMapPanel, "a ConfigMap does not list pods")

	requireNoDetailsSignal(t, otherNamespacePanel, "changes in team-a never ring team-b")
}
