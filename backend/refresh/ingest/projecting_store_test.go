package ingest

import (
	"fmt"
	"sync"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"
)

// row is a tiny projection target: a ConfigMap projects to just its namespace
// and name, deliberately dropping every other field of the source object. The
// store must hold only this — never the *corev1.ConfigMap it came from.
type row struct {
	NS   string
	Name string
}

// projectConfigMap is the injected projection used across the store tests. It
// returns the row type, so a stored value that is anything other than a row
// proves the source object leaked into the store.
func projectConfigMap(obj interface{}) (interface{}, error) {
	cm, ok := obj.(*corev1.ConfigMap)
	if !ok {
		return nil, fmt.Errorf("projectConfigMap: unexpected type %T", obj)
	}
	return row{NS: cm.Namespace, Name: cm.Name}, nil
}

func configMap(ns, name string) *corev1.ConfigMap {
	return &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name}}
}

func TestProjectingStoreAddStoresProjectionNotObject(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	cm := configMap("default", "app")

	if err := store.Add(cm); err != nil {
		t.Fatalf("Add: %v", err)
	}

	got, exists, err := store.GetByKey("default/app")
	if err != nil || !exists {
		t.Fatalf("GetByKey: exists=%v err=%v", exists, err)
	}
	want := row{NS: "default", Name: "app"}
	if got != want {
		t.Fatalf("GetByKey returned %#v (type %T), want %#v", got, got, want)
	}
}

func TestProjectingStoreGetUsesObjectKey(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	cm := configMap("kube-system", "coredns")
	if err := store.Add(cm); err != nil {
		t.Fatalf("Add: %v", err)
	}

	// Get derives the key from the passed object via MetaNamespaceKeyFunc.
	got, exists, err := store.Get(cm)
	if err != nil || !exists {
		t.Fatalf("Get: exists=%v err=%v", exists, err)
	}
	if want := (row{NS: "kube-system", Name: "coredns"}); got != want {
		t.Fatalf("Get returned %#v, want %#v", got, want)
	}
}

