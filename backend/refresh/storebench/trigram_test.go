package storebench

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"
)

var trigramVocab = []string{
	"frontend", "backend", "api", "gateway", "auth", "cache", "db", "worker",
	"cron", "queue", "proxy", "ingress", "redis", "postgres", "kafka", "nginx",
	"web", "app", "service", "daemon", "controller", "scheduler", "metrics",
	"logging", "tracing", "billing", "payment", "user", "order", "cart",
	"search", "index", "notify", "email", "sms", "push", "report", "export",
	"sync", "mesh",
}

// genNames produces realistic pod-like names ("<word>-<word>-<hex>") so trigram
// posting lists have a realistic distribution (common word trigrams + rare hex).
func genNames(n int, r *rand.Rand) []string {
	const hexd = "0123456789abcdef"
	names := make([]string, n)
	for i := range names {
		a := trigramVocab[r.Intn(len(trigramVocab))]
		b := trigramVocab[r.Intn(len(trigramVocab))]
		h := make([]byte, 5)
		for j := range h {
			h[j] = hexd[r.Intn(16)]
		}
		names[i] = a + "-" + b + "-" + string(h)
	}
	return names
}

// TestTrigramSearchMatchesLinear is the correctness gate: the trigram index must
// return exactly the same row set as a linear strings.Contains scan, for selective,
// common, absent, and sub-trigram (linear-fallback) queries.
func TestTrigramSearchMatchesLinear(t *testing.T) {
	r := rand.New(rand.NewSource(11))
	const n = 5000
	names := genNames(n, r)
	idx := NewTrigramIndex(n)
	for i, name := range names {
		idx.Add(uint32(i), name)
	}

	for _, q := range []string{"front", "gateway-auth", "api", "zzqq-absent", "redis", "ab"} {
		got := idx.Search(q, n) // no cap, so the full match set is returned
		gotSet := make(map[uint32]bool, len(got))
		for _, id := range got {
			gotSet[id] = true
		}
		ql := strings.ToLower(q)
		wantCount := 0
		for i, name := range names {
			if strings.Contains(strings.ToLower(name), ql) {
				wantCount++
				if !gotSet[uint32(i)] {
					t.Fatalf("query %q: linear match rowID %d missing from trigram result", q, i)
				}
			}
		}
		if len(gotSet) != wantCount {
			t.Fatalf("query %q: trigram returned %d rows, linear found %d", q, len(gotSet), wantCount)
		}
	}
}

func buildTrigramIndex(n int) *TrigramIndex {
	r := rand.New(rand.NewSource(1))
	names := genNames(n, r)
	idx := NewTrigramIndex(n)
	for i, name := range names {
		idx.Add(uint32(i), name)
	}
	return idx
}

// BenchmarkTrigramSearch measures filter-as-you-type latency for a selective
// query, a multi-trigram word, and a common short query (page-capped).
func BenchmarkTrigramSearch(b *testing.B) {
	for _, n := range benchSizes() {
		idx := buildTrigramIndex(n)
		for _, q := range []string{"gateway-auth", "frontend", "api"} {
			b.Run(fmt.Sprintf("N=%d/%s", n, q), func(b *testing.B) {
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					_ = idx.Search(q, 250)
				}
			})
		}
	}
}

// BenchmarkTrigramChurn measures the per-event maintenance cost of a rename
// (remove the old name's trigrams, add the new name's).
func BenchmarkTrigramChurn(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			idx := buildTrigramIndex(n)
			r := rand.New(rand.NewSource(5))
			pool := genNames(n, r) // fresh name shapes to rename to
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				idx.Update(uint32(i%n), pool[i%n])
			}
		})
	}
}
