package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestObjectDetailProviderHelmContentCacheAndClusterIsolation(t *testing.T) {
	for _, kind := range []string{"HelmManifest", "HelmValues"} {
		t.Run(kind, func(t *testing.T) {
			client := fake.NewClientset()
			allowSelfSubjectAccessReviews(client)
			rel := &release.Release{
				Name: "demo", Namespace: "default", Version: 7,
				Manifest: "# demo manifest",
				Info:     &release.Info{Status: release.StatusDeployed},
				Chart: &chart.Chart{
					Metadata: &chart.Metadata{Name: "demo", Version: "1.0.0"},
					Values:   map[string]interface{}{"replicas": float64(1)},
				},
				Config: map[string]interface{}{"replicas": float64(3)},
			}
			require.NoError(t, driver.NewSecrets(client.CoreV1().Secrets("default")).Create("sh.helm.release.v1.demo.v7", rel))
			var secretReads atomic.Int32
			var rejectReads atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/version":
					_, _ = w.Write([]byte(`{"major":"1","minor":"34","gitVersion":"v1.34.0"}`))
				case "/api/v1/namespaces/default/secrets":
					secretReads.Add(1)
					if rejectReads.Load() {
						w.WriteHeader(http.StatusForbidden)
						_ = json.NewEncoder(w).Encode(metav1.Status{
							TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Status"},
							Status:   "Failure", Reason: metav1.StatusReasonForbidden, Code: http.StatusForbidden,
						})
						return
					}
					secrets, err := client.CoreV1().Secrets("default").List(r.Context(), metav1.ListOptions{LabelSelector: r.URL.Query().Get("labelSelector")})
					if err != nil {
						t.Error(err)
						w.WriteHeader(http.StatusInternalServerError)
						return
					}
					secrets.TypeMeta = metav1.TypeMeta{APIVersion: "v1", Kind: "SecretList"}
					_ = json.NewEncoder(w).Encode(secrets)
				default:
					t.Errorf("unexpected Helm API request: %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			configPath := filepath.Join(t.TempDir(), "config")
			require.NoError(t, clientcmd.WriteToFile(clientcmdapi.Config{
				Clusters:  map[string]*clientcmdapi.Cluster{"test": {Server: server.URL}},
				Contexts:  map[string]*clientcmdapi.Context{"test": {Cluster: "test", AuthInfo: "test"}},
				AuthInfos: map[string]*clientcmdapi.AuthInfo{"test": {}}, CurrentContext: "test",
			}, configPath))
			gateway := newObjectDetailResourceGateway(map[string]*clusterClients{
				"cluster-a": {client: client, kubeconfigPath: configPath, kubeconfigContext: "test"},
				"cluster-b": {client: client, kubeconfigPath: configPath, kubeconfigContext: "test"},
			})
			provider := gateway.objectDetailProvider().(*objectDetailProvider)
			read := func(clusterID string) (interface{}, int, error) {
				ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: clusterID})
				if kind == "HelmManifest" {
					return provider.FetchHelmManifest(ctx, "default", "demo")
				}
				return provider.FetchHelmValues(ctx, "default", "demo")
			}
			cacheKey := objectDetailCacheKey(kind, "default", "demo")
			gateway.responseCacheStore("cluster-a", cacheKey, 123) // A stale entry with the wrong payload type must be replaced.
			content, revision, err := read("cluster-a")
			require.NoError(t, err)
			require.Equal(t, 7, revision)
			if kind == "HelmManifest" {
				require.Equal(t, rel.Manifest, content)
			} else {
				require.Equal(t, map[string]interface{}{
					"defaultValues": map[string]interface{}{"replicas": float64(1)},
					"allValues":     map[string]interface{}{"replicas": float64(3)},
					"userValues":    map[string]interface{}{"replicas": float64(3)},
				}, content)
			}
			readsAfterFetch := secretReads.Load()
			rejectReads.Store(true)
			cached, cachedRevision, err := read("cluster-a")
			require.NoError(t, err)
			require.Equal(t, content, cached)
			require.Equal(t, revision, cachedRevision)
			require.Equal(t, readsAfterFetch, secretReads.Load(), "authorized cached content should survive unavailable release reads")
			_, _, err = read("cluster-b")
			require.Error(t, err, "another cluster must not receive the cached release")
			gateway.responseCacheDelete("cluster-a", objectDetailCacheKey("HelmRelease", "default", "demo"))
			cached, cachedRevision, err = read("cluster-a")
			require.NoError(t, err, "revision lookup failure must not discard content")
			require.Equal(t, content, cached)
			require.Zero(t, cachedRevision)
			denySelfSubjectAccessReviews(client, "secrets denied")
			_, _, err = read("cluster-a")
			require.Error(t, err)
			_, retained := gateway.responseCacheLookup("cluster-a", cacheKey)
			require.False(t, retained, "permission denial must evict cached content")
			_, _, err = read("")
			require.Error(t, err)
		})
	}
}
