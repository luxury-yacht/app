package querypage

import (
	"fmt"
	"math/rand"
	"testing"
)

func genPods(n int, r *rand.Rand) []podRow {
	statuses := []string{"Running", "Pending", "Failed", "Succeeded"}
	namespaces := make([]string, 50)
	for i := range namespaces {
		namespaces[i] = fmt.Sprintf("ns-%02d", i)
	}
	pods := make([]podRow, n)
	for i := range pods {
		pods[i] = podRow{
			uid:       fmt.Sprintf("uid-%07d", i),
			namespace: namespaces[r.Intn(len(namespaces))],
			name:      fmt.Sprintf("pod-%07d", i),
			status:    statuses[r.Intn(len(statuses))],
			cpu:       int64(r.Intn(4000)),
		}
	}
	return pods
}

func buildStore(n int) (*Store[podRow], []podRow) {
	r := rand.New(rand.NewSource(1))
	pods := genPods(n, r)
	s := NewStore(podSchema())
	for _, p := range pods {
		s.Upsert(p)
	}
	return s, pods
}

func benchSizes() []int { return []int{100_000, 1_000_000} }

// BenchmarkStoreUpsertChurn measures generic per-event write cost (2 indexes +
// 2 facets) — the production analogue of the prototype's multi-index churn.
func BenchmarkStoreUpsertChurn(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			s, pods := buildStore(n)
			r := rand.New(rand.NewSource(2))
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				p := pods[i%n]
				p.cpu = int64(r.Intn(4000)) // churn: changes the cpu sort key
				s.Upsert(p)
			}
		})
	}
}

// BenchmarkStoreQueryFirstPage measures the first-page read (keyset from the top).
func BenchmarkStoreQueryFirstPage(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			s, _ := buildStore(n)
			q := Query{ClusterID: "c", Signature: "sig", Sort: "cpu", Direction: Descending, Limit: 250}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := s.Query(q); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkStoreQueryDeepPage seeks ~halfway in via a cursor — proving keyset paging
// is O(log N + page) regardless of depth (no offset-style degradation).
func BenchmarkStoreQueryDeepPage(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			s, _ := buildStore(n)
			q := Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 250}
			cur := FirstPage(q.ClusterID, q.Signature, q.Sort, q.Direction, q.Limit)
			cur.Position = []string{fmt.Sprintf("pod-%07d", n/2)}
			cur.UID = fmt.Sprintf("uid-%07d", n/2)
			q.Cursor = cur.Encode()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := s.Query(q); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
