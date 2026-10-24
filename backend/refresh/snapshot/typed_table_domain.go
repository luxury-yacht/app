package snapshot

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// typedTableDomainSpec bundles the per-domain values for the shared typed-table
// domain skeleton (the config/RBAC/storage/quotas/autoscaling tables). Every one
// of those domains follows the same shape — an availability-gated multi-kind row
// collection served from a reflector-fed maintained store — so each domain file
// declares only this spec plus its columns, sort, and payload type.
type typedTableDomainSpec[T any] struct {
	domain string
	// scopeRequiredErr, when non-empty, marks a namespace-scoped domain: Build
	// parses the namespace scope with this error message and serves rows for that
	// namespace. Cluster-scoped domains leave it empty and serve all rows.
	scopeRequiredErr string
	entryLimit       int
	// description names the row set in truncation diagnostics.
	description  string
	adapter      typedTableQueryAdapter[T]
	schema       querypage.Schema[T]
	capabilities ResourceQueryCapabilities
	sortRows     func([]T)
	// payload constructs the domain's named payload struct so the wire JSON and
	// the generated frontend types stay per-domain.
	payload func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []T) any
	// derived, when set, maps one row to the changes of other domains whose
	// serve-time joins read the same source.
	derived rowDerivation[T]
}

// rowDerivation maps one changed row to other domains' changes; domains lists
// them for a relist that redefines the whole kind.
type rowDerivation[T any] struct {
	changes func(row T) []doorbell.Change
	domains []string
}

// typedTableSources computes per-descriptor availability for THIS request
// (available at registration AND runtimeResourceAllowed), returning the snapshot
// sources and a Kind→available map.
func typedTableSources(
	ctx context.Context,
	domainName string,
	available kindAvailability,
) ([]typedTableResourceSource, map[string]bool) {
	sources := collectDescriptorSources(ctx, domainName, available)
	kinds := make(map[string]bool, len(sources))
	for _, source := range sources {
		kinds[source.Kind] = source.State.servesRows()
	}
	return sources, kinds
}

// buildTypedTableSnapshot is the shared Build skeleton: parse the (cluster- or
// namespace-scoped) query scope, then serve the query straight from the
// reflector-fed maintained store, querying it in place (O(log N + page)).
func buildTypedTableSnapshot[T any](
	ctx context.Context,
	scope string,
	spec typedTableDomainSpec[T],
	available kindAvailability,
	maintained *typedMaintainedStore[T],
) (*refresh.Snapshot, error) {
	if maintained == nil {
		return nil, fmt.Errorf("%s: maintained store is not wired", spec.domain)
	}
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), spec.domain, "")
	if err != nil {
		return nil, err
	}

	// rowsScope selects the store rows: the parsed namespace for a
	// namespace-scoped domain, all rows ("") for a cluster-scoped one.
	rowsScope := ""
	if spec.scopeRequiredErr != "" {
		parsedScope, scopeErr := parseNamespaceSnapshotScope(spec.domain, clusterID, baseScope, spec.scopeRequiredErr)
		if scopeErr != nil {
			return nil, scopeErr
		}
		rowsScope = parsedScope.Namespace
	}

	sources, availableKinds := typedTableSources(ctx, spec.domain, available)
	resolved := resolveMaintainedDirect(
		maintained.store,
		query,
		maintainedQueryScope{availableKinds: availableKinds, namespace: rowsScope},
		spec.adapter,
		spec.schema,
		func() []T {
			rows := maintained.rows(rowsScope, availableKinds)
			spec.sortRows(rows)
			return rows
		},
		newTypedSnapshotPageConfig(
			capabilitiesWithAvailableKinds(spec.capabilities, sources),
			spec.entryLimit,
			spec.description,
			spec.adapter.Kind,
			typedTableQueryResourceIssues(ctx, spec.domain, query, sources),
		),
	)

	// A namespace-scoped snapshot always publishes its full request scope. For a
	// cluster-scoped domain the window snapshot is the canonical unscoped refresh
	// payload; only the query page publishes the request scope.
	snapshotScope := refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	if spec.scopeRequiredErr == "" && !query.Enabled {
		snapshotScope = ""
	}
	return &refresh.Snapshot{
		Domain:  spec.domain,
		Scope:   snapshotScope,
		Version: maintained.snapshotVersion(),
		Payload: spec.payload(meta, resolved.Envelope, resolved.Rows),
		Stats:   resolved.Stats,
	}, nil
}

// newRegisteredTypedTableStore wires the shared maintained-store scaffolding every
// typed-table domain's Register performs: build the store, register it with the
// governor for spill/restore across Cold/re-warm, and feed it from the
// ingest reflectors' sinks. ingestManager is nil in unit tests, where the store
// has no feed.
func newRegisteredTypedTableStore[T any](
	reg *domain.Registry,
	spec typedTableDomainSpec[T],
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
	bell doorbell.Bell,
) (*typedMaintainedStore[T], error) {
	maintained := newTypedMaintainedStore(clusterMeta, spec.schema, spec.adapter)
	reg.RegisterMaintainedStore(spec.domain, maintained)
	feedMaintainedFromIngest(maintained, spec.domain, ingestManager, bell, spec.derived)
	return maintained, nil
}
