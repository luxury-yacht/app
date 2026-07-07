package querypage

import (
	"fmt"
	"testing"
)

// storeWith30 builds a store of 30 pods (u000..u029 / pod-000..pod-029) and the
// standard name-ascending query at limit 10, shared by the cursor-hardening tests.
func storeWith30(t *testing.T) (*Store[podRow], Query) {
	t.Helper()
	s := NewStore(podSchema())
	for i := 0; i < 30; i++ {
		s.Upsert(podRow{
			uid:       fmt.Sprintf("u%03d", i),
			namespace: "default",
			name:      fmt.Sprintf("pod-%03d", i),
			status:    "Running",
			cpu:       int64(i),
		})
	}
	return s, Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 10}
}

// An undecodable token must not error the serve: the engine restarts from the
// first page and signals CursorInvalid, so every executor degrades identically.
func TestQueryRestartsGracefullyOnUndecodableCursor(t *testing.T) {
	s, q := storeWith30(t)
	q.Cursor = "Zm9vYmFy" // valid base64 of "foobar" — not JSON
	page, err := s.Query(q)
	if err != nil {
		t.Fatalf("undecodable cursor must not error the query, got %v", err)
	}
	if !page.CursorInvalid {
		t.Fatal("undecodable cursor did not set CursorInvalid")
	}
	if len(page.Rows) != 10 || page.Rows[0].name != "pod-000" {
		t.Fatalf("expected a first-page restart, got %d rows starting %q",
			len(page.Rows), firstName(page.Rows))
	}
}

// A well-formed token pinned to a DIFFERENT query shape restarts from the first
// page (as before) and now also signals CursorInvalid so callers need no
// duplicate pre-validation.
func TestQueryFlagsMismatchedCursorAsInvalid(t *testing.T) {
	s, q := storeWith30(t)
	other := Cursor{
		ClusterID: q.ClusterID, Signature: "some-other-shape", Sort: q.Sort,
		Direction: q.Direction, Limit: q.Limit, Position: "pod-014", UID: "u014",
	}
	q.Cursor = other.Encode()
	page, err := s.Query(q)
	if err != nil {
		t.Fatalf("mismatched cursor must not error the query, got %v", err)
	}
	if !page.CursorInvalid {
		t.Fatal("mismatched cursor did not set CursorInvalid")
	}
	if len(page.Rows) != 10 || page.Rows[0].name != "pod-000" {
		t.Fatalf("expected a first-page restart, got %d rows starting %q",
			len(page.Rows), firstName(page.Rows))
	}
}

// A valid cursor keeps paging with no invalid signal.
func TestQueryValidCursorNotFlagged(t *testing.T) {
	s, q := storeWith30(t)
	page1, err := s.Query(q)
	if err != nil {
		t.Fatal(err)
	}
	if page1.CursorInvalid {
		t.Fatal("first page flagged CursorInvalid")
	}
	q.Cursor = page1.NextCursor
	page2, err := s.Query(q)
	if err != nil {
		t.Fatal(err)
	}
	if page2.CursorInvalid {
		t.Fatal("valid continue cursor flagged CursorInvalid")
	}
	if len(page2.Rows) != 10 || page2.Rows[0].name != "pod-010" {
		t.Fatalf("expected page 2 rows, got %d starting %q", len(page2.Rows), firstName(page2.Rows))
	}
}

// A valid BACKWARD cursor whose predecessors were all deleted is an
// un-navigable dead end: the engine returns the empty page and signals
// CursorInvalid so the client restarts at page 1. This rule moves from the
// catalog caller into the engine so all executors behave identically.
func TestQueryFlagsBackwardDeadEndAsInvalid(t *testing.T) {
	s, q := storeWith30(t)
	page1, err := s.Query(q)
	if err != nil {
		t.Fatal(err)
	}
	q2 := q
	q2.Cursor = page1.NextCursor
	page2, err := s.Query(q2)
	if err != nil {
		t.Fatal(err)
	}
	if page2.PrevCursor == "" {
		t.Fatal("page 2 minted no PrevCursor")
	}
	// Delete every row before page 2's first row (pod-000..pod-009).
	for i := 0; i < 10; i++ {
		s.Delete(fmt.Sprintf("u%03d", i))
	}
	qb := q
	qb.Cursor = page2.PrevCursor
	back, err := s.Query(qb)
	if err != nil {
		t.Fatalf("backward dead end must not error the query, got %v", err)
	}
	if len(back.Rows) != 0 {
		t.Fatalf("expected an empty backward dead-end page, got %d rows", len(back.Rows))
	}
	if !back.CursorInvalid {
		t.Fatal("backward dead end did not set CursorInvalid")
	}
}

// A backward cursor with SOME predecessors left is a normal previous page, not
// a dead end.
func TestQueryBackwardWithSurvivorsNotFlagged(t *testing.T) {
	s, q := storeWith30(t)
	page1, err := s.Query(q)
	if err != nil {
		t.Fatal(err)
	}
	q2 := q
	q2.Cursor = page1.NextCursor
	page2, err := s.Query(q2)
	if err != nil {
		t.Fatal(err)
	}
	// Delete only half the predecessors (pod-000..pod-004).
	for i := 0; i < 5; i++ {
		s.Delete(fmt.Sprintf("u%03d", i))
	}
	qb := q
	qb.Cursor = page2.PrevCursor
	back, err := s.Query(qb)
	if err != nil {
		t.Fatal(err)
	}
	if back.CursorInvalid {
		t.Fatal("surviving backward page wrongly flagged CursorInvalid")
	}
	if len(back.Rows) != 5 || back.Rows[0].name != "pod-005" {
		t.Fatalf("expected the 5 surviving predecessors, got %d starting %q",
			len(back.Rows), firstName(back.Rows))
	}
}

func firstName(rows []podRow) string {
	if len(rows) == 0 {
		return ""
	}
	return rows[0].name
}
