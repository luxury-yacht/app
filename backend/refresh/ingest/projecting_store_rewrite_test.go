/*
 * backend/refresh/ingest/projecting_store_rewrite_test.go
 *
 * RewriteBundlesByIndex: an out-of-band correction to stored bundles (the pod
 * owner heal) must behave exactly like a reflector Update for every observer —
 * sinks fed the full new bundle, secondary indexes moved, stored copy replaced —
 * while untouched bundles stay untouched.
 */

package ingest

import (
	"fmt"
	"testing"

	corev1 "k8s.io/api/core/v1"
)

// ownerRow is the rewrite tests' Table half: a row whose Owner field is the
// rewrite target (mirroring the pod row's projected owner).
type ownerRow struct {
	NS    string
	Name  string
	Owner string
}

const ownerIndexName = "test:owner"

// projectOwnerBundle projects a ConfigMap into a Bundle whose Table half carries
// an owner read from the "owner" annotation and whose index tracks that owner.
func projectOwnerBundle(obj interface{}) (interface{}, error) {
	cm, ok := obj.(*corev1.ConfigMap)
	if !ok {
		return nil, fmt.Errorf("projectOwnerBundle: unexpected type %T", obj)
	}
	owner := cm.Annotations["owner"]
	return Bundle{
		Table:   ownerRow{NS: cm.Namespace, Name: cm.Name, Owner: owner},
		Catalog: row{NS: cm.Namespace, Name: cm.Name},
		Indexes: map[string][]string{ownerIndexName: {owner}},
	}, nil
}

func ownedConfigMap(ns, name, owner string) *corev1.ConfigMap {
	cm := configMap(ns, name)
	cm.Annotations = map[string]string{"owner": owner}
	return cm
}

// captureBundleSink records every bundle delivery.
type captureBundleSink struct {
	upserts []Bundle
	deletes []Bundle
}

func (s *captureBundleSink) UpsertBundle(bundle Bundle) { s.upserts = append(s.upserts, bundle) }
func (s *captureBundleSink) DeleteBundle(bundle Bundle) { s.deletes = append(s.deletes, bundle) }

// captureTableSink records every Table-half delivery.
type captureTableSink struct {
	upserts []interface{}
	deletes []interface{}
}

func (s *captureTableSink) Upsert(tableRow interface{}) { s.upserts = append(s.upserts, tableRow) }
func (s *captureTableSink) Delete(tableRow interface{}) { s.deletes = append(s.deletes, tableRow) }

// rewriteOwner returns a rewrite func that retargets rows owned by from to to,
// updating the Table half and the owner index — the shape the pod heal uses.
func rewriteOwner(from, to string) func(Bundle) (Bundle, bool) {
	return func(b Bundle) (Bundle, bool) {
		table, ok := b.Table.(ownerRow)
		if !ok || table.Owner != from {
			return b, false
		}
		table.Owner = to
		b.Table = table
		b.Indexes = map[string][]string{ownerIndexName: {to}}
		return b, true
	}
}

