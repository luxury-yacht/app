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

// newDetailsSignalSubsystem starts a production subsystem whose ingest kinds
// stay unlaunched, with response-cache eviction registered.
func newDetailsSignalSubsystem(t *testing.T) (*workspaceCoordinatorTestFixture, string, *system.Subsystem) {
	t.Helper()
	app, target := catalogLifecycleTestApp(t, system.TierForeground, false)
	clusterID := target.meta.ID
	clients := app.ClusterRuntime.clusterClientsForID(clusterID)
	kube := clients.client.(*kubefake.Clientset)
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		// Ingest kinds stay unlaunched: their reflectors need a real API server,
		// so the test writes to their stores the way a reflector would.
		review.Status.Allowed = false
		return true, review, nil
	})
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	subsystem, err := system.NewSubsystemWithServices(context.Background(), system.Config{
		KubernetesClient: kube, APIExtensionsClient: clients.apiextensionsClient, DynamicClient: clients.dynamicClient,
		ClusterID: clusterID, ClusterName: target.meta.Name, Logger: app.AppLogs.Logger(),
		ObjectDetailsProvider: app.Resources.objectDetailProvider(), NodeMaintenanceStore: app.NodeMaintenanceStore,
	})
	require.NoError(t, err)
	app.Refresh.setRefreshSubsystem(clusterID, subsystem)
	app.Resources.responseCache = newResponseCache(time.Minute, 10)
	app.Refresh.registerResponseCacheInvalidation(subsystem, clusterID)
	t.Cleanup(func() {
		cancel()
		subsystem.ResourceStream.Stop()
		subsystem.IngestManager.Stop()
	})
	subsystem.IngestManager.Start(ctx)
	return app, clusterID, subsystem
}

// Only Kubernetes clients are fake: subsystem construction, reflectors, ingest
// stores and sinks, response-cache eviction, and the outbound doorbell are the
// production path. Ingest-owned kinds are written to their stores directly, as
// their reflectors would.
func TestObjectDetailsSignalFollowsEvictionThroughProductionWiring(t *testing.T) {
	app, clusterID, subsystem := newDetailsSignalSubsystem(t)

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
	replicaSets := subsystem.IngestManager.StoreFor(appsv1.SchemeGroupVersion.WithResource("replicasets"))
	require.NotNil(t, replicaSets)

	// Ingest path (ReplicaSet): create, update, completed delete each evict the
	// cached details and ring only that object's panel.
	seed(replicaSetKeys)
	replicaSet := &appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web", UID: "rs-uid", ResourceVersion: "1"}}
	require.NoError(t, replicaSets.Add(replicaSet))
	requireDetailsSignal(t, app, clusterID, replicaSetPanel, "create", replicaSetKeys...)

	seed(replicaSetKeys)
	updated := replicaSet.DeepCopy()
	updated.ResourceVersion = "2"
	updated.Labels = map[string]string{"tier": "web"}
	require.NoError(t, replicaSets.Update(updated))
	requireDetailsSignal(t, app, clusterID, replicaSetPanel, "update", replicaSetKeys...)

	seed(replicaSetKeys)
	require.NoError(t, replicaSets.Delete(updated))
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

// A Helm storage record changing in the Secrets or ConfigMaps ingest store
// evicts the release's cached details, manifest, and values before the
// release's panel rings. A relist of an unchanged record rings nothing.
func TestHelmReleaseDetailsSignalFollowsEvictionThroughProductionWiring(t *testing.T) {
	app, clusterID, subsystem := newDetailsSignalSubsystem(t)
	releasePanel := subscribeObjectDetails(t, subsystem, clusterID, "team-a:helm.sh/v3:HelmRelease:demo")
	otherPanel := subscribeObjectDetails(t, subsystem, clusterID, "team-a:helm.sh/v3:HelmRelease:other")
	keys := []string{
		objectDetailCacheKey("HelmRelease", "team-a", "demo"),
		objectDetailCacheKey("HelmManifest", "team-a", "demo"),
		objectDetailCacheKey("HelmValues", "team-a", "demo"),
	}
	seed := func() {
		for _, key := range keys {
			app.Resources.seedResponseCache(clusterID, key, "pre-change copy")
		}
	}
	secrets := subsystem.IngestManager.StoreFor(corev1.SchemeGroupVersion.WithResource("secrets"))
	configMaps := subsystem.IngestManager.StoreFor(corev1.SchemeGroupVersion.WithResource("configmaps"))
	require.NotNil(t, secrets)
	require.NotNil(t, configMaps)

	seed()
	record := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "sh.helm.release.v1.demo.v1", UID: "secret-uid", ResourceVersion: "1",
			Labels: map[string]string{"owner": "helm", "name": "demo", "status": "deployed", "version": "1"}},
		Type: "helm.sh/release.v1",
	}
	require.NoError(t, secrets.Add(record))
	requireDetailsSignal(t, app, clusterID, releasePanel, "release Secret created", keys...)

	require.NoError(t, secrets.Replace([]interface{}{record.DeepCopy()}, "5"))
	requireNoDetailsSignal(t, releasePanel, "relist of an unchanged release Secret")

	seed()
	require.NoError(t, configMaps.Add(&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{
		Namespace: "team-a", Name: "sh.helm.release.v1.demo.v2", UID: "configmap-uid", ResourceVersion: "2",
		Labels: map[string]string{"owner": "helm", "name": "demo", "status": "deployed", "version": "2"},
	}}))
	requireDetailsSignal(t, app, clusterID, releasePanel, "release ConfigMap created", keys...)

	seed()
	require.NoError(t, secrets.Delete(record))
	requireDetailsSignal(t, app, clusterID, releasePanel, "release Secret deleted", keys...)
	requireNoDetailsSignal(t, otherPanel, "another release's panel")
}
