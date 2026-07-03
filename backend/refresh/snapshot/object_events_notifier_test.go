package snapshot

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type objectEventsBroadcastRecorder struct {
	mu       sync.Mutex
	versions []string
	matchers []func(string) bool
}

func (r *objectEventsBroadcastRecorder) record(version string, matches func(scope string) bool) {
	r.mu.Lock()
	r.versions = append(r.versions, version)
	r.matchers = append(r.matchers, matches)
	r.mu.Unlock()
}

func (r *objectEventsBroadcastRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.versions)
}

func (r *objectEventsBroadcastRecorder) lastMatcher() func(string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.matchers) == 0 {
		return nil
	}
	return r.matchers[len(r.matchers)-1]
}

func waitForObjectEventsBroadcasts(t *testing.T, r *objectEventsBroadcastRecorder, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if r.count() >= want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("expected at least %d broadcast(s), got %d", want, r.count())
}

func podEvent(namespace, name string) *corev1.Event {
	return &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name + ".evt"},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "v1",
			Kind:       "Pod",
			Namespace:  namespace,
			Name:       name,
		},
	}
}

func newObjectEventsNotifierForTest(recorder *objectEventsBroadcastRecorder) *ObjectEventsChangeNotifier {
	notifier := NewObjectEventsChangeNotifier()
	notifier.debounce = 20 * time.Millisecond
	if recorder != nil {
		notifier.SetBroadcast(recorder.record)
	}
	return notifier
}

// An event delivery must ring the doorbell for exactly the involved object's
// scope: same identity matches, sibling objects and other namespaces do not.
func TestObjectEventsNotifierBroadcastsToMatchingScope(t *testing.T) {
	recorder := &objectEventsBroadcastRecorder{}
	notifier := newObjectEventsNotifierForTest(recorder)
	defer notifier.Stop()

	notifier.EventChanged(podEvent("team-a", "web-1"))
	waitForObjectEventsBroadcasts(t, recorder, 1)

	matches := recorder.lastMatcher()
	require.NotNil(t, matches)
	require.True(t, matches("team-a:/v1:Pod:web-1"), "involved object's scope must match")
	require.False(t, matches("team-a:/v1:Pod:other"), "sibling object must not match")
	require.False(t, matches("team-b:/v1:Pod:web-1"), "other namespace must not match")
}

// Cluster-scoped objects: the scope carries the __cluster__ sentinel, the
// event's involved object carries an empty namespace — they must meet on the
// same index key.
func TestObjectEventsNotifierMatchesClusterScopedObjects(t *testing.T) {
	recorder := &objectEventsBroadcastRecorder{}
	notifier := newObjectEventsNotifierForTest(recorder)
	defer notifier.Stop()

	notifier.EventChanged(&corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "node.evt"},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "v1",
			Kind:       "Node",
			Name:       "node-1",
		},
	})
	waitForObjectEventsBroadcasts(t, recorder, 1)

	matches := recorder.lastMatcher()
	require.NotNil(t, matches)
	require.True(t, matches("__cluster__:/v1:Node:node-1"))
}

// A burst of events inside the debounce window coalesces into one broadcast
// covering every touched object.
func TestObjectEventsNotifierCoalescesBursts(t *testing.T) {
	recorder := &objectEventsBroadcastRecorder{}
	notifier := newObjectEventsNotifierForTest(recorder)
	defer notifier.Stop()

	notifier.EventChanged(podEvent("team-a", "web-1"))
	notifier.EventChanged(podEvent("team-a", "web-2"))
	notifier.EventChanged(podEvent("team-a", "web-1"))
	waitForObjectEventsBroadcasts(t, recorder, 1)
	time.Sleep(120 * time.Millisecond)
	require.Equal(t, 1, recorder.count(), "burst must coalesce into one broadcast")

	matches := recorder.lastMatcher()
	require.True(t, matches("team-a:/v1:Pod:web-1"))
	require.True(t, matches("team-a:/v1:Pod:web-2"))
}

// Stop cancels any pending flush; nothing broadcasts afterwards.
func TestObjectEventsNotifierStopSilencesBroadcasts(t *testing.T) {
	recorder := &objectEventsBroadcastRecorder{}
	notifier := newObjectEventsNotifierForTest(recorder)

	notifier.EventChanged(podEvent("team-a", "web-1"))
	notifier.Stop()
	time.Sleep(120 * time.Millisecond)
	require.Equal(t, 0, recorder.count())
}

// Events recorded before the broadcast sink is wired (the stream manager is
// built after domain registration) are retained and flushed once wired.
func TestObjectEventsNotifierRetainsEventsUntilBroadcastWired(t *testing.T) {
	notifier := NewObjectEventsChangeNotifier()
	notifier.debounce = 20 * time.Millisecond
	defer notifier.Stop()

	notifier.EventChanged(podEvent("team-a", "web-1"))
	time.Sleep(80 * time.Millisecond)

	recorder := &objectEventsBroadcastRecorder{}
	notifier.SetBroadcast(recorder.record)
	waitForObjectEventsBroadcasts(t, recorder, 1)
	require.True(t, recorder.lastMatcher()("team-a:/v1:Pod:web-1"))
}
