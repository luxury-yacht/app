package logstream

import "testing"

func TestGlobalTargetLimiterSharesBudgetAcrossClusters(t *testing.T) {
	limiter := NewGlobalTargetLimiter(4)

	clusterA := limiter.StartSession("cluster-a", "scope-a")
	clusterB := limiter.StartSession("cluster-b", "scope-b")
	defer clusterA.Release()
	defer clusterB.Release()

	_, skippedA := clusterA.UpdateDesired([]string{"a1", "a2", "a3", "a4"})
	if skippedA != 0 {
		t.Fatalf("expected first session to take full budget initially, got skipped=%d", skippedA)
	}
	_, skippedB := clusterB.UpdateDesired([]string{"b1", "b2", "b3", "b4"})
	allowedA, _ := clusterA.UpdateDesired([]string{"a1", "a2", "a3", "a4"})
	allowedB, _ := clusterB.UpdateDesired([]string{"b1", "b2", "b3", "b4"})

	if len(allowedA) != 2 || len(allowedB) != 2 {
		t.Fatalf("expected fair 2/2 split, got %d and %d", len(allowedA), len(allowedB))
	}
	if skippedB != 2 {
		t.Fatalf("expected second session to skip 2 targets after rebalance, got %d", skippedB)
	}
}

func TestGlobalTargetLimiterReusesSpareClusterCapacity(t *testing.T) {
	limiter := NewGlobalTargetLimiter(5)

	clusterA := limiter.StartSession("cluster-a", "scope-a")
	clusterB := limiter.StartSession("cluster-b", "scope-b")
	defer clusterA.Release()
	defer clusterB.Release()

	allowedA, _ := clusterA.UpdateDesired([]string{"a1", "a2", "a3", "a4"})
	allowedB, skippedB := clusterB.UpdateDesired([]string{"b1"})

	if len(allowedA) != 4 {
		t.Fatalf("expected cluster A to use spare capacity, got %d targets", len(allowedA))
	}
	if len(allowedB) != 1 || skippedB != 0 {
		t.Fatalf("expected cluster B to keep its single target, got len=%d skipped=%d", len(allowedB), skippedB)
	}
}

func TestGlobalTargetLimiterSharesWithinClusterAcrossScopes(t *testing.T) {
	limiter := NewGlobalTargetLimiter(3)

	scopeA := limiter.StartSession("cluster-a", "scope-a")
	scopeB := limiter.StartSession("cluster-a", "scope-b")
	defer scopeA.Release()
	defer scopeB.Release()

	scopeA.UpdateDesired([]string{"a1", "a2", "a3"})
	allowedB, _ := scopeB.UpdateDesired([]string{"b1", "b2", "b3"})

	allowedA, _ := scopeA.UpdateDesired([]string{"a1", "a2", "a3"})
	if len(allowedA) != 2 || len(allowedB) != 1 {
		t.Fatalf("expected deterministic 2/1 split across scopes, got %d and %d", len(allowedA), len(allowedB))
	}
}

func TestGlobalTargetLimiterNotifyOnRebalance(t *testing.T) {
	limiter := NewGlobalTargetLimiter(2)

	scopeA := limiter.StartSession("cluster-a", "scope-a")
	scopeB := limiter.StartSession("cluster-b", "scope-b")
	defer scopeA.Release()
	defer scopeB.Release()

	scopeA.UpdateDesired([]string{"a1", "a2"})
	drainNotify(scopeA.Notify())

	scopeB.UpdateDesired([]string{"b1", "b2"})

	select {
	case <-scopeA.Notify():
	default:
		t.Fatal("expected scope A to be notified after global rebalance")
	}
}

func TestBuildGlobalTargetLimitWarnings(t *testing.T) {
	warnings := buildGlobalTargetLimitWarnings(2, 4, 72)
	if len(warnings) != 1 {
		t.Fatalf("expected one warning, got %d", len(warnings))
	}
	if warnings[0] != "Logs are hidden for 2 containers because the global limit of 72 was reached. Using filters to reduce the number of containers may clear this message." {
		t.Fatalf("unexpected warning: %q", warnings[0])
	}
}

func drainNotify(ch <-chan struct{}) {
	if ch == nil {
		return
	}
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}
