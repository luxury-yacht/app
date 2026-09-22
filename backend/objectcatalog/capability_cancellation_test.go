package objectcatalog

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

type capabilityFailureLogger struct {
	applog.Logger
	mu     sync.Mutex
	causes []error
}

func (l *capabilityFailureLogger) ErrorWithCause(err error, _ string, _ ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.causes = append(l.causes, err)
}

type capabilityFailureTransport func(*http.Request) (*http.Response, error)

func (f capabilityFailureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestCatalogCapabilityFailureDoesNotCancelSiblingChecks(t *testing.T) {
	resources := []metav1.APIResource{
		{Name: "alphas", Kind: "Alpha", Verbs: []string{"list"}},
		{Name: "betas", Kind: "Beta", Verbs: []string{"list"}},
		{Name: "gammas", Kind: "Gamma", Verbs: []string{"list"}},
		{Name: "deltas", Kind: "Delta", Verbs: []string{"list"}},
	}
	var requests, arrived, completed atomic.Int32
	allArrived := make(chan struct{})
	failureReturned := make(chan struct{})
	var failureOnce sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var review authorizationv1.SelfSubjectAccessReview
		if err := json.NewDecoder(r.Body).Decode(&review); err != nil {
			t.Errorf("decode permission review: %v", err)
			return
		}
		if arrived.Add(1) == int32(len(resources)) {
			close(allArrived)
		}
		select {
		case <-allArrived:
		case <-r.Context().Done():
			return
		}
		// Keep every sibling in flight before the first fallback request fails.
		if review.Spec.ResourceAttributes.Resource == resources[0].Name {
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Errorf("close failing request: %v", err)
				return
			}
			_ = connection.Close()
			return
		}
		select {
		case <-failureReturned:
		case <-r.Context().Done():
			return
		}
		select {
		case <-time.After(50 * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		completed.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(authorizationv1.SelfSubjectAccessReview{
			TypeMeta: metav1.TypeMeta{APIVersion: "authorization.k8s.io/v1", Kind: "SelfSubjectAccessReview"},
			Status:   authorizationv1.SubjectAccessReviewStatus{Allowed: false},
		})
	}))
	defer server.Close()
	base := http.DefaultTransport.(*http.Transport).Clone()
	defer base.CloseIdleConnections()
	transport := capabilityFailureTransport(func(r *http.Request) (*http.Response, error) {
		// Fail the initial batch; fallback checks use Go's real transport.
		if requests.Add(1) <= int32(len(resources)) {
			return nil, io.EOF
		}
		response, err := base.RoundTrip(r)
		if err != nil {
			failureOnce.Do(func() { close(failureReturned) })
		}
		return response, err
	})
	client, err := kubernetes.NewForConfig(&rest.Config{
		Host: server.URL, Transport: transport, QPS: 1000, Burst: 1000,
		ContentConfig: rest.ContentConfig{ContentType: "application/json"},
	})
	require.NoError(t, err)
	logger := &capabilityFailureLogger{Logger: applog.Noop}
	discoveryClient := kubernetesfake.NewClientset()
	svc := NewService(Dependencies{
		ClusterID: "test-cluster",
		Logger:    applog.Noop,
		CapabilityFactory: func() *capabilities.Service {
			return capabilities.NewService(capabilities.Dependencies{
				Common: common.Dependencies{
					ClusterID: "test-cluster", KubernetesClient: client, Logger: logger,
				},
				WorkerCount: len(resources),
			})
		},
	}, &Options{ListWorkers: len(resources)})
	svc.discoveryClient = &preferredDiscovery{
		FakeDiscovery: discoveryClient.Discovery().(*fakediscovery.FakeDiscovery),
		resources:     []*metav1.APIResourceList{{GroupVersion: "example.invalid/v1", APIResources: resources}},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err = svc.sync(ctx)
	require.Error(t, err, "the original permission failure must reach the catalog")
	require.NoError(t, ctx.Err(), "one failed permission check must not cancel the parent")
	require.Equal(t, int32(len(resources)), arrived.Load(), "exercise concurrent fallback requests")
	require.Equal(t, int32(len(resources)-1), completed.Load(), "all sibling permission checks must finish")
	require.Equal(t, HealthStateDegraded, svc.Health().Status)
	logger.mu.Lock()
	defer logger.mu.Unlock()
	require.Len(t, logger.causes, 2, "report the failed batch and original fallback failure, without canceled siblings")
	for _, cause := range logger.causes {
		require.ErrorIs(t, cause, io.EOF, "retain the original transport failures")
	}
}
