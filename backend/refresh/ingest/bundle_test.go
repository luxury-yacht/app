package ingest

import (
	"context"
	"fmt"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// tableRow / catalogRow are the two halves a bundle projection produces. They are
// distinct types so a test can prove TableRows/CatalogRows pull the right half.
type tableRow struct {
	NS   string
	Name string
}

type catalogRow struct {
	Key string
}

func bundleProject(tableErr, catalogErr bool) ProjectFunc {
	return func(obj interface{}) (interface{}, error) {
		cm, ok := obj.(*corev1.ConfigMap)
		if !ok {
			return nil, fmt.Errorf("bundleProject: unexpected type %T", obj)
		}
		b := Bundle{}
		if !tableErr {
			b.Table = tableRow{NS: cm.Namespace, Name: cm.Name}
		}
		if !catalogErr {
			b.Catalog = catalogRow{Key: cm.Namespace + "/" + cm.Name}
		}
		return b, nil
	}
}

// recordingSink captures the incremental upserts/deletes a store fires so a test
// can prove the maintained store is fed live as the reflector mutates the store.
type recordingSink struct {
	mu      sync.Mutex
	upserts []interface{}
	deletes []interface{}
}

func (s *recordingSink) Upsert(row interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.upserts = append(s.upserts, row)
}

func (s *recordingSink) Delete(row interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deletes = append(s.deletes, row)
}

func (s *recordingSink) snapshot() ([]interface{}, []interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := append([]interface{}(nil), s.upserts...)
	d := append([]interface{}(nil), s.deletes...)
	return u, d
}

func cm(ns, name string) *corev1.ConfigMap {
	return configMap(ns, name)
}

func bundleNames(rows []interface{}) string {
	names := make([]string, 0, len(rows))
	for _, raw := range rows {
		bundle, ok := raw.(Bundle)
		if !ok {
			continue
		}
		table, ok := bundle.Table.(tableRow)
		if !ok {
			continue
		}
		names = append(names, table.Name)
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

// TestProjectingStoreBundleAccessorsSplitHalves proves TableRows and CatalogRows
// each return only their half of every stored bundle. It uses a retain-table store (the
// pod store) so the Table half is present to assert TableRows returns it; the default
// drop-table behavior is covered by TestProjectingStoreDropsStoredTableHalfByDefault.
func TestProjectingStoreBundleAccessorsSplitHalves(t *testing.T) {
	store := NewProjectingStore(bundleProject(false, false))
	store.SetRetainTable(true)
	if err := store.Add(cm("default", "a")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := store.Add(cm("kube-system", "b")); err != nil {
		t.Fatalf("Add: %v", err)
	}

	tables := store.TableRows()
	if len(tables) != 2 {
		t.Fatalf("TableRows len = %d, want 2", len(tables))
	}
	for _, r := range tables {
		if _, ok := r.(tableRow); !ok {
			t.Fatalf("TableRows returned %T, want tableRow", r)
		}
	}

	catalogs := store.CatalogRows()
	if len(catalogs) != 2 {
		t.Fatalf("CatalogRows len = %d, want 2", len(catalogs))
	}
	for _, r := range catalogs {
		if _, ok := r.(catalogRow); !ok {
			t.Fatalf("CatalogRows returned %T, want catalogRow", r)
		}
	}
}

// TestProjectingStoreCatalogRowsOmitsNilHalf proves a kind with no catalog
// projector (Catalog left nil) contributes no catalog rows but still contributes
// table rows. It uses a retain-table store so the Table half is present to assert on.
func TestProjectingStoreCatalogRowsOmitsNilHalf(t *testing.T) {
	// catalogErr=true leaves Bundle.Catalog nil for every object.
	store := NewProjectingStore(bundleProject(false, true))
	store.SetRetainTable(true)
	if err := store.Add(cm("default", "a")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if got := len(store.TableRows()); got != 1 {
		t.Fatalf("TableRows len = %d, want 1", got)
	}
	if got := len(store.CatalogRows()); got != 0 {
		t.Fatalf("CatalogRows len = %d, want 0 when catalog half is nil", got)
	}
}

// TestProjectingStoreSinkReceivesIncrementalUpsertsAndDeletes proves a registered
// sink is fed the Table half on Add/Update and the key on Delete, so a maintained
// store stays in sync with the reflector incrementally — not by polling.
func TestProjectingStoreSinkReceivesIncrementalUpsertsAndDeletes(t *testing.T) {
	sink := &recordingSink{}
	store := NewProjectingStore(bundleProject(false, false))
	// The Table-half Sink delete reads the STORED Table half, so this delivery contract
	// holds only for a retain-table store (the production maintained store uses the
	// catalog-keyed BundleSink delete instead — see TestProjectingStoreDropsStoredTableHalfByDefault).
	store.SetRetainTable(true)
	store.AddSink(sink)

	if err := store.Add(cm("default", "a")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := store.Update(cm("default", "a")); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if err := store.Delete(cm("default", "a")); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	upserts, deletes := sink.snapshot()
	if len(upserts) != 2 {
		t.Fatalf("sink upserts = %d, want 2 (Add + Update)", len(upserts))
	}
	for _, u := range upserts {
		if _, ok := u.(tableRow); !ok {
			t.Fatalf("sink upsert is %T, want the Table half tableRow", u)
		}
	}
	if len(deletes) != 1 {
		t.Fatalf("sink deletes = %d, want 1", len(deletes))
	}
	if got, ok := deletes[0].(tableRow); !ok || got != (tableRow{NS: "default", Name: "a"}) {
		t.Fatalf("sink delete row = %#v, want the Table half tableRow{default,a}", deletes[0])
	}
}

// TestProjectingStoreSinkReceivesReplaceAsUpserts proves a relist (Replace) feeds
// the sink the Table half of every object in the new set, so the maintained store
// is repopulated on relist.
func TestProjectingStoreSinkReceivesReplaceAsUpserts(t *testing.T) {
	sink := &recordingSink{}
	store := NewProjectingStore(bundleProject(false, false))
	store.AddSink(sink)

	if err := store.Replace([]interface{}{cm("default", "a"), cm("default", "b")}, "1"); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	upserts, _ := sink.snapshot()
	if len(upserts) != 2 {
		t.Fatalf("sink upserts after Replace = %d, want 2", len(upserts))
	}
}

type recordingReplaceSink struct {
	recordingSink
	mu       sync.Mutex
	replaces [][]interface{}
}

func (s *recordingReplaceSink) Replace(rows []interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	copied := append([]interface{}(nil), rows...)
	s.replaces = append(s.replaces, copied)
}

func (s *recordingReplaceSink) replaceSnapshot() [][]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([][]interface{}, len(s.replaces))
	for i, rows := range s.replaces {
		out[i] = append([]interface{}(nil), rows...)
	}
	return out
}

func TestProjectingStoreReplaceUsesBulkSinkWhenAvailable(t *testing.T) {
	sink := &recordingReplaceSink{}
	store := NewProjectingStore(bundleProject(false, false))
	store.AddSink(sink)

	if err := store.Replace([]interface{}{cm("default", "a"), cm("default", "b")}, "1"); err != nil {
		t.Fatalf("Replace: %v", err)
	}

	replaces := sink.replaceSnapshot()
	if len(replaces) != 1 {
		t.Fatalf("bulk replaces after Replace = %d, want 1", len(replaces))
	}
	if len(replaces[0]) != 2 {
		t.Fatalf("bulk replace rows = %d, want 2", len(replaces[0]))
	}
	upserts, _ := sink.snapshot()
	if len(upserts) != 0 {
		t.Fatalf("incremental upserts after bulk Replace = %d, want 0", len(upserts))
	}
}

// TestIngestManagerBuildsBundleAndFeedsSink is the end-to-end proof of the bundle +
// sink mechanism through the real manager: a registered catalog projector makes
// CatalogRows populate alongside TableRows, and a registered sink is fed the Table
// half live as the reflector syncs. This is exactly how the quotas cutover wires a
// maintained store + the catalog onto one ingestion.
func TestIngestManagerBuildsBundleAndFeedsSink(t *testing.T) {
	server := newTrackerAPIServer(t)
	server.add(t, newCM("default", "seed-cm"), configMapGVK)
	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

	mgr := NewIngestManager(testMeta, kube, nil, nil)

	// Register a catalog projector and a sink BEFORE Start, the production order.
	if ok := mgr.RegisterCatalogProjector(configMapGVR, func(o metav1.Object) interface{} {
		return catalogRow{Key: o.GetNamespace() + "/" + o.GetName()}
	}); !ok {
		t.Fatal("RegisterCatalogProjector found no configmap entry")
	}
	sink := &recordingSink{}
	if ok := mgr.AddSink(configMapGVR, sink); !ok {
		t.Fatal("AddSink found no configmap entry")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)
	waitForManagerSynced(t, mgr)

	cmStore := mgr.StoreFor(configMapGVR)
	if got := waitForNames(t, cmStore, []string{"default/seed-cm"}); !equalStrings(got, []string{"default/seed-cm"}) {
		t.Fatalf("configmap names = %v", got)
	}

	// The descriptor store drops the redundant Table half from its stored bundle (the
	// maintained store holds it columnar), so TableRows is empty — but the Catalog half is
	// retained for the catalog-keyed delete and CatalogRows holds the projection from the
	// SAME ingestion.
	if got := len(mgr.TableRows(configMapGVR)); got != 0 {
		t.Fatalf("TableRows = %d, want 0 (the redundant Table half is dropped from the store)", got)
	}
	catalogs := mgr.CatalogRows(configMapGVR)
	if len(catalogs) != 1 {
		t.Fatalf("CatalogRows = %d, want 1", len(catalogs))
	}
	if got, ok := catalogs[0].(catalogRow); !ok || got.Key != "default/seed-cm" {
		t.Fatalf("CatalogRows[0] = %#v, want catalogRow{default/seed-cm}", catalogs[0])
	}

	// The sink was fed the Table half at least once (the initial relist Upsert) BEFORE it was
	// dropped from the stored bundle — that is how the maintained store populates. The fanned
	// value is the descriptor's StreamRow projection (a streamrows.ConfigSummary), never nil.
	upserts, _ := sink.snapshot()
	if len(upserts) == 0 {
		t.Fatal("sink received no upserts; the maintained store would never populate")
	}
	for _, u := range upserts {
		if u == nil {
			t.Fatal("sink upsert is nil; the Table half must be fanned before the drop")
		}
	}
}

// aggregateRow is the fourth bundle half a test projects: a distinct type so the test
// proves AggregateRows pulls the Aggregate half, not the Table/Catalog/ObjectMap half.
type aggregateRow struct {
	Key string
}

// TestProjectingStoreAggregateRowsSplitsHalf proves AggregateRows returns only the
// Aggregate half of every stored bundle, and omits a nil Aggregate half. This is the
// pod-aggregation consumer's read path: the pod bundle carries a PodAggregate the
// overview/nodes/workloads domains read alongside the Table-half PodSummary.
func TestProjectingStoreAggregateRowsSplitsHalf(t *testing.T) {
	project := func(obj interface{}) (interface{}, error) {
		cmObj, ok := obj.(*corev1.ConfigMap)
		if !ok {
			return nil, fmt.Errorf("unexpected type %T", obj)
		}
		return Bundle{
			Table:     tableRow{NS: cmObj.Namespace, Name: cmObj.Name},
			Aggregate: aggregateRow{Key: cmObj.Namespace + "/" + cmObj.Name},
		}, nil
	}
	store := NewProjectingStore(project)
	if err := store.Add(cm("default", "a")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	aggregates := store.AggregateRows()
	if len(aggregates) != 1 {
		t.Fatalf("AggregateRows len = %d, want 1", len(aggregates))
	}
	if got, ok := aggregates[0].(aggregateRow); !ok || got.Key != "default/a" {
		t.Fatalf("AggregateRows[0] = %#v, want aggregateRow{default/a}", aggregates[0])
	}
	// A table-only projection (no Aggregate half) contributes no aggregate rows.
	tableOnly := NewProjectingStore(bundleProject(false, true))
	if err := tableOnly.Add(cm("default", "b")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if got := len(tableOnly.AggregateRows()); got != 0 {
		t.Fatalf("AggregateRows len = %d, want 0 when aggregate half is nil", got)
	}
}

func TestProjectingStoreRowsByIndexTracksBundleIndexKeys(t *testing.T) {
	project := func(obj interface{}) (interface{}, error) {
		cmObj, ok := obj.(*corev1.ConfigMap)
		if !ok {
			return nil, fmt.Errorf("unexpected type %T", obj)
		}
		return Bundle{
			Table: tableRow{NS: cmObj.Namespace, Name: cmObj.Name},
			Indexes: map[string][]string{
				"owner": []string{cmObj.Labels["owner"]},
			},
		}, nil
	}
	store := NewProjectingStore(project)
	store.SetRetainTable(true)
	alphaA := cm("default", "a")
	alphaA.Labels = map[string]string{"owner": "alpha"}
	betaB := cm("default", "b")
	betaB.Labels = map[string]string{"owner": "beta"}

	if err := store.Add(alphaA); err != nil {
		t.Fatalf("Add alpha: %v", err)
	}
	if err := store.Add(betaB); err != nil {
		t.Fatalf("Add beta: %v", err)
	}
	if got := bundleNames(store.RowsByIndex("owner", []string{"alpha"})); got != "a" {
		t.Fatalf("RowsByIndex owner=alpha names = %q, want a", got)
	}

	alphaA.Labels = map[string]string{"owner": "beta"}
	if err := store.Update(alphaA); err != nil {
		t.Fatalf("Update alpha->beta: %v", err)
	}
	if got := bundleNames(store.RowsByIndex("owner", []string{"alpha"})); got != "" {
		t.Fatalf("RowsByIndex owner=alpha after update names = %q, want empty", got)
	}
	if got := bundleNames(store.RowsByIndex("owner", []string{"beta"})); got != "a,b" {
		t.Fatalf("RowsByIndex owner=beta after update names = %q, want a,b", got)
	}

	if err := store.Delete(betaB); err != nil {
		t.Fatalf("Delete beta: %v", err)
	}
	if got := bundleNames(store.RowsByIndex("owner", []string{"beta"})); got != "a" {
		t.Fatalf("RowsByIndex owner=beta after delete names = %q, want a", got)
	}

	alphaC := cm("default", "c")
	alphaC.Labels = map[string]string{"owner": "alpha"}
	if err := store.Replace([]interface{}{alphaC}, "12"); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	if got := bundleNames(store.RowsByIndex("owner", []string{"beta"})); got != "" {
		t.Fatalf("RowsByIndex owner=beta after replace names = %q, want empty", got)
	}
	if got := bundleNames(store.RowsByIndex("owner", []string{"alpha"})); got != "c" {
		t.Fatalf("RowsByIndex owner=alpha after replace names = %q, want c", got)
	}
}

// objectMapRow is the third bundle half a test projects: a distinct type so the test
// proves ObjectMapRows pulls the ObjectMap half, not the Table or Catalog half.
type objectMapRow struct {
	Key string
}

// TestIngestManagerBuildsObjectMapHalf proves the third bundle half end-to-end: a
// registered object-map projector makes ObjectMapRows populate alongside TableRows
// from one reflector ingestion — exactly how the quotas cutover feeds the object map.
func TestIngestManagerBuildsObjectMapHalf(t *testing.T) {
	server := newTrackerAPIServer(t)
	server.add(t, newCM("default", "seed-cm"), configMapGVK)
	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

	mgr := NewIngestManager(testMeta, kube, nil, nil)
	if ok := mgr.RegisterObjectMapProjector(configMapGVR, func(o metav1.Object) interface{} {
		return objectMapRow{Key: o.GetNamespace() + "/" + o.GetName()}
	}); !ok {
		t.Fatal("RegisterObjectMapProjector found no configmap entry")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)
	waitForManagerSynced(t, mgr)

	cmStore := mgr.StoreFor(configMapGVR)
	if got := waitForNames(t, cmStore, []string{"default/seed-cm"}); !equalStrings(got, []string{"default/seed-cm"}) {
		t.Fatalf("configmap names = %v", got)
	}

	nodes := mgr.ObjectMapRows(configMapGVR)
	if len(nodes) != 1 {
		t.Fatalf("ObjectMapRows = %d, want 1", len(nodes))
	}
	if got, ok := nodes[0].(objectMapRow); !ok || got.Key != "default/seed-cm" {
		t.Fatalf("ObjectMapRows[0] = %#v, want objectMapRow{default/seed-cm}", nodes[0])
	}
}

// recordingBundleSink records the bundles delivered to a BundleSink so a test can
// assert both halves arrive together on each Upsert/Delete.
type recordingBundleSink struct {
	upserts []Bundle
	deletes []Bundle
}

func (s *recordingBundleSink) UpsertBundle(b Bundle) { s.upserts = append(s.upserts, b) }
func (s *recordingBundleSink) DeleteBundle(b Bundle) { s.deletes = append(s.deletes, b) }

// TestProjectingStoreBundleSinkDeliversWholeBundle proves a registered BundleSink
// receives the WHOLE projected bundle (both halves) on Upsert and Delete, in one
// delivery — the pod notify path needs the Table half (scopes) and Catalog half
// (UID/RV) of the same object together, which separate Table/Catalog sinks cannot
// guarantee. The pod store retains its Table half (SetRetainTable(true)), so the Table
// half is present on the DeleteBundle too, exactly as the pod notify path requires.
func TestProjectingStoreBundleSinkDeliversWholeBundle(t *testing.T) {
	project := func(obj interface{}) (interface{}, error) {
		cmObj, ok := obj.(*corev1.ConfigMap)
		if !ok {
			return nil, fmt.Errorf("unexpected type %T", obj)
		}
		return Bundle{
			Table:   tableRow{NS: cmObj.Namespace, Name: cmObj.Name},
			Catalog: catalogRow{Key: cmObj.Namespace + "/" + cmObj.Name},
		}, nil
	}
	store := NewProjectingStore(project)
	store.SetRetainTable(true)
	sink := &recordingBundleSink{}
	store.AddBundleSink(sink)

	if err := store.Add(cm("default", "a")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if len(sink.upserts) != 1 {
		t.Fatalf("UpsertBundle calls = %d, want 1", len(sink.upserts))
	}
	if got, ok := sink.upserts[0].Table.(tableRow); !ok || got.Name != "a" {
		t.Fatalf("upsert Table half = %#v, want tableRow{a}", sink.upserts[0].Table)
	}
	if got, ok := sink.upserts[0].Catalog.(catalogRow); !ok || got.Key != "default/a" {
		t.Fatalf("upsert Catalog half = %#v, want catalogRow{default/a}", sink.upserts[0].Catalog)
	}

	if err := store.Delete(cm("default", "a")); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if len(sink.deletes) != 1 {
		t.Fatalf("DeleteBundle calls = %d, want 1", len(sink.deletes))
	}
	if got, ok := sink.deletes[0].Table.(tableRow); !ok || got.Name != "a" {
		t.Fatalf("delete Table half = %#v, want tableRow{a}", sink.deletes[0].Table)
	}
}

// tableCatalogProject projects a ConfigMap to a Bundle with both a Table and a Catalog
// half, used by the Table-drop tests below.
func tableCatalogProject(obj interface{}) (interface{}, error) {
	cmObj, ok := obj.(*corev1.ConfigMap)
	if !ok {
		return nil, fmt.Errorf("unexpected type %T", obj)
	}
	return Bundle{
		Table:   tableRow{NS: cmObj.Namespace, Name: cmObj.Name},
		Catalog: catalogRow{Key: cmObj.Namespace + "/" + cmObj.Name},
	}, nil
}

// TestProjectingStoreDropsStoredTableHalfByDefault proves the redundant Table half is
// dropped from the STORED bundle (the maintained store already holds it columnar) while
// the Table half STILL reaches the sinks on upsert and the Catalog half stays retained for
// the catalog-keyed delete. This is the project-to-column-tuple change: stored bundles keep
// the Catalog/ObjectMap/Aggregate halves, not the Table half.
func TestProjectingStoreDropsStoredTableHalfByDefault(t *testing.T) {
	store := NewProjectingStore(tableCatalogProject)
	sink := &recordingBundleSink{}
	store.AddBundleSink(sink)

	if err := store.Add(cm("default", "a")); err != nil {
		t.Fatalf("Add: %v", err)
	}

	// The sink received the FULL bundle (Table present) at upsert — the maintained store
	// is fed the Table half before it is dropped from the stored copy.
	if len(sink.upserts) != 1 {
		t.Fatalf("UpsertBundle calls = %d, want 1", len(sink.upserts))
	}
	if _, ok := sink.upserts[0].Table.(tableRow); !ok {
		t.Fatalf("upsert Table half = %#v, want tableRow (Table must reach the sink)", sink.upserts[0].Table)
	}

	// The STORED bundle dropped the Table half but kept the Catalog half.
	stored, exists, err := store.GetByKey("default/a")
	if err != nil || !exists {
		t.Fatalf("GetByKey: exists=%v err=%v", exists, err)
	}
	b, ok := stored.(Bundle)
	if !ok {
		t.Fatalf("stored value is %T, want Bundle", stored)
	}
	if b.Table != nil {
		t.Fatalf("stored Table half = %#v, want nil (dropped)", b.Table)
	}
	if _, ok := b.Catalog.(catalogRow); !ok {
		t.Fatalf("stored Catalog half = %#v, want catalogRow (retained)", b.Catalog)
	}
	if got := len(store.TableRows()); got != 0 {
		t.Fatalf("TableRows = %d, want 0 once the stored Table half is dropped", got)
	}
	if got := len(store.CatalogRows()); got != 1 {
		t.Fatalf("CatalogRows = %d, want 1 (Catalog half retained)", got)
	}

	// On delete the sink's DeleteBundle gets the STORED bundle (Table nil) but the Catalog
	// half is present, so a catalog-keyed maintained-store delete still evicts the row.
	if err := store.Delete(cm("default", "a")); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if len(sink.deletes) != 1 {
		t.Fatalf("DeleteBundle calls = %d, want 1", len(sink.deletes))
	}
	if sink.deletes[0].Table != nil {
		t.Fatalf("delete Table half = %#v, want nil (dropped from stored bundle)", sink.deletes[0].Table)
	}
	if _, ok := sink.deletes[0].Catalog.(catalogRow); !ok {
		t.Fatalf("delete Catalog half = %#v, want catalogRow (the catalog-keyed delete needs it)", sink.deletes[0].Catalog)
	}
}

// TestProjectingStoreRetainTableKeepsStoredTableHalf proves a store created with
// retainTable=TRUE (the pod store, whose standalone-synthesis + notify paths read the
// STORED Table half) keeps the Table half in its stored bundle.
func TestProjectingStoreRetainTableKeepsStoredTableHalf(t *testing.T) {
	store := NewProjectingStore(tableCatalogProject)
	store.SetRetainTable(true)

	if err := store.Add(cm("default", "a")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	stored, exists, err := store.GetByKey("default/a")
	if err != nil || !exists {
		t.Fatalf("GetByKey: exists=%v err=%v", exists, err)
	}
	b, ok := stored.(Bundle)
	if !ok {
		t.Fatalf("stored value is %T, want Bundle", stored)
	}
	if _, ok := b.Table.(tableRow); !ok {
		t.Fatalf("stored Table half = %#v, want tableRow (retained when retainTable=true)", b.Table)
	}
	if got := len(store.TableRows()); got != 1 {
		t.Fatalf("TableRows = %d, want 1 when the Table half is retained", got)
	}
}

// TestProjectingStoreReplaceDropsStoredTableHalf proves the relist (Replace) path also
// drops the stored Table half but feeds the sinks the full bundle, and a relist-delete
// (a key vanishing from the new set) fans the stored (Table-nil, Catalog-present) bundle to
// DeleteBundle so the catalog-keyed maintained-store delete still evicts the ghost.
func TestProjectingStoreReplaceDropsStoredTableHalf(t *testing.T) {
	store := NewProjectingStore(tableCatalogProject)
	sink := &recordingBundleSink{}
	store.AddBundleSink(sink)

	if err := store.Replace([]interface{}{cm("default", "a"), cm("default", "b")}, "1"); err != nil {
		t.Fatalf("Replace 1: %v", err)
	}
	// Both upserts carried the Table half to the sink.
	if len(sink.upserts) != 2 {
		t.Fatalf("UpsertBundle calls = %d, want 2", len(sink.upserts))
	}
	for _, u := range sink.upserts {
		if _, ok := u.Table.(tableRow); !ok {
			t.Fatalf("replace upsert Table half = %#v, want tableRow", u.Table)
		}
	}
	// But the stored bundles dropped the Table half.
	for _, row := range store.List() {
		b := row.(Bundle)
		if b.Table != nil {
			t.Fatalf("stored Table half after Replace = %#v, want nil", b.Table)
		}
	}

	// Relist that drops "a": the vanished key must reach DeleteBundle with a usable Catalog
	// half so a catalog-keyed maintained store evicts it (no ghost on relist).
	if err := store.Replace([]interface{}{cm("default", "b")}, "2"); err != nil {
		t.Fatalf("Replace 2: %v", err)
	}
	if len(sink.deletes) != 1 {
		t.Fatalf("DeleteBundle calls after relist-delete = %d, want 1", len(sink.deletes))
	}
	got, ok := sink.deletes[0].Catalog.(catalogRow)
	if !ok || got.Key != "default/a" {
		t.Fatalf("relist-delete Catalog half = %#v, want catalogRow{default/a}", sink.deletes[0].Catalog)
	}
}
