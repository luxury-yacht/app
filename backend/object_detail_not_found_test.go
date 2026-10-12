package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/api"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

const notFoundDetailClusterID = "config:not-found"

var (
	appsDeploymentGVK    = schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	exampleDeploymentGVK = schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Deployment"}
)

func notFoundTestDeployment(namespace, name string) *appsv1.Deployment {
	return &appsv1.Deployment{
		TypeMeta:   metav1.TypeMeta{APIVersion: "apps/v1", Kind: "Deployment"},
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": name}},
		},
	}
}

func notFoundTestCustomDeployment(namespace, name string) *unstructured.Unstructured {
	object := &unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"namespace": namespace, "name": name},
	}}
	object.SetGroupVersionKind(exampleDeploymentGVK)
	return object
}

// newNotFoundDetailCluster serves apps/v1 Deployments and a same-kind custom
// resource in example.com. typed seeds the typed detail fetcher's client;
// live seeds the uncached GVK read that confirms an object is gone.
func newNotFoundDetailCluster(t *testing.T, typed []runtime.Object, live []runtime.Object) *ResourceGateway {
	t.Helper()
	kubeClient := clientfake.NewClientset(typed...)
	allowSelfSubjectAccessReviews(kubeClient)
	kubeClient.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{
		{GroupVersion: "apps/v1", APIResources: []metav1.APIResource{
			{Name: "deployments", SingularName: "deployment", Namespaced: true, Kind: "Deployment"},
		}},
		{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{
			{Name: "deployments", SingularName: "deployment", Namespaced: true, Kind: "Deployment"},
		}},
	}
	scheme := runtime.NewScheme()
	require.NoError(t, appsv1.AddToScheme(scheme))
	dynamicClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, map[schema.GroupVersionResource]string{
		{Group: "example.com", Version: "v1", Resource: "deployments"}: "DeploymentList",
	}, live...)
	return newObjectDetailResourceGateway(map[string]*clusterClients{
		notFoundDetailClusterID: {
			meta:              ClusterMeta{ID: notFoundDetailClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            kubeClient,
			dynamicClient:     dynamicClient,
		},
	})
}

// fetchDeploymentDetailsOverRefresh requests default/web's details through the
// real object-details builder and refresh API, as the object panel does.
func fetchDeploymentDetailsOverRefresh(t *testing.T, gateway *ResourceGateway) (*httptest.ResponseRecorder, errorstatus.Status) {
	t.Helper()
	registry := domain.New()
	require.NoError(t, snapshot.RegisterObjectDetailsDomain(registry, gateway.objectDetailProvider()))
	service := snapshot.NewServiceWithPermissions(registry, nil, snapshot.ClusterMeta{
		ClusterID: notFoundDetailClusterID, ClusterName: "ctx",
	}, nil)
	mux := http.NewServeMux()
	api.NewServer(service, refresh.NewInMemoryQueue(), nil, nil).Register(mux)

	// The object panel sends the kind lowercased (objectPanelRef.ts); the
	// reference must still name the canonical kind the panel compares against.
	scope := refresh.JoinClusterScope(notFoundDetailClusterID, "default:apps/v1:deployment:web")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/snapshots/object-details?scope="+url.QueryEscape(scope), nil))
	var status errorstatus.Status
	if recorder.Code != http.StatusOK {
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &status))
	}
	return recorder, status
}

// The object panel closes its object only on a NotFound naming exactly that
// object, so the reference is attached only after the object itself is
// confirmed gone.
func TestObjectDetailsNotFoundNamesOnlyAConfirmedMissingObject(t *testing.T) {
	t.Run("the requested object was deleted", func(t *testing.T) {
		gateway := newNotFoundDetailCluster(t, nil, nil)

		recorder, status := fetchDeploymentDetailsOverRefresh(t, gateway)

		require.Equal(t, http.StatusNotFound, recorder.Code)
		require.Equal(t, errorstatus.ReasonNotFound, status.Reason)
		require.Equal(t, &errorstatus.ObjectRef{
			ClusterID: notFoundDetailClusterID, Group: "apps", Version: "v1",
			Kind: "Deployment", Namespace: "default", Name: "web",
		}, status.Ref)
	})

	t.Run("a lookup failed while the requested object exists", func(t *testing.T) {
		// The typed fetch misses the object, but the live read finds it.
		gateway := newNotFoundDetailCluster(t, nil, []runtime.Object{notFoundTestDeployment("default", "web")})

		recorder, status := fetchDeploymentDetailsOverRefresh(t, gateway)

		require.Equal(t, http.StatusNotFound, recorder.Code)
		require.Nil(t, status.Ref)
	})

	t.Run("same-name objects in another namespace or group", func(t *testing.T) {
		gateway := newNotFoundDetailCluster(t,
			[]runtime.Object{notFoundTestDeployment("other", "web")},
			[]runtime.Object{notFoundTestDeployment("other", "web"), notFoundTestCustomDeployment("default", "web")},
		)

		recorder, status := fetchDeploymentDetailsOverRefresh(t, gateway)

		require.Equal(t, http.StatusNotFound, recorder.Code)
		require.NotNil(t, status.Ref)
		require.Equal(t, "default", status.Ref.Namespace)
		require.Equal(t, "apps", status.Ref.Group)
	})

	t.Run("an existing object is served", func(t *testing.T) {
		deployment := notFoundTestDeployment("default", "web")
		gateway := newNotFoundDetailCluster(t, []runtime.Object{deployment}, []runtime.Object{deployment.DeepCopy()})

		recorder, _ := fetchDeploymentDetailsOverRefresh(t, gateway)

		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	})
}

