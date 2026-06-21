package resourcestream

// notifyOnlyStreamDomains are domains whose live stream ships change
// notifications — Ref + ResourceVersion + Sequence — WITHOUT the projected Row.
//
// Their tables are query-backed: the visible page is fetched over HTTP and the
// live subscription exists only to learn WHEN to refetch (the frontend consumes
// the data identity, bumping streamRevision on each event). Shipping the full
// row payload on every delta is therefore pure waste — it crosses the bridge,
// is retained, and is re-sorted, then ignored. Omitting Row stops that.
//
// This is safe only when NO consumer reads the domain's live rows. Drift
// detection keeps working because shadow keys are built from Ref, not Row, and
// deletes already travel row-less today.
//
// Note: pods still build the upstream row projection and it is dropped here at
// the chokepoint (the pod build computes load-bearing broadcast scope); the
// workloads/nodes handlers skip the build. See
// docs/architecture/notify-only-streams.md.
//
// Source of truth: refresh-domain-contract.json domainInventory[*].notifyOnly.
// notify_only_parity_test.go asserts this set matches the contract.
var notifyOnlyStreamDomains = map[string]bool{
	domainPods:      true,
	domainWorkloads: true,
	domainNodes:     true,
}

// isNotifyOnlyStreamDomain reports whether the domain's stream omits row
// payloads (see notifyOnlyStreamDomains).
func isNotifyOnlyStreamDomain(domain string) bool {
	return notifyOnlyStreamDomains[domain]
}
