package querypage

import (
	"fmt"
	"testing"
)

type backRow struct {
	uid string
	v   string
	grp string
}

func backSchema() Schema[backRow] {
	return Schema[backRow]{
		UID: func(r backRow) string { return r.uid },
		SortKeys: map[string]func(backRow) string{
			"v": func(r backRow) string { return r.v },
		},
		Facets: map[string]func(backRow) string{
			"grp": func(r backRow) string { return r.grp },
		},
		SearchText: func(r backRow) string { return r.v + " " + r.grp },
	}
}

func backRowUIDs(rows []backRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.uid
	}
	return out
}

func equalUIDSlice(a, b []string) bool {
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

// TestStoreBackwardPaginationReproducesPriorPage is the backward-pagination gate:
// after walking fully forward, each page's PrevCursor must reproduce the immediately
// prior page EXACTLY (same rows, same order), and the first page must expose no
// PrevCursor — across both sort directions, with and without filters/search.
func TestStoreBackwardPaginationReproducesPriorPage(t *testing.T) {
	for _, dir := range []Direction{Ascending, Descending} {
		for _, filtered := range []bool{false, true} {
			store := NewStore(backSchema())
			for i := 0; i < 95; i++ {
				store.Upsert(backRow{
					uid: fmt.Sprintf("u%03d", i),
					v:   fmt.Sprintf("val-%02d", i%30), // deliberate ties
					grp: []string{"a", "b", "c"}[i%3],
				})
			}
			q := Query{ClusterID: "c", Signature: "s", Sort: "v", Direction: dir, Limit: 7}
			if filtered {
				q.Filters = map[string][]string{"grp": {"a", "b"}}
				q.Search = "val"
			}

			type pg struct {
				uids []string
				prev string
				next string
			}
			var pages []pg
			cursor := ""
			for i := 0; ; i++ {
				if i > 1000 {
					t.Fatalf("dir=%s filtered=%v: forward pagination did not terminate", dir, filtered)
				}
				q.Cursor = cursor
				page, err := store.Query(q)
				if err != nil {
					t.Fatal(err)
				}
				pages = append(pages, pg{uids: backRowUIDs(page.Rows), prev: page.PrevCursor, next: page.NextCursor})
				if page.NextCursor == "" {
					break
				}
				cursor = page.NextCursor
			}
			if len(pages) < 3 {
				t.Fatalf("dir=%s filtered=%v: expected several pages, got %d", dir, filtered, len(pages))
			}
			if pages[0].prev != "" {
				t.Fatalf("dir=%s filtered=%v: first page must have empty PrevCursor, got %q", dir, filtered, pages[0].prev)
			}

			// Each page i>=1: querying with its PrevCursor reproduces page i-1 exactly.
			for i := 1; i < len(pages); i++ {
				q.Cursor = pages[i].prev
				page, err := store.Query(q)
				if err != nil {
					t.Fatal(err)
				}
				got := backRowUIDs(page.Rows)
				if !equalUIDSlice(got, pages[i-1].uids) {
					t.Fatalf("dir=%s filtered=%v: backward from page %d gave %v, want prior page %v",
						dir, filtered, i, got, pages[i-1].uids)
				}
				// The prev page's NextCursor must point forward to page i again.
				q.Cursor = page.NextCursor
				fwd, err := store.Query(q)
				if err != nil {
					t.Fatal(err)
				}
				if !equalUIDSlice(backRowUIDs(fwd.Rows), pages[i].uids) {
					t.Fatalf("dir=%s filtered=%v: forward from reproduced page %d did not return page %d",
						dir, filtered, i-1, i)
				}
			}
		}
	}
}