func TestRewriteBundlesByIndexUpdatesStoreSinksAndIndexes(t *testing.T) {
	store := NewProjectingStore(projectOwnerBundle)
	store.SetRetainTable(true)

	if err := store.Add(ownedConfigMap("default", "app-1", "rs-1")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := store.Add(ownedConfigMap("default", "app-2", "rs-1")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := store.Add(ownedConfigMap("default", "other", "rs-2")); err != nil {
		t.Fatalf("Add: %v", err)
	}

	tableSink := &captureTableSink{}
	bundleSink := &captureBundleSink{}
	store.AddSink(tableSink)
	store.AddBundleSink(bundleSink)

	rewritten := store.RewriteBundlesByIndex(ownerIndexName, []string{"rs-1"}, rewriteOwner("rs-1", "deploy-1"))

	if len(rewritten) != 2 {
		t.Fatalf("rewritten = %d bundles, want 2", len(rewritten))
	}
	for _, b := range rewritten {
		if got := b.Table.(ownerRow).Owner; got != "deploy-1" {
			t.Fatalf("rewritten bundle owner = %q, want deploy-1", got)
		}
	}

	// The stored copies are replaced (read back through the index under the NEW value).
	byNew := store.RowsByIndex(ownerIndexName, []string{"deploy-1"})
	if len(byNew) != 2 {
		t.Fatalf("RowsByIndex(deploy-1) = %d rows, want 2", len(byNew))
	}
	// The OLD index value no longer reaches them.
	if byOld := store.RowsByIndex(ownerIndexName, []string{"rs-1"}); len(byOld) != 0 {
		t.Fatalf("RowsByIndex(rs-1) = %d rows, want 0 after rewrite", len(byOld))
	}
	// The untouched bundle is still reachable and unmodified.
	byOther := store.RowsByIndex(ownerIndexName, []string{"rs-2"})
	if len(byOther) != 1 {
		t.Fatalf("RowsByIndex(rs-2) = %d rows, want 1", len(byOther))
	}
	if got := byOther[0].(Bundle).Table.(ownerRow).Owner; got != "rs-2" {
		t.Fatalf("untouched bundle owner = %q, want rs-2", got)
	}

	// Sinks observed the rewrite exactly like a reflector Update: the FULL new
	// bundle (Table half present) to the bundle sink, the new Table half to the
	// table sink, and no deletes.
	if len(bundleSink.upserts) != 2 || len(bundleSink.deletes) != 0 {
		t.Fatalf("bundle sink saw %d upserts / %d deletes, want 2 / 0", len(bundleSink.upserts), len(bundleSink.deletes))
	}
	for _, b := range bundleSink.upserts {
		if got := b.Table.(ownerRow).Owner; got != "deploy-1" {
			t.Fatalf("bundle sink upsert owner = %q, want deploy-1", got)
		}
	}
	if len(tableSink.upserts) != 2 || len(tableSink.deletes) != 0 {
		t.Fatalf("table sink saw %d upserts / %d deletes, want 2 / 0", len(tableSink.upserts), len(tableSink.deletes))
	}
	for _, r := range tableSink.upserts {
		if got := r.(ownerRow).Owner; got != "deploy-1" {
			t.Fatalf("table sink upsert owner = %q, want deploy-1", got)
		}
	}
}

func TestRewriteBundlesByIndexNoMatchIsNoOp(t *testing.T) {
	store := NewProjectingStore(projectOwnerBundle)
	store.SetRetainTable(true)
	if err := store.Add(ownedConfigMap("default", "app-1", "rs-1")); err != nil {
		t.Fatalf("Add: %v", err)
	}
	bundleSink := &captureBundleSink{}
	store.AddBundleSink(bundleSink)

	// Unknown index value: nothing reachable, nothing rewritten.
	if got := store.RewriteBundlesByIndex(ownerIndexName, []string{"missing"}, rewriteOwner("rs-1", "deploy-1")); len(got) != 0 {
		t.Fatalf("rewrite(missing) = %d bundles, want 0", len(got))
	}
	// Reachable but the rewrite declines: stored copy and sinks untouched.
	if got := store.RewriteBundlesByIndex(ownerIndexName, []string{"rs-1"}, rewriteOwner("other-rs", "deploy-1")); len(got) != 0 {
		t.Fatalf("rewrite(declined) = %d bundles, want 0", len(got))
	}
	if len(bundleSink.upserts) != 0 || len(bundleSink.deletes) != 0 {
		t.Fatalf("bundle sink saw %d upserts / %d deletes, want 0 / 0", len(bundleSink.upserts), len(bundleSink.deletes))
	}
	if rows := store.RowsByIndex(ownerIndexName, []string{"rs-1"}); len(rows) != 1 {
		t.Fatalf("RowsByIndex(rs-1) = %d rows, want 1 (untouched)", len(rows))
	}
}
