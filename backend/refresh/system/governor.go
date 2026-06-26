package system

// ResourceTier is a cluster's runtime resource tier, assigned by the process-wide
// governor to bound RAM when many clusters are open (see
// docs/architecture/data-layer.md, "Lifecycle & governor").
//
//   - Foreground: the cluster the user is viewing — full ingestion + metrics poller.
//   - Background: recently-viewed, kept warm (informers live, metrics poller paused),
//     up to a small LRU budget so a tab-switch back is instant.
//   - Cold: torn down, heap reclaimed; re-warmed (re-synced) when the user revisits.
type ResourceTier int

const (
	TierForeground ResourceTier = iota
	TierBackground
	TierCold
)

func (t ResourceTier) String() string {
	switch t {
	case TierForeground:
		return "foreground"
	case TierBackground:
		return "background"
	default:
		return "cold"
	}
}

// GovernorPolicy is the PURE tier-assignment policy. Keeping it a pure function of its
// inputs — independent of the subsystem build/teardown wiring — is what makes the
// memory policy unit-testable on its own; the wiring layer just applies the result.
type GovernorPolicy struct {
	// KeepWarm is the maximum number of non-visible clusters kept in Background (warm)
	// when the process is not under memory pressure. Beyond it, clusters go Cold.
	KeepWarm int
}

// Assign returns the desired tier for each open cluster. `mru` lists the open clusters
// in most-recently-visible-first order; `visible` is the one cluster the user is
// currently viewing (always Foreground if open). `underPressure` is the memory
// governor's signal: under pressure the warm budget collapses to 0, so every
// non-visible cluster is demoted Cold to reclaim heap.
func (p GovernorPolicy) Assign(mru []string, visible string, underPressure bool) map[string]ResourceTier {
	warm := p.KeepWarm
	if underPressure {
		warm = 0
	}
	out := make(map[string]ResourceTier, len(mru))
	warmed := 0
	for _, id := range mru {
		switch {
		case id == visible:
			out[id] = TierForeground
		case warmed < warm:
			out[id] = TierBackground
			warmed++
		default:
			out[id] = TierCold
		}
	}
	return out
}

// GovernorTransition is the action the wiring layer must take for one cluster to
// move it from its last-applied tier to its desired tier. Keeping the decision a
// PURE function of (lastApplied, desired) — separate from the subsystem build/
// teardown calls it triggers — is what makes the reconcile decisions unit-testable
// without standing up real refresh subsystems.
type GovernorTransition struct {
	ClusterID string
	Tier      ResourceTier
	// EnsureRunning is true when the cluster must be built+started if it is not
	// already (Foreground and Background both require a live subsystem).
	EnsureRunning bool
	// MetricsActive is the demand-driven metrics poller state to apply once the
	// subsystem is running: Foreground pins it active, Background lets it idle out.
	// Only meaningful when EnsureRunning is true.
	MetricsActive bool
	// Teardown is true when the cluster must be torn down and its heap reclaimed
	// (Cold). When Teardown is true, EnsureRunning is false.
	Teardown bool
}

// PlanGovernorTransitions computes the per-cluster actions needed to move every
// open cluster from its last-applied tier to its desired tier. It returns one
// transition per cluster whose desired tier DIFFERS from last-applied (idempotent:
// clusters already at their desired tier produce no action). Clusters present in
// lastApplied but absent from desired are no longer open and are ignored — the
// open/close lifecycle (syncClusterClientPool) owns their teardown, not the governor.
func PlanGovernorTransitions(lastApplied, desired map[string]ResourceTier) []GovernorTransition {
	var transitions []GovernorTransition
	for id, tier := range desired {
		if prev, ok := lastApplied[id]; ok && prev == tier {
			continue
		}
		t := GovernorTransition{ClusterID: id, Tier: tier}
		switch tier {
		case TierForeground:
			t.EnsureRunning = true
			t.MetricsActive = true
		case TierBackground:
			t.EnsureRunning = true
			t.MetricsActive = false
		default: // TierCold
			t.Teardown = true
		}
		transitions = append(transitions, t)
	}
	return transitions
}
