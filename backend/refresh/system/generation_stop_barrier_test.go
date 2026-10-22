package system

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// heldInvalidation blocks the first cache invalidation for one domain, so a
// producer's ring is provably in flight while the generation stops.
type heldInvalidation struct {
	next    func(string)
	domain  string
	armed   atomic.Bool
	held    chan struct{}
	release chan struct{}
	once    sync.Once
	calls   atomic.Int64
}

func newHeldInvalidation(next func(string), domain string) *heldInvalidation {
	return &heldInvalidation{next: next, domain: domain, held: make(chan struct{}), release: make(chan struct{})}
}

func (h *heldInvalidation) invalidate(domain string) {
	h.calls.Add(1)
	if domain == h.domain && h.armed.CompareAndSwap(true, false) {
		close(h.held)
		<-h.release
	}
	h.next(domain)
}

func (h *heldInvalidation) unblock() {
	h.once.Do(func() { close(h.release) })
}

// barrierHarness composes the real producers of each kind — a debounced event
// table and the attention index (both fed by the events store), the namespace
// notifier, and a synchronous store publication (the HPA ingest store's sink) —
// with the real stream manager and snapshot service.
type barrierHarness struct {
	eventStore        *ingest.ProjectingStore
	hpaStore          *ingest.ProjectingStore
	namespaceNotifier *snapshot.NamespaceChangeNotifier
	detailsNotifier   *snapshot.ObjectDetailsChangeNotifier
	invalidation      *heldInvalidation
	stopGeneration    func()
}

func newBarrierHarness(t *testing.T, heldDomain string) *barrierHarness {
	t.Helper()
	meta := snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("c1", time.Minute, func(context.Context, string, string, string, string) (bool, error) {
		return true, nil
	})
	reg := domain.New()
	service := snapshot.NewServiceWithPermissions(reg, nil, meta, nil)
	invalidation := newHeldInvalidation(service.InvalidateDomainCache, heldDomain)
	manager := resourcestream.NewManager(nil, nil, meta, invalidation.invalidate)
	ingestManager := ingest.NewIngestManager(streamrows.ClusterMeta(meta), client, nil, nil)
	require.True(t, ingestManager.RegisterReflector(snapshot.EventGVR, snapshot.EventGVK, snapshot.NewEventIngestProjector(meta), false))
	_, err := snapshot.RegisterClusterEventsDomain(reg, ingestManager, meta, manager)
	require.NoError(t, err)
	_, err = snapshot.RegisterClusterAttentionDomain(reg,
		snapshot.ClusterAttentionPermissions{IncludeEvents: true}, meta, ingestManager, snapshot.ClusterAttentionOptions{}, manager)
	require.NoError(t, err)
	require.NoError(t, snapshot.RegisterNamespaceAutoscalingDomain(reg, meta, ingestManager, manager))
	hpaStore := ingestManager.StoreFor(snapshot.HPAGVR)
	require.NotNil(t, hpaStore)
	hpaStore.MarkSynced()
	eventStore := ingestManager.StoreFor(snapshot.EventGVR)
	eventStore.MarkSynced()
	namespaceNotifier := snapshot.NewNamespaceChangeNotifier(nil, snapshot.NewNamespaceWorkloadTracker(nil), manager, nil)
	detailsNotifier := snapshot.NewObjectDetailsChangeNotifier(manager)
	manager.RegisterSources(permissions.NewGrants(checker), nil)
	t.Cleanup(invalidation.unblock)
	// Signal-only domains ring only scopes someone subscribed to.
	for _, subscription := range []struct{ domain, scope string }{
		{"namespaces", ""}, {"cluster-attention", ""}, {"object-details", "default:apps/v1:Deployment:web"},
	} {
		selector, err := resourcestream.ParseStreamSelector("c1", subscription.domain, subscription.scope)
		require.NoError(t, err)
		sub, err := manager.SubscribeSelector(selector)
		require.NoError(t, err)
		t.Cleanup(sub.Cancel)
	}
	return &barrierHarness{
		eventStore:        eventStore,
		hpaStore:          hpaStore,
		namespaceNotifier: namespaceNotifier,
		detailsNotifier:   detailsNotifier,
		invalidation:      invalidation,
		// The production stop path (backend/refresh_generation.go).
		stopGeneration: manager.Stop,
	}
}

