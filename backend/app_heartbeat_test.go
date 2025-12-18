package backend

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	restfake "k8s.io/client-go/rest/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestRunHeartbeatNoClientSafeguards(t *testing.T) {
	app := &App{}
	app.runHeartbeat() // should no-op without panic
}

func TestRunHeartbeatSkipsDuringRebuild(t *testing.T) {
	app := NewApp()
	app.client = fake.NewSimpleClientset()
	app.transportMu.Lock()
	app.transportRebuildInProgress = true
	app.transportMu.Unlock()
	app.runHeartbeat() // no panic, no call attempted
}

func TestRunHeartbeatFailureUpdatesStatus(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.Ctx = context.Background()

	disco := &heartbeatDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &k8stesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("boom")
			}),
		},
	}
	app.client = &heartbeatClientSet{Clientset: fake.NewSimpleClientset(), disco: disco}

	app.runHeartbeat()
	if app.connectionStatus != ConnectionStateOffline {
		t.Fatalf("expected connection status offline, got %v", app.connectionStatus)
	}
}

func TestRunHeartbeatSuccess(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.Ctx = context.Background()

	disco := &heartbeatDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &k8stesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: 200,
					Body:       io.NopCloser(strings.NewReader("{}")),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			}),
		},
	}
	app.client = &heartbeatClientSet{Clientset: fake.NewSimpleClientset(), disco: disco}

	app.runHeartbeat()
	if app.connectionStatus == ConnectionStateOffline {
		t.Fatalf("expected connection to remain healthy")
	}
}

func TestStartHeartbeatLoopStopsWithContext(t *testing.T) {
	app := NewApp()
	ctx, cancel := context.WithCancel(context.Background())
	app.Ctx = ctx

	app.startHeartbeatLoop()
	cancel()

	// Wait briefly to ensure goroutine observed cancellation; no panic expected.
	time.Sleep(20 * time.Millisecond)
}

// heartbeatDiscovery wraps FakeDiscovery with a configurable REST client.
type heartbeatDiscovery struct {
	*fakediscovery.FakeDiscovery
	restClient rest.Interface
}

func (h *heartbeatDiscovery) RESTClient() rest.Interface {
	return h.restClient
}

// heartbeatClientSet overrides Discovery() to return a custom discovery impl.
type heartbeatClientSet struct {
	*fake.Clientset
	disco *heartbeatDiscovery
}

func (h *heartbeatClientSet) Discovery() discovery.DiscoveryInterface {
	return h.disco
}
