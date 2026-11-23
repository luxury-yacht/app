package backend

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/openapi"
	"k8s.io/client-go/openapi/openapitest"
	"k8s.io/client-go/rest"
)

var deploymentKindRef = resourcemodel.ResourceRef{
	ClusterID: "cluster-a", Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments",
}

func TestExplainKindHonorsRevokedSchemaAccess(t *testing.T) {
	paths, err := openapitest.NewEmbeddedFileClient().Paths()
	require.NoError(t, err)
	document, err := paths["apis/apps/v1"].Schema("application/json")
	require.NoError(t, err)
	var forbidden atomic.Bool
	var schemaRequests, downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer explain-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/openapi/v3":
			_, _ = io.WriteString(w, `{"paths":{"apis/apps/v1":{"serverRelativeURL":"/openapi/v3/apis/apps/v1?hash=schema"}}}`)
		case "/openapi/v3/apis/apps/v1":
			schemaRequests.Add(1)
			if forbidden.Load() {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			const etag = `"schema"`
			w.Header().Set("ETag", etag)
			if r.Header.Get("If-None-Match") != etag {
				downloads.Add(1)
			}
			http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(document))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	cfg := &rest.Config{Host: server.URL, BearerToken: "explain-test"}
	client, err := kubernetes.NewForConfig(cfg)
	require.NoError(t, err)
	fixture := newResourceGatewayFixture()
	fixture.setCluster("cluster-a", &clusterClients{
		meta:       ClusterMeta{ID: "cluster-a"},
		client:     client,
		restConfig: cfg,
	})
	desktop := &DesktopService{resources: fixture.gateway}
	first, err := desktop.ExplainKindSchema(deploymentKindRef)
	require.NoError(t, err)
	require.Equal(t, "Deployment", first.Kind)

	field, err := desktop.ExplainKindField(deploymentKindRef, []string{"spec", "strategy"}, first.Revision)
	require.NoError(t, err)
	require.Equal(t, "DeploymentStrategy", field.Type)
	require.EqualValues(t, 2, schemaRequests.Load(), "both reads must reach the API server")
	require.EqualValues(t, 1, downloads.Load(), "an authorized 304 reuses the schema bytes")

	// Access to the index stays allowed and its schema URL does not change.
	forbidden.Store(true)
	field, err = desktop.ExplainKindField(deploymentKindRef, []string{"spec"}, first.Revision)
	require.Equal(t, errorstatus.ReasonForbidden, errorstatus.Classify(err).Reason)
	require.Nil(t, field)
	denied, err := desktop.ExplainKindSchema(deploymentKindRef)
	require.Equal(t, errorstatus.ReasonForbidden, errorstatus.Classify(err).Reason)
	require.Nil(t, denied)

	forbidden.Store(false)
	firstAgain, err := desktop.ExplainKindSchema(deploymentKindRef)
	require.NoError(t, err)
	require.Equal(t, first.Revision, firstAgain.Revision)
	require.EqualValues(t, 5, schemaRequests.Load())

	t.Run("existing client without REST config", func(t *testing.T) {
		fixture.setCluster("cluster-a", &clusterClients{meta: ClusterMeta{ID: "cluster-a"}, client: client})
		_, err := desktop.ExplainKindSchema(deploymentKindRef)
		require.NoError(t, err)
		forbidden.Store(true)
		_, err = desktop.ExplainKindSchema(deploymentKindRef)
		require.Equal(t, errorstatus.ReasonForbidden, errorstatus.Classify(err).Reason)
	})
}

func explainGatewayFixture() *resourceGatewayFixture {
	fixture := newResourceGatewayFixture()
	fixture.setCluster("cluster-a", &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}})
	fixture.gateway.openAPIClientFn = func(common.Dependencies) (openapi.Client, error) {
		return openapitest.NewEmbeddedFileClient(), nil
	}
	return fixture
}

func TestExplainKindRejectsIncompleteKindIdentity(t *testing.T) {
	fixture := explainGatewayFixture()
	for name, change := range map[string]func(*resourcemodel.ResourceRef){
		"no version":  func(ref *resourcemodel.ResourceRef) { ref.Version = "" },
		"no resource": func(ref *resourcemodel.ResourceRef) { ref.Resource = "" },
	} {
		t.Run(name, func(t *testing.T) {
			target := deploymentKindRef
			change(&target)
			_, err := fixture.gateway.ExplainKindSchema(target)
			require.Equal(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason)
			_, err = fixture.gateway.ExplainKindField(target, []string{"spec"}, "revision")
			require.Equal(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason)
		})
	}
}

// A kind whose group publishes no schema is an answer, not a failure.
func TestExplainKindReportsAKindWithoutASchemaAsNotFound(t *testing.T) {
	fixture := explainGatewayFixture()

	_, err := fixture.gateway.ExplainKindSchema(resourcemodel.ResourceRef{
		ClusterID: "cluster-a", Group: "metrics.k8s.io", Version: "v1beta1", Kind: "NodeMetrics", Resource: "nodes",
	})

	require.Equal(t, errorstatus.ReasonNotFound, errorstatus.Classify(err).Reason)
}
