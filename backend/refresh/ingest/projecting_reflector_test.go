package ingest

import (
	"context"
	"runtime"
	"sort"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/cache"
)

// configMapListWatch builds a ListerWatcher over configmaps in all namespaces
// for the supplied clientset — the same shape the reflector drives in
// production. It is wrapped with ToListWatcherWithWatchListSemantics(client) so
// the reflector queries the client for WatchList support: the fake clientset
// reports unsupported, so the reflector falls back to classic List+Watch — the
// standard way real informers build a ListWatch.
func configMapListWatch(client kubernetes.Interface) cache.ListerWatcher {
	lw := &cache.ListWatch{
		ListFunc: func(opts metav1.ListOptions) (apiruntime.Object, error) {
			return client.CoreV1().ConfigMaps(metav1.NamespaceAll).List(context.Background(), opts)
		},
		WatchFunc: func(opts metav1.ListOptions) (watch.Interface, error) {
			return client.CoreV1().ConfigMaps(metav1.NamespaceAll).Watch(context.Background(), opts)
		},
	}
	return cache.ToListWatcherWithWatchListSemantics(lw, client)
}

// storeKeys returns the sorted projected keys currently in the store.
func storeKeys(store *ProjectingStore) []string {
	keys := store.ListKeys()
	sort.Strings(keys)
	return keys
}

// waitForKeys polls until the store's sorted keys equal want, or the deadline
// passes. Returns the last observed keys for diagnostics.
func waitForKeys(t *testing.T, store *ProjectingStore, want []string) []string {
	t.Helper()
	sort.Strings(want)
	deadline := time.Now().Add(3 * time.Second)
	var last []string
	for time.Now().Before(deadline) {
		last = storeKeys(store)
		if equalStrings(last, want) {
			return last
		}
		time.Sleep(10 * time.Millisecond)
	}
	return last
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestProjectingReflectorConvergesToProjectedRows(t *testing.T) {
	client := fake.NewClientset(configMap("default", "seed"))
	store := NewProjectingStore(projectConfigMap)
	reflector := NewProjectingReflector(
		"configmaps-test",
		configMapListWatch(client),
		&corev1.ConfigMap{},
		store,
		0,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go reflector.Run(ctx)

	// Initial list should populate the seed object as a projected row.
	if got := waitForKeys(t, store, []string{"default/seed"}); !equalStrings(got, []string{"default/seed"}) {
		t.Fatalf("after initial list, store keys = %v, want [default/seed]", got)
	}

	// Create two more configmaps; the watch should deliver them.
	if _, err := client.CoreV1().ConfigMaps("default").Create(ctx, configMap("default", "alpha"), metav1.CreateOptions{}); err != nil {
		t.Fatalf("create alpha: %v", err)
	}
	if _, err := client.CoreV1().ConfigMaps("other").Create(ctx, configMap("other", "beta"), metav1.CreateOptions{}); err != nil {
		t.Fatalf("create beta: %v", err)
	}
	want := []string{"default/alpha", "default/seed", "other/beta"}
	if got := waitForKeys(t, store, want); !equalStrings(got, want) {
		t.Fatalf("after creates, store keys = %v, want %v", got, want)
	}

	// The stored values must be projected rows, not source objects.
	v, exists, err := store.GetByKey("other/beta")
	if err != nil || !exists {
		t.Fatalf("GetByKey other/beta: exists=%v err=%v", exists, err)
	}
	if want := (row{NS: "other", Name: "beta"}); v != want {
		t.Fatalf("stored value = %#v (type %T), want projected %#v", v, v, want)
	}

	// Delete one; the watch delete should evict it.
	if err := client.CoreV1().ConfigMaps("default").Delete(ctx, "alpha", metav1.DeleteOptions{}); err != nil {
		t.Fatalf("delete alpha: %v", err)
	}
	want = []string{"default/seed", "other/beta"}
	if got := waitForKeys(t, store, want); !equalStrings(got, want) {
		t.Fatalf("after delete, store keys = %v, want %v", got, want)
	}
}

func TestProjectingReflectorStopsOnContextCancelNoLeak(t *testing.T) {
	client := fake.NewClientset()
	store := NewProjectingStore(projectConfigMap)
	reflector := NewProjectingReflector(
		"configmaps-leak-test",
		configMapListWatch(client),
		&corev1.ConfigMap{},
		store,
		0,
	)

	before := runtime.NumGoroutine()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		reflector.Run(ctx)
		close(done)
	}()

	// Let the reflector start its list/watch loop.
	time.Sleep(100 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("reflector.Run did not return after context cancel")
	}

	// Allow any watch goroutines to wind down, then confirm we are back at the
	// baseline goroutine count (no leaked reflector goroutine).
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if runtime.NumGoroutine() <= before {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("goroutine count did not return to baseline: before=%d after=%d", before, runtime.NumGoroutine())
}
