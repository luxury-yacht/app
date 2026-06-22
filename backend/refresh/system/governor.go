package system

// ResourceTier is a cluster's runtime resource tier, assigned by the process-wide
// governor to bound RAM when many clusters are open (Phase 4 of the v2 architecture,
// docs/plans/v2-ground-up-architecture.md §"Multi-cluster, cold start & persistence").
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
