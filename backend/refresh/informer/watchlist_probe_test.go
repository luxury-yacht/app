package informer

import (
	"context"
	"errors"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// watchReactorFunc installs a namespaces watch reactor on a fake clientset whose
// behaviour is driven by feed. feed receives a *watch.FakeWatcher to inject
// events on; it runs in its own goroutine. If watchErr is non-nil the Watch call
// itself fails (modeling a server/proxy that rejects SendInitialEvents).
func fakeClientWithNamespaceWatch(feed func(fw *watch.FakeWatcher), watchErr error) *fake.Clientset {
	client := fake.NewClientset()
	client.PrependWatchReactor("namespaces", func(action k8stesting.Action) (bool, watch.Interface, error) {
		if watchErr != nil {
			return true, nil, watchErr
		}
		fw := watch.NewFake()
		if feed != nil {
			go feed(fw)
		}
		return true, fw, nil
	})
	return client
}

// bookmarkWithInitialEventsEnd returns a Namespace object annotated as the
// WatchList terminal bookmark.
func bookmarkWithInitialEventsEnd() *corev1.Namespace {
	return &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Annotations: map[string]string{metav1.InitialEventsAnnotationKey: "true"},
		},
	}
}

func TestProbeWatchListSupportReturnsTrueOnTerminalBookmark(t *testing.T) {
	client := fakeClientWithNamespaceWatch(func(fw *watch.FakeWatcher) {
		fw.Add(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}})
		fw.Action(watch.Bookmark, bookmarkWithInitialEventsEnd())
	}, nil)

	ok, err := ProbeWatchListSupport(context.Background(), client, time.Second)
	if err != nil {
		t.Fatalf("ProbeWatchListSupport returned error: %v", err)
	}
	if !ok {
		t.Fatalf("expected ok=true when the terminal initial-events-end bookmark arrives")
	}
}

func TestProbeWatchListSupportTimesOutWithoutBookmark(t *testing.T) {
	client := fakeClientWithNamespaceWatch(func(fw *watch.FakeWatcher) {
		// Initial state streamed, but the terminal bookmark is stripped — the
		// proxy never delivers it.
		fw.Add(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}})
		// Then nothing: simulate a bookmark-stripping proxy.
	}, nil)

	ok, err := ProbeWatchListSupport(context.Background(), client, 100*time.Millisecond)
	if err != nil {
		t.Fatalf("ProbeWatchListSupport returned error: %v", err)
	}
	if ok {
		t.Fatalf("expected ok=false when the terminal bookmark never arrives before timeout")
	}
}

func TestProbeWatchListSupportFalseOnWatchError(t *testing.T) {
	client := fakeClientWithNamespaceWatch(nil, errors.New("SendInitialEvents unsupported"))

	ok, err := ProbeWatchListSupport(context.Background(), client, time.Second)
	if err == nil {
		t.Fatalf("expected ProbeWatchListSupport to surface the watch error")
	}
	if ok {
		t.Fatalf("expected ok=false when the watch cannot open")
	}
}

func TestProbeWatchListSupportFalseWhenStreamCloses(t *testing.T) {
	client := fakeClientWithNamespaceWatch(func(fw *watch.FakeWatcher) {
		fw.Add(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}})
		fw.Stop() // close the result channel before any terminal bookmark
	}, nil)

	ok, err := ProbeWatchListSupport(context.Background(), client, time.Second)
	if err != nil {
		t.Fatalf("ProbeWatchListSupport returned error: %v", err)
	}
	if ok {
		t.Fatalf("expected ok=false when the stream closes before the terminal bookmark")
	}
}

func TestProbeWatchListSupportNilClient(t *testing.T) {
	ok, err := ProbeWatchListSupport(context.Background(), nil, time.Second)
	if err != nil {
		t.Fatalf("expected no error for a nil client, got %v", err)
	}
	if ok {
		t.Fatalf("expected ok=false for a nil client")
	}
}

func TestWatchListProbeTimeoutStaysBelowStartupBudget(t *testing.T) {
	if watchListProbeTimeout > time.Second {
		t.Fatalf("watchListProbeTimeout = %s, want <= 1s so startup does not block on capability probing", watchListProbeTimeout)
	}
}
