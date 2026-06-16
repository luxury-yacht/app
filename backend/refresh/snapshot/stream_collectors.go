/*
 * backend/refresh/snapshot/stream_collectors.go
 *
 * Shared registry-driven dispatch for the typed-table snapshot domains. A domain
 * builder declares one kindCollector per kind it serves — each collector lists
 * that kind and builds its rows by calling the kind package's stream-summary
 * builder — and loops them via collectDomainRows instead of hand-coding a
 * per-kind list+build. The per-kind row construction lives in the kind packages;
 * this file owns only the shared loop, permission gating, and source list.
 */

package snapshot

import (
	"context"
	"fmt"
)

// kindCollector lists one kind within a typed-table domain and builds its rows.
type kindCollector[Row any] struct {
	kind      string
	group     string
	resource  string
	available bool
	// collect lists the kind's objects in namespace (all namespaces when empty)
	// and returns the rows plus the max observed resource version. It is nil when
	// the kind is unavailable (denied), in which case the kind still appears in
	// the source list but is not listed.
	collect func(meta ClusterMeta, namespace string) ([]Row, uint64, error)
}

// collectDomainRows loops the collectors, gating each on runtime permission,
// building the per-kind source list and accumulating rows plus the max resource
// version. It is the single dispatch every typed-table domain builder uses.
func collectDomainRows[Row any](
	ctx context.Context,
	domainName string,
	collectors []kindCollector[Row],
	meta ClusterMeta,
	namespace string,
) ([]Row, []typedTableResourceSource, uint64, error) {
	rows := make([]Row, 0)
	sources := make([]typedTableResourceSource, 0, len(collectors))
	var version uint64
	for _, collector := range collectors {
		available := collector.available && runtimeResourceAllowed(ctx, domainName, collector.group, collector.resource)
		sources = append(sources, typedTableResourceSource{
			Kind:      collector.kind,
			Group:     collector.group,
			Resource:  collector.resource,
			Available: available,
		})
		if !available || collector.collect == nil {
			continue
		}
		collected, collectorVersion, err := collector.collect(meta, namespace)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("%s: failed to list %s: %w", domainName, collector.resource, err)
		}
		rows = append(rows, collected...)
		if collectorVersion > version {
			version = collectorVersion
		}
	}
	return rows, sources, version, nil
}
