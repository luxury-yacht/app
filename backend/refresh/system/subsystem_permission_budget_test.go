package system

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
)

// slowAccessReviewTransport is a reachable API server whose access reviews
// succeed after a fixed latency. It runs in-process so synctest can advance
// the latency on its fake clock.
type slowAccessReviewTransport struct {
	latency time.Duration
}

func (s *slowAccessReviewTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if !strings.HasSuffix(req.URL.Path, "/selfsubjectaccessreviews") {
		return jsonResponse(req, http.StatusNotFound, `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404}`), nil
	}
	select {
	case <-time.After(s.latency):
	case <-req.Context().Done():
		return nil, req.Context().Err()
	}
	return jsonResponse(req, http.StatusCreated, `{"kind":"SelfSubjectAccessReview","apiVersion":"authorization.k8s.io/v1","status":{"allowed":true}}`), nil
}

func jsonResponse(req *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

// A reachable cluster whose permission phase is slow in total — but whose
// individual reviews each finish inside PermissionCheckTimeout — must still
// connect. Only caller cancellation may abort construction.
func TestSlowButHealthyPermissionReviewsStillBuildSubsystem(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		transport := &slowAccessReviewTransport{latency: 2 * time.Second}
		restCfg := &rest.Config{Host: "https://slow-cluster.invalid", Transport: transport, QPS: -1}
		client, err := kubernetes.NewForConfig(restCfg)
		require.NoError(t, err)

		start := time.Now()
		subsystem, err := NewSubsystemWithServices(t.Context(), Config{
			KubernetesClient: client, RestConfig: restCfg, ClusterID: "slow-cluster",
			APIExtensionsClient: apiextensionsfake.NewClientset(),
			DynamicClient:       dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
			Logger:              applog.Noop, ObjectDetailsProvider: noopObjectDetailProvider{},
			NodeMaintenanceStore: nodemaintenance.NewStore(5),
			ResyncInterval:       time.Minute, MetricsInterval: time.Minute,
		})
		elapsed := time.Since(start)

		require.NoError(t, err, "slow but successful reviews must not fail construction")
		require.NotNil(t, subsystem)
		t.Cleanup(func() {
			subsystem.StopDoorbellNotifiers()
			subsystem.ResourceStream.Stop()
			subsystem.IngestManager.Stop()
			_ = subsystem.InformerFactory.Shutdown()
		})
		require.Greater(t, elapsed, config.PermissionPreflightTimeout,
			"the scenario must exceed the preflight budget to prove it bounds only priming")
		require.Empty(t, subsystem.PermissionIssues, "every slow review succeeded, so no domain may record an issue")
	})
}
