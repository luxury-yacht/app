package ingest

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// versionedCatalogRow is a Catalog half that carries the object's
// resourceVersion, so a test can tell which delivery replaced which row.
type versionedCatalogRow struct {
	Key string
	RV  string
}

func versionedCatalogProject(obj interface{}) (interface{}, error) {
	cm := obj.(*corev1.ConfigMap)
	return Bundle{Catalog: versionedCatalogRow{Key: cm.Namespace + "/" + cm.Name, RV: cm.ResourceVersion}}, nil
}

func configMapAt(ns, name, resourceVersion string) *corev1.ConfigMap {
	return &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: resourceVersion}}
}

type catalogChange struct {
	previous interface{}
	row      interface{}
}

// recordingUpsertChanger records UpsertChange deliveries and any plain Upsert, which
// an UpsertChanger must never receive.
type recordingUpsertChanger struct {
	recordingSink
	changeMu sync.Mutex
	changes  []catalogChange
}

func (s *recordingUpsertChanger) UpsertChange(previous, row interface{}) {
	s.changeMu.Lock()
	defer s.changeMu.Unlock()
	s.changes = append(s.changes, catalogChange{previous: previous, row: row})
}

func (s *recordingUpsertChanger) takeChanges() []catalogChange {
	s.changeMu.Lock()
	defer s.changeMu.Unlock()
	changes := s.changes
	s.changes = nil
	return changes
}

func versionedRow(ns, name, resourceVersion string) versionedCatalogRow {
	return versionedCatalogRow{Key: ns + "/" + name, RV: resourceVersion}
}

// An UpsertChanger sees the row each delivery replaces, so it can tell a relist's
// unchanged re-upsert from a real change without remembering every object.
func TestProjectingStoreGivesUpsertChangersTheRowTheyReplace(t *testing.T) {
	store := NewProjectingStore(versionedCatalogProject)
	require.NoError(t, store.Add(configMapAt("default", "a", "1")))

	sink := &recordingUpsertChanger{}
	store.AddCatalogSink(sink)
	require.Equal(t, []catalogChange{{previous: versionedRow("default", "a", "1"), row: versionedRow("default", "a", "1")}},
		sink.takeChanges(), "replaying the current set is not a change")

	require.NoError(t, store.Update(configMapAt("default", "a", "2")))
	require.NoError(t, store.Add(configMapAt("default", "b", "1")))
	require.Equal(t, []catalogChange{
		{previous: versionedRow("default", "a", "1"), row: versionedRow("default", "a", "2")},
		{previous: nil, row: versionedRow("default", "b", "1")},
	}, sink.takeChanges())

	require.NoError(t, store.Replace([]interface{}{configMapAt("default", "a", "2"), configMapAt("default", "b", "1")}, "10"))
	require.ElementsMatch(t, []catalogChange{
		{previous: versionedRow("default", "a", "2"), row: versionedRow("default", "a", "2")},
		{previous: versionedRow("default", "b", "1"), row: versionedRow("default", "b", "1")},
	}, sink.takeChanges(), "a relist of unchanged rows pairs each row with itself")

	require.NoError(t, store.ReplacePartition("default", []interface{}{configMapAt("default", "a", "3")}, "11"))
	require.Equal(t, []catalogChange{{previous: versionedRow("default", "a", "2"), row: versionedRow("default", "a", "3")}}, sink.takeChanges())

	upserts, deletes := sink.snapshot()
	require.Empty(t, upserts, "an UpsertChanger receives UpsertChange instead of Upsert")
	require.Equal(t, []interface{}{versionedRow("default", "b", "1")}, deletes)
}
