package querypage

import (
	"fmt"
	"path/filepath"
	"sort"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMmapBackedColumnQueryPrototype is Prototype #4 for Tier 2.6's dual-mode serving: it
// proves a realistic query — filter + multi-key sort + pagination — answered by reading
// columns DIRECTLY from a mmap'd column file (the int64/uint32 sort+filter columns zero-copy
// via Int64Column/Uint32Column, the string column via StringAt's offset table) returns exactly
// the same page as an in-memory baseline.
//
// This de-risks the production change before it touches the query hot path: it validates that
// a Cold cluster's store can serve from off-heap, OS-reclaimable page cache (the column data
// never enters the Go heap — only the small per-row sort/filter values and the final page's
// strings are materialised) with byte-identical results. The remaining production work is the
// columnStore retrofit (read-only, mmap-aliased columns) + the governor Cold-tier lifecycle.
func TestMmapBackedColumnQueryPrototype(t *testing.T) {
	type row struct {
		id   int64
		ns   uint32
		name string
	}
	const n = 2000
	rows := make([]row, n)
	for i := range rows {
		rows[i] = row{
			id:   int64((i * 2_654_435_761) % 100_000), // scattered ids, with ties
			ns:   uint32(i % 4),
			name: fmt.Sprintf("obj-%05d", i),
		}
	}

	ids := make([]int64, n)
	nss := make([]uint32, n)
	names := make([]string, n)
	for i, r := range rows {
		ids[i], nss[i], names[i] = r.id, r.ns, r.name
	}
	path := filepath.Join(t.TempDir(), "proto.cols")
	require.NoError(t, writeColumnFile(path, ids, nss, names))

	cf, err := openColumnFile(path)
	require.NoError(t, err)
	defer cf.Close()

	const targetNS = uint32(2)
	const pageLimit = 50

	// Query straight from the mapping: filter ns==target (zero-copy uint32 column), sort by
	// (id asc, name asc) (zero-copy int64 column + StringAt tie-break), take the first page.
	idCol := cf.Int64Column()  // aliases the mapping — off-heap
	nsCol := cf.Uint32Column() // aliases the mapping — off-heap
	var matched []int
	for i := 0; i < cf.Int64Len(); i++ {
		if nsCol[i] == targetNS {
			matched = append(matched, i)
		}
	}
	sort.Slice(matched, func(a, b int) bool {
		ia, ib := matched[a], matched[b]
		if idCol[ia] != idCol[ib] {
			return idCol[ia] < idCol[ib]
		}
		return cf.StringAt(ia) < cf.StringAt(ib)
	})
	if len(matched) > pageLimit {
		matched = matched[:pageLimit]
	}
	gotNames := make([]string, len(matched))
	for i, idx := range matched {
		gotNames[i] = cf.StringAt(idx)
	}

	// In-memory baseline: the same filter + sort + page over the original rows.
	var base []row
	for _, r := range rows {
		if r.ns == targetNS {
			base = append(base, r)
		}
	}
	sort.Slice(base, func(a, b int) bool {
		if base[a].id != base[b].id {
			return base[a].id < base[b].id
		}
		return base[a].name < base[b].name
	})
	if len(base) > pageLimit {
		base = base[:pageLimit]
	}
	wantNames := make([]string, len(base))
	for i, r := range base {
		wantNames[i] = r.name
	}

	require.NotEmpty(t, gotNames)
	require.Equal(t, wantNames, gotNames,
		"a filter+sort+page query served from the mmap'd columns must match the in-memory baseline")
}
