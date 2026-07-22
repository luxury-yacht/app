package snapshot

// WorkloadOwnerKey returns the canonical key used for workload pod grouping.
func WorkloadOwnerKey(kind, namespace, name string) string {
	return workloadOwnerKey(kind, namespace, name)
}