// The YAML tab shows this message, and callers need the API NotFound behind it.
func TestFetchObjectByGVKKeepsTheAPINotFound(t *testing.T) {
	gateway := newNotFoundDetailCluster(t, nil, nil)
	deps, _, err := gateway.resolveClusterDependencies(notFoundDetailClusterID)
	require.NoError(t, err)

	_, err = fetchObjectByGVK(context.Background(), deps, appsDeploymentGVK, "default", "web")

	require.True(t, apierrors.IsNotFound(err))
	require.Equal(t, `apps/v1, Kind=Deployment "web" not found in namespace "default"`, err.Error())
}

// newMissingHelmReleaseGateway serves a cluster whose Helm storage holds no
// release secrets, as after `helm uninstall`. With versionNotFound, the API
// server answers its /version probe with a 404, so Helm cannot reach it.
func newMissingHelmReleaseGateway(t *testing.T, clusterID string, versionNotFound bool) *ResourceGateway {
	t.Helper()
	client := clientfake.NewClientset()
	allowSelfSubjectAccessReviews(client)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/version":
			if versionNotFound {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write([]byte(`{"major":"1","minor":"34","gitVersion":"v1.34.0"}`))
		case "/api/v1/namespaces/default/secrets":
			_ = json.NewEncoder(w).Encode(corev1.SecretList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "SecretList"}})
		default:
			t.Errorf("unexpected Helm API request: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	configPath := filepath.Join(t.TempDir(), "config")
	require.NoError(t, clientcmd.WriteToFile(clientcmdapi.Config{
		Clusters:  map[string]*clientcmdapi.Cluster{"test": {Server: server.URL}},
		Contexts:  map[string]*clientcmdapi.Context{"test": {Cluster: "test", AuthInfo: "test"}},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{"test": {}}, CurrentContext: "test",
	}, configPath))
	return newObjectDetailResourceGateway(map[string]*clusterClients{
		clusterID: {client: client, kubeconfigPath: configPath, kubeconfigContext: "test"},
	})
}

// A Helm release is gone when Helm storage has no record of it. The panel
// closes on that only if the NotFound names the release's full synthetic
// identity; the panel sends the kind lowercased.
func TestMissingHelmReleaseIsANotFoundNamingTheRelease(t *testing.T) {
	const clusterID = "cluster-a"
	provider := newMissingHelmReleaseGateway(t, clusterID, false).objectDetailProvider().(*objectDetailProvider)
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: clusterID})

	t.Run("details", func(t *testing.T) {
		gvk := schema.GroupVersionKind{Group: "helm.sh", Version: "v3", Kind: "helmrelease"}
		_, err := provider.FetchObjectDetails(ctx, gvk, "default", "demo")

		status := errorstatus.Classify(err)
		require.Equal(t, errorstatus.ReasonNotFound, status.Reason)
		require.True(t, status.Expected)
		require.Equal(t, &errorstatus.ObjectRef{
			ClusterID: clusterID, Group: "helm.sh", Version: "v3",
			Kind: "HelmRelease", Namespace: "default", Name: "demo",
		}, status.Ref)
	})

	t.Run("manifest and values", func(t *testing.T) {
		_, _, manifestErr := provider.FetchHelmManifest(ctx, "default", "demo")
		_, _, valuesErr := provider.FetchHelmValues(ctx, "default", "demo")

		for _, err := range []error{manifestErr, valuesErr} {
			status := errorstatus.Classify(err)
			require.Equal(t, errorstatus.ReasonNotFound, status.Reason, err)
			require.True(t, status.Expected)
		}
	})
}

// Only Helm storage saying it has no such release means the release is gone.
// A 404 from the API server while reaching it must not close the panel.
func TestUnreachableHelmClusterDoesNotNameTheRelease(t *testing.T) {
	const clusterID = "cluster-a"
	provider := newMissingHelmReleaseGateway(t, clusterID, true).objectDetailProvider().(*objectDetailProvider)
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: clusterID})

	_, err := provider.FetchObjectDetails(ctx, schema.GroupVersionKind{Group: "helm.sh", Version: "v3", Kind: "HelmRelease"}, "default", "demo")

	require.Error(t, err)
	require.Nil(t, errorstatus.Classify(err).Ref, err)
}
