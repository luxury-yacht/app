package system

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh/ingest/ingesttest"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
)

// reflectedBuiltinKinds are the built-in kinds the subsystem watches without a
// stream descriptor, so the API server must serve them explicitly.
var reflectedBuiltinKinds = []schema.GroupVersionKind{
	corev1.SchemeGroupVersion.WithKind("Pod"),
	corev1.SchemeGroupVersion.WithKind("Node"),
	corev1.SchemeGroupVersion.WithKind("Service"),
	corev1.SchemeGroupVersion.WithKind("Namespace"),
	corev1.SchemeGroupVersion.WithKind("Event"),
	discoveryv1.SchemeGroupVersion.WithKind("EndpointSlice"),
	appsv1.SchemeGroupVersion.WithKind("Deployment"),
	appsv1.SchemeGroupVersion.WithKind("StatefulSet"),
	appsv1.SchemeGroupVersion.WithKind("DaemonSet"),
	appsv1.SchemeGroupVersion.WithKind("ReplicaSet"),
	batchv1.SchemeGroupVersion.WithKind("Job"),
	batchv1.SchemeGroupVersion.WithKind("CronJob"),
}

// newReflectorAPIServer serves every kind the subsystem reflects and allows
// every access review except the metrics API, which leaves the metrics poller
// off.
func newReflectorAPIServer(t *testing.T) *ingesttest.APIServer {
	t.Helper()
	server := ingesttest.NewAPIServer(t, reflectedBuiltinKinds...)
	server.Allow(func(attrs authorizationv1.ResourceAttributes) bool { return attrs.Group != "metrics.k8s.io" })
	return server
}

// reflectorHarness is the production subsystem with its owned reflectors
// running against an API server: LIST and WatchList, watch events, resume from
// a spilled resourceVersion, and the relist after a watch gap.
type reflectorHarness struct {
	subsystem *Subsystem
	stop      func()
}

// newReflectorHarness starts a subsystem against server. restoreFrom, when
// set, is a spill directory restored before the reflectors start, as a
// re-warm does: the maintained stores repaint from it, and each reflector
// resumes from its spilled resourceVersion.
func newReflectorHarness(t *testing.T, server *ingesttest.APIServer, restoreFrom string, options ...func(*Config)) *reflectorHarness {
	t.Helper()
	cfg := Config{
		KubernetesClient: server.Client(t), APIExtensionsClient: server.APIExtensionsClient(t),
		DynamicClient: dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()), ClusterID: "c1",
		Logger: applog.Noop, ObjectDetailsProvider: noopObjectDetailProvider{},
		NodeMaintenanceStore: nodemaintenance.NewStore(5),
	}
	for _, option := range options {
		option(&cfg)
	}
	subsystem, err := NewSubsystemWithServices(t.Context(), cfg)
	require.NoError(t, err)
	if restoreFrom != "" {
		require.NoError(t, subsystem.Registry.RestoreMaintainedStores(restoreFrom))
		subsystem.IngestManager.RestoreStores(restoreFrom)
	}
	ctx, cancel := context.WithCancel(t.Context())
	stopped := false
	stop := func() {
		if stopped {
			return
		}
		stopped = true
		cancel()
		subsystem.IngestManager.Stop()
		subsystem.ResourceStream.Stop()
	}
	t.Cleanup(stop)
	subsystem.IngestManager.Start(ctx)
	require.Eventually(t, subsystem.IngestManager.HasSynced, 10*time.Second, 10*time.Millisecond, "the owned reflectors never synced")
	return &reflectorHarness{subsystem: subsystem, stop: stop}
}

// spill writes the maintained stores and the ingest stores the way Cold does,
// then stops the harness, returning the directory a re-warm restores from.
func (h *reflectorHarness) spill(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, h.subsystem.Registry.SpillMaintainedStores(dir))
	require.NoError(t, h.subsystem.IngestManager.SpillStores(dir))
	h.stop()
	return dir
}

func (h *reflectorHarness) ingestHarness() *ingestHarness {
	return &ingestHarness{subsystem: h.subsystem}
}

func (h *reflectorHarness) subscribe(t *testing.T, domainName, scope string) *resourcestream.Subscription {
	t.Helper()
	return h.ingestHarness().subscribe(t, domainName, scope)
}

func (h *reflectorHarness) rowNames(t *testing.T, domainName, scope string) []string {
	t.Helper()
	return h.ingestHarness().rowNames(t, domainName, scope)
}

// awaitRows reads the domain after each ring on sub until a read serves want,
// so a test proves a signal-triggered read sees the change. Reads happen only
// after rings: a change that never rings fails the test.
func (h *reflectorHarness) awaitRows(t *testing.T, sub *resourcestream.Subscription, domainName, scope string, want []string) {
	t.Helper()
	deadline := time.After(10 * time.Second)
	var last []string
	for {
		select {
		case <-sub.Updates:
			last = h.rowNames(t, domainName, scope)
			if slices.Equal(last, want) {
				return
			}
		case <-deadline:
			t.Fatalf("%s %s: no ring was followed by a read serving %v (last read %v)", domainName, scope, want, last)
		}
	}
}