// createNodeEvent delivers an Event to the events store the way its reflector
// does, on its own goroutine like createHPA.
func (h *barrierHarness) createNodeEvent(t *testing.T, name, rv string) {
	t.Helper()
	event := &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: name, Namespace: "default", ResourceVersion: rv, UID: types.UID("uid-" + name)},
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Node", Name: "node-a"},
		Reason:         "NodeNotReady",
		Type:           corev1.EventTypeWarning,
		LastTimestamp:  metav1.NewTime(time.Now()),
	}
	go func() { _ = h.eventStore.Add(event) }()
}

// createHPA delivers an HPA to its ingest store the way its reflector does. The
// store's sink rings synchronously, so the delivery runs on its own goroutine.
func (h *barrierHarness) createHPA(t *testing.T, name, rv string) {
	t.Helper()
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default", ResourceVersion: rv, UID: types.UID("uid-" + name)},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"},
			MaxReplicas:    3,
		},
	}
	go func() { _ = h.hpaStore.Add(hpa) }()
}

// Stopping a generation must wait for a producer callback that is already
// inside its ring, and nothing may invalidate the generation's snapshot cache
// afterwards. Otherwise a cooled generation keeps losing its served snapshots
// to producers that outlived teardown.
func TestGenerationStopWaitsForRunningProducerCallbacks(t *testing.T) {
	cases := []struct {
		name    string
		domain  string
		trigger func(t *testing.T, h *barrierHarness, round int)
	}{
		{
			name:   "debounced event table",
			domain: "cluster-events",
			trigger: func(t *testing.T, h *barrierHarness, round int) {
				h.createNodeEvent(t, "node-a.event-"+string(rune('a'+round)), "1"+string(rune('0'+round)))
			},
		},
		{
			name:   "attention index",
			domain: "cluster-attention",
			trigger: func(t *testing.T, h *barrierHarness, round int) {
				h.createNodeEvent(t, "node-a.warning-"+string(rune('a'+round)), "2"+string(rune('0'+round)))
			},
		},
		{
			name:   "namespace notifier",
			domain: "namespaces",
			trigger: func(_ *testing.T, h *barrierHarness, _ int) {
				h.namespaceNotifier.NamespaceChanged()
			},
		},
		{
			name:   "store publication",
			domain: "namespace-autoscaling",
			trigger: func(t *testing.T, h *barrierHarness, round int) {
				h.createHPA(t, "web-"+string(rune('a'+round)), "3"+string(rune('0'+round)))
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newBarrierHarness(t, tc.domain)
			h.invalidation.armed.Store(true)
			tc.trigger(t, h, 0)
			select {
			case <-h.invalidation.held:
			case <-time.After(3 * time.Second):
				t.Fatalf("%s never rang", tc.domain)
			}

			stopped := make(chan struct{})
			go func() {
				h.stopGeneration()
				close(stopped)
			}()
			select {
			case <-stopped:
				h.invalidation.unblock()
				t.Fatal("generation stop returned while a producer callback was still ringing")
			case <-time.After(200 * time.Millisecond):
			}
			h.invalidation.unblock()
			select {
			case <-stopped:
			case <-time.After(3 * time.Second):
				t.Fatal("generation stop did not return after the callback finished")
			}

			after := h.invalidation.calls.Load()
			tc.trigger(t, h, 1)
			time.Sleep(1200 * time.Millisecond)
			require.Equal(t, after, h.invalidation.calls.Load(),
				"a producer invalidated the snapshot cache after its generation stopped")
		})
	}
}

// A producer timer still pending when the generation stops never fires: the
// namespace notifier's flush and a debounced per-object notifier both arm
// synchronously, and neither may ring after Stop returns.
func TestGenerationStopCancelsPendingProducerTimers(t *testing.T) {
	h := newBarrierHarness(t, "")
	h.namespaceNotifier.NamespaceChanged()
	h.detailsNotifier.ObjectChanged(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}, "default", "web")
	h.stopGeneration()
	after := h.invalidation.calls.Load()
	time.Sleep(1200 * time.Millisecond)
	require.Equal(t, after, h.invalidation.calls.Load(), "a pending producer timer rang after its generation stopped")
}
