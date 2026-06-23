package querypage

import (
	"bufio"
	"encoding/gob"
	"fmt"
	"io"
	"os"
)

// spill.go adds disk spill + restore to a Store so a Cold cluster's stores can be
// flushed to disk (heap reclaimed) and restored fast on re-warm. The on-disk unit is
// the ROWS: the b-tree indexes, facet counters, and match cache are all derivable
// from the rows via the Schema, so they are NOT serialized — Restore rebuilds them by
// re-Upserting every row, which makes the restored store byte-equivalent in query
// behavior to the original (the round-trip gate proves this).
//
// The format is gob over Snapshot()'s []R. R is a concrete summary struct with
// exported fields, so it is gob-encodable (including its maps/slices/pointers). gob +
// os keeps this cross-platform with no syscalls.
//
// NOTE: the plan's mmap'd-column-file format (zero-copy page-cache reads) is a later
// performance optimization layered on top of this baseline. gob-rows is correct,
// portable, and reclaims the heap — the capability the governor's Cold action needs
// now — so it is the right baseline to ship first.

// Spill gob-encodes the store's rows ([]R from Snapshot) to w. Snapshot takes the
// store's read lock and returns an independent copy, so the encode runs without
// holding the lock (avoiding a recursive RLock) yet still sees a consistent set of
// rows. The derived indexes/facets/match-cache are intentionally not written; Restore
// rebuilds them from the rows.
func (s *Store[R]) Spill(w io.Writer) error {
	rows := s.Snapshot()
	if err := gob.NewEncoder(w).Encode(rows); err != nil {
		return fmt.Errorf("querypage: spill encode: %w", err)
	}
	return nil
}

// RestoreStore gob-decodes a []R written by Spill, builds a fresh Store for the given
// schema, and Upserts every row. Each Upsert rebuilds that row's index entries, facet
// counts, and match-cache entry incrementally, so the returned store is fully
// equivalent to the one that was spilled.
func RestoreStore[R any](r io.Reader, schema Schema[R]) (*Store[R], error) {
	var rows []R
	if err := gob.NewDecoder(r).Decode(&rows); err != nil {
		return nil, fmt.Errorf("querypage: restore decode: %w", err)
	}
	s := NewStore(schema)
	for _, row := range rows {
		s.Upsert(row)
	}
	return s, nil
}

// SpillToFile creates/truncates path and writes the store's spilled rows to it with a
// buffered writer. This is what the governor's Cold action calls.
func (s *Store[R]) SpillToFile(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("querypage: spill create %q: %w", path, err)
	}
	defer f.Close()
	bw := bufio.NewWriter(f)
	if err := s.Spill(bw); err != nil {
		return err
	}
	if err := bw.Flush(); err != nil {
		return fmt.Errorf("querypage: spill flush %q: %w", path, err)
	}
	return f.Close()
}

// RestoreStoreFromFile opens path and rebuilds a Store from the spilled rows with a
// buffered reader. This is what the governor's re-warm path calls.
func RestoreStoreFromFile[R any](path string, schema Schema[R]) (*Store[R], error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("querypage: restore open %q: %w", path, err)
	}
	defer f.Close()
	return RestoreStore(bufio.NewReader(f), schema)
}
