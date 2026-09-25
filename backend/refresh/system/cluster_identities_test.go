package system

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	clienttesting "k8s.io/client-go/testing"
)

func TestIdentitiesRegistrationAcceptsAnyReadableSource(t *testing.T) {
	registrations := domainRegistrations(registrationDeps{cfg: Config{ClusterID: "cluster-a"}})
	for _, registration := range registrations {
		if registration.name != "cluster-identities" {
			continue
		}
		require.NotNil(t, registration.list)
		require.True(t, registration.list.allowAny)
		require.False(t, registration.skipRuntimePolicy)
		require.ElementsMatch(t, []listCheck{
			{group: "rbac.authorization.k8s.io", resource: "rolebindings"},
			{group: "rbac.authorization.k8s.io", resource: "clusterrolebindings"},
			{group: "", resource: "serviceaccounts"},
		}, registration.list.checks)
		return
	}
	t.Fatal("Identities is not registered in the production refresh system")
}

func TestIdentitiesProductionIngestInvalidatesBeforeSignaling(t *testing.T) {
	account := &corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "builder", Namespace: "team-a", ResourceVersion: "1", UID: "sa-1"}}
	kube := kubefake.NewClientset(account)
	api := &identityTestAPI{tracker: kube.Tracker()}
	server := httptest.NewServer(api)
	t.Cleanup(server.Close)
	config := &rest.Config{Host: server.URL, QPS: -1, ContentConfig: rest.ContentConfig{ContentType: "application/json", AcceptContentTypes: "application/json"}}
	client, err := kubernetes.NewForConfig(config)
	require.NoError(t, err)
	subsystem, err := NewSubsystemWithServices(Config{KubernetesClient: client, RestConfig: config, ClusterID: "identity-cluster", Logger: applog.Noop,
		ObjectDetailsProvider: noopObjectDetailProvider{}, NodeMaintenanceStore: nodemaintenance.NewStore(5), ResyncInterval: time.Hour})
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(func() {
		cancel()
		subsystem.StopDoorbellNotifiers()
		subsystem.ResourceStream.Stop()
		subsystem.IngestManager.Stop()
		_ = subsystem.InformerFactory.Shutdown()
	})
	selector, err := resourcestream.ParseStreamSelector("identity-cluster", "cluster-identities", "")
	require.NoError(t, err)
	subscription, err := subsystem.ResourceStream.SubscribeSelector(selector)
	require.NoError(t, err)
	defer subscription.Cancel()
	subsystem.IngestManager.Start(ctx)
	require.NoError(t, subsystem.InformerFactory.Start(ctx))
	require.Eventually(t, func() bool {
		return api.watches.Load() == 3
	}, 3*time.Second, 10*time.Millisecond)

	build := func() snapshot.ClusterIdentitiesSnapshot {
		result, buildErr := subsystem.SnapshotService.Build(ctx, "cluster-identities", "identity-cluster|?limit=100")
		require.NoError(t, buildErr)
		return result.Payload.(snapshot.ClusterIdentitiesSnapshot)
	}
	initial := build()
	require.Len(t, initial.Rows, 1)
	require.Len(t, build().Rows, 1) // Prime the cache before the external mutation.

	awaitChange := func(name, rv string, total int) snapshot.ClusterIdentitiesSnapshot {
		t.Helper()
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()
		for {
			select {
			case update := <-subscription.Updates:
				if update.Ref == nil || update.Ref.Name != name || update.ResourceVersion != rv {
					continue
				}
				require.Equal(t, "identity-cluster", update.ClusterID)
				require.Equal(t, "", update.Scope)
				payload := build()
				require.Equal(t, total, payload.Total, "signal must follow source commit and cache invalidation")
				require.Len(t, payload.Rows, total)
				return payload
			case <-timer.C:
				t.Fatal("production ingestion did not signal the identities subscriber")
				return snapshot.ClusterIdentitiesSnapshot{}
			}
		}
	}
	binding, err := kube.RbacV1().RoleBindings("team-a").Create(ctx, &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a", ResourceVersion: "2", UID: "binding-1", Finalizers: []string{"test.example/hold"}},
		Subjects:   []rbacv1.Subject{{Kind: "User", APIGroup: rbacv1.GroupName, Name: "alice"}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.Contains(t, awaitChange("readers", "2", 2).Kinds, "User")
	binding.Subjects[0].Name = "bob"
	binding.ResourceVersion = "3"
	binding, err = kube.RbacV1().RoleBindings("team-a").Update(ctx, binding, metav1.UpdateOptions{})
	require.NoError(t, err)
	changed := awaitChange("readers", "3", 2)
	require.Equal(t, "bob", changed.Rows[0].Name)
	now := metav1.Now()
	binding.DeletionTimestamp = &now
	binding.ResourceVersion = "4"
	_, err = kube.RbacV1().RoleBindings("team-a").Update(ctx, binding, metav1.UpdateOptions{})
	require.NoError(t, err)
	awaitChange("readers", "4", 2) // Deletion requested is still a present binding.
	require.NoError(t, kube.RbacV1().RoleBindings("team-a").Delete(ctx, "readers", metav1.DeleteOptions{}))
	require.NotContains(t, awaitChange("readers", "4", 1).Kinds, "User")

	_, err = kube.RbacV1().ClusterRoleBindings().Create(ctx, &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "auditors", ResourceVersion: "5", UID: "binding-2"},
		Subjects:   []rbacv1.Subject{{Kind: "Group", APIGroup: rbacv1.GroupName, Name: "auditors"}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.Contains(t, awaitChange("auditors", "5", 2).Kinds, "Group")
	require.NoError(t, kube.RbacV1().ClusterRoleBindings().Delete(ctx, "auditors", metav1.DeleteOptions{}))
	awaitChange("auditors", "5", 1)
	require.NoError(t, kube.CoreV1().ServiceAccounts("team-a").Delete(ctx, "builder", metav1.DeleteOptions{}))
	require.Empty(t, awaitChange("builder", "1", 0).Rows)
}

// The production owned-ingest reflectors need a real REST client. This API keeps
// permission checks, LIST/WatchList, projection commit, and notification ordering
// in the test while the tracker supplies deterministic external mutations.
type identityTestAPI struct {
	tracker clienttesting.ObjectTracker
	watches atomic.Int32
}

func (api *identityTestAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if strings.HasSuffix(r.URL.Path, "/selfsubjectaccessreviews") {
		review := &authorizationv1.SelfSubjectAccessReview{}
		if err := json.NewDecoder(r.Body).Decode(review); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		resource := review.Spec.ResourceAttributes.Resource
		review.Status.Allowed = resource == "rolebindings" || resource == "clusterrolebindings" || resource == "serviceaccounts"
		_ = json.NewEncoder(w).Encode(review)
		return
	}
	resource := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
	gvk := schema.GroupVersionKind{Group: rbacv1.GroupName, Version: "v1"}
	switch resource {
	case "rolebindings":
		gvk.Kind = "RoleBinding"
	case "clusterrolebindings":
		gvk.Kind = "ClusterRoleBinding"
	case "serviceaccounts":
		gvk.Group, gvk.Kind = "", "ServiceAccount"
	default:
		http.NotFound(w, r)
		return
	}
	gvr := gvk.GroupVersion().WithResource(resource)
	codec := clientgoscheme.Codecs.LegacyCodec(gvk.GroupVersion())
	if r.URL.Query().Get("watch") == "true" {
		api.serveWatch(w, r, gvr, gvk, codec)
		return
	}
	list, err := api.tracker.List(gvr, gvk, "")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	data, err := runtime.Encode(codec, list)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	_, _ = w.Write(data)
}

func (api *identityTestAPI) serveWatch(w http.ResponseWriter, r *http.Request, gvr schema.GroupVersionResource, gvk schema.GroupVersionKind, codec runtime.Encoder) {
	watcher, err := api.tracker.Watch(gvr, "")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer watcher.Stop()
	w.WriteHeader(http.StatusOK)
	flusher := w.(http.Flusher)
	flusher.Flush()
	send := func(event watch.EventType, obj runtime.Object) bool {
		data, err := runtime.Encode(codec, obj)
		if err != nil {
			return false
		}
		err = json.NewEncoder(w).Encode(metav1.WatchEvent{Type: string(event), Object: runtime.RawExtension{Raw: data}})
		flusher.Flush()
		return err == nil
	}
	if r.URL.Query().Get("sendInitialEvents") == "true" {
		list, err := api.tracker.List(gvr, gvk, "")
		if err != nil {
			return
		}
		items, _ := apimeta.ExtractList(list)
		for _, item := range items {
			if !send(watch.Added, item) {
				return
			}
		}
		bookmark, _ := clientgoscheme.Scheme.New(gvk)
		meta, _ := apimeta.Accessor(bookmark)
		meta.SetResourceVersion("1")
		meta.SetAnnotations(map[string]string{"k8s.io/initial-events-end": "true"})
		if !send(watch.Bookmark, bookmark) {
			return
		}
	}
	api.watches.Add(1)
	for {
		select {
		case <-r.Context().Done():
			return
		case event, open := <-watcher.ResultChan():
			if !open || !send(event.Type, event.Object) {
				return
			}
		}
	}
}