// TestProjectingStoreRetainsOnlyProjections is the load-bearing assertion: after
// Add/Update/Replace the store must contain only projected rows and never any
// source object. List returns the accumulators directly, so a non-row element
// means the source object was retained.
func TestProjectingStoreRetainsOnlyProjections(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	if err := store.Add(configMap("a", "one")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := store.Update(configMap("b", "two")); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if err := store.Replace([]interface{}{configMap("c", "three")}, ""); err != nil {
		t.Fatalf("Replace: %v", err)
	}

	for _, item := range store.List() {
		if _, ok := item.(row); !ok {
			t.Fatalf("store retained a non-projection element %#v (type %T); the source object leaked", item, item)
		}
		if _, ok := item.(*corev1.ConfigMap); ok {
			t.Fatalf("store retained a *corev1.ConfigMap; the source object must be dropped after projection")
		}
	}
}

func TestProjectingStoreUpdateReprojects(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	if err := store.Add(configMap("default", "app")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	// Update under the same key replaces the projection.
	if err := store.Update(configMap("default", "app")); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if n := len(store.ListKeys()); n != 1 {
		t.Fatalf("ListKeys length = %d, want 1", n)
	}
}

func TestProjectingStoreDeleteRemovesByKey(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	cm := configMap("default", "app")
	if err := store.Add(cm); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := store.Delete(cm); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, exists, _ := store.GetByKey("default/app"); exists {
		t.Fatalf("key still present after Delete")
	}
	if n := len(store.List()); n != 0 {
		t.Fatalf("List length = %d, want 0 after Delete", n)
	}
}

func TestProjectingStoreDeleteViaTombstone(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	cm := configMap("default", "app")
	if err := store.Add(cm); err != nil {
		t.Fatalf("Add: %v", err)
	}

	// The reflector delivers deletes it missed as a DeletedFinalStateUnknown
	// tombstone wrapping the last known object; Delete must unwrap it.
	tombstone := cache.DeletedFinalStateUnknown{Key: "default/app", Obj: cm}
	if err := store.Delete(tombstone); err != nil {
		t.Fatalf("Delete tombstone: %v", err)
	}
	if _, exists, _ := store.GetByKey("default/app"); exists {
		t.Fatalf("key still present after tombstone Delete")
	}
}

func TestProjectingStoreReplaceReprojectsWholeSetAndDropsRemoved(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	if err := store.Add(configMap("default", "stale")); err != nil {
		t.Fatalf("Add: %v", err)
	}

	// Replace is the relist path: the new set fully defines the store.
	if err := store.Replace([]interface{}{
		configMap("default", "a"),
		configMap("default", "b"),
	}, ""); err != nil {
		t.Fatalf("Replace: %v", err)
	}

	if _, exists, _ := store.GetByKey("default/stale"); exists {
		t.Fatalf("stale key survived Replace; removed keys must be dropped")
	}
	keys := store.ListKeys()
	if len(keys) != 2 {
		t.Fatalf("ListKeys = %v, want exactly the 2 replaced keys", keys)
	}
	for _, k := range []string{"default/a", "default/b"} {
		if _, exists, _ := store.GetByKey(k); !exists {
			t.Fatalf("expected key %q after Replace", k)
		}
	}
}

func TestProjectingStoreReplaceSkipsProjectionErrorsKeepsRest(t *testing.T) {
	// A projection that fails for one specific object, succeeds for the rest.
	project := func(obj interface{}) (interface{}, error) {
		cm := obj.(*corev1.ConfigMap)
		if cm.Name == "bad" {
			return nil, fmt.Errorf("boom")
		}
		return row{NS: cm.Namespace, Name: cm.Name}, nil
	}
	store := NewProjectingStore(project)

	if err := store.Replace([]interface{}{
		configMap("default", "good1"),
		configMap("default", "bad"),
		configMap("default", "good2"),
	}, ""); err != nil {
		t.Fatalf("Replace returned error; a single projection failure must not fail the whole Replace: %v", err)
	}

	keys := store.ListKeys()
	if len(keys) != 2 {
		t.Fatalf("ListKeys = %v, want the 2 projectable rows (bad skipped)", keys)
	}
	if _, exists, _ := store.GetByKey("default/bad"); exists {
		t.Fatalf("the unprojectable object should have been skipped, not stored")
	}
}

func TestProjectingStoreAddSkipsProjectionError(t *testing.T) {
	project := func(obj interface{}) (interface{}, error) {
		return nil, fmt.Errorf("always fails")
	}
	store := NewProjectingStore(project)

	// Add must not propagate the projection error (it is logged once and the
	// object skipped), and must not store anything.
	if err := store.Add(configMap("default", "x")); err != nil {
		t.Fatalf("Add propagated projection error: %v", err)
	}
	if n := len(store.List()); n != 0 {
		t.Fatalf("List length = %d, want 0 when projection fails", n)
	}
}

func TestProjectingStoreResyncIsNoOp(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	if err := store.Resync(); err != nil {
		t.Fatalf("Resync: %v", err)
	}
}

// TestProjectingStoreHasSyncedFlipsOnReplace pins the readiness contract the
// ingest manager gates on: HasSynced is false until the reflector's initial
// relist (Replace) installs the first set, then true forever after. A bare
// Add before any Replace must NOT report synced — only Replace marks the
// initial list as landed.
func TestProjectingStoreHasSyncedFlipsOnReplace(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	if store.HasSynced() {
		t.Fatal("HasSynced was true before the initial Replace")
	}
	if err := store.Add(configMap("default", "early")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if store.HasSynced() {
		t.Fatal("HasSynced flipped on Add; only the initial Replace must mark sync")
	}
	if err := store.Replace([]interface{}{configMap("default", "a")}, "1"); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	if !store.HasSynced() {
		t.Fatal("HasSynced did not flip after the initial Replace")
	}
	// A later Replace (a relist) keeps it synced.
	if err := store.Replace([]interface{}{configMap("default", "b")}, "2"); err != nil {
		t.Fatalf("second Replace: %v", err)
	}
	if !store.HasSynced() {
		t.Fatal("HasSynced regressed after a relist Replace")
	}
}

func TestProjectingStoreConcurrentAddAndListRaceClean(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		i := i
		go func() {
			defer wg.Done()
			_ = store.Add(configMap("default", fmt.Sprintf("cm-%d", i)))
		}()
		go func() {
			defer wg.Done()
			_ = store.List()
			_ = store.ListKeys()
		}()
	}
	wg.Wait()
}
