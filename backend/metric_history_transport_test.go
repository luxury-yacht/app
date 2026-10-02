package backend

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/metrichistory"
	"github.com/luxury-yacht/app/backend/metrichistory/prometheus"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/kubernetes/scheme"
	restfake "k8s.io/client-go/rest/fake"
)

// proxyClient answers every API-server request with status/body and records the request.
func proxyClient(status int, body string, seen *[]*http.Request) *restfake.RESTClient {
	return &restfake.RESTClient{
		GroupVersion:         corev1.SchemeGroupVersion,
		NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
		VersionedAPIPath:     "/api/v1",
		Client: restfake.CreateHTTPClient(func(request *http.Request) (*http.Response, error) {
			*seen = append(*seen, request)
			return &http.Response{
				StatusCode: status,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		}),
	}
}

var proxyTestTarget = MetricInClusterTarget{
	ClusterID:  "dev:dev-cluster",
	Namespace:  "monitoring",
	Service:    "prometheus-operated",
	Port:       "web",
	Scheme:     "https",
	PathPrefix: "/prometheus",
}

func TestInClusterQueriesGoThroughTheServiceProxy(t *testing.T) {
	var seen []*http.Request
	querier := inClusterQuerier{client: proxyClient(http.StatusOK, `{"status":"success"}`, &seen), target: proxyTestTarget}
	grid := metrichistory.Grid{StartMs: 1_790_894_640_000, StepMs: 30_000, Count: 21}

	_, err := querier.QueryRange(context.Background(), `up{job="kubelet"}`, grid)
	require.NoError(t, err)

	require.Len(t, seen, 1)
	require.Equal(t, http.MethodGet, seen[0].Method)
	require.Equal(t, "/api/v1/namespaces/monitoring/services/https:prometheus-operated:web/proxy/prometheus/api/v1/query_range", seen[0].URL.Path)
	query := seen[0].URL.Query()
	require.Equal(t, `up{job="kubelet"}`, query.Get("query"))
	require.Equal(t, "1790894640", query.Get("start"))
	require.Equal(t, "1790895240", query.Get("end"))
	require.Equal(t, "30", query.Get("step"))
}

func TestInClusterQueriesKeepPrometheusErrorBodies(t *testing.T) {
	var seen []*http.Request
	body := `{"status":"error","errorType":"bad_data","error":"invalid parameter \"query\": 1:5: parse error"}`
	querier := inClusterQuerier{client: proxyClient(http.StatusBadRequest, body, &seen), target: proxyTestTarget}
	grid := metrichistory.Grid{StartMs: 0, StepMs: 30_000, Count: 2}

	// The API-server proxy relays Prometheus' 400 unchanged; its reason must reach the user.
	returned, err := querier.QueryRange(context.Background(), "sum(", grid)
	require.NoError(t, err)
	_, decodeErr := prometheus.DecodeMatrix(returned, grid)
	var apiErr *prometheus.APIError
	require.True(t, errors.As(decodeErr, &apiErr))
	require.Equal(t, "bad_data", apiErr.Type)
}

func TestInClusterQueriesReportProxyFailures(t *testing.T) {
	var seen []*http.Request
	body := `{"kind":"Status","apiVersion":"v1","status":"Failure","message":"no endpoints available for service \"prometheus-operated\"","reason":"ServiceUnavailable","code":503}`
	querier := inClusterQuerier{client: proxyClient(http.StatusServiceUnavailable, body, &seen), target: proxyTestTarget}

	// DoRaw drops a JSON Status message; the user must still see the API server's reason.
	_, err := querier.BuildInfo(context.Background())
	require.True(t, apierrors.IsServiceUnavailable(err), "got %v", err)
	require.ErrorContains(t, err, "no endpoints available")
	require.Equal(t, "/api/v1/namespaces/monitoring/services/https:prometheus-operated:web/proxy/prometheus/api/v1/status/buildinfo", seen[0].URL.Path)
}
