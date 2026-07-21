package snapshot

import (
	"context"
	"fmt"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// typedTableDomainSpec bundles the per-domain values for the shared typed-table
// domain skeleton (the config/RBAC/storage/quotas/autoscaling tables). Every one
// of those domains follows the same shape — an availability-gated multi-kind row
// collection served either from an informer-fed maintained store or a per-request
// list — so each domain file declares only this spec plus its columns, sort, and
// payload type.
type typedTableDomainSpec[T any] struct {
	domain string
	// scopeRequiredErr, when non-empty, marks a namespace-scoped domain: Build
	// parses the namespace scope with this error message and serves rows for that
	// namespace. Cluster-scoped domains leave it empty and serve all rows.
	scopeRequiredErr string
	entryLimit       int
	// description names the row set in truncation diagnostics.
	description string
	// listErrorPrefix, when non-empty, wraps the list path's error to preserve
	// each domain's historical error text.
	listErrorPrefix string
	adapter         typedTableQueryAdapter[T]
	schema          querypage.Schema[T]
	capabilities    ResourceQueryCapabilities
	kindOf          func(T) string
	sortRows        func([]T)
}

// typedTableSources computes per-descriptor availability for THIS request (indexer
// present AND runtimeResourceAllowed), returning the snapshot sources and a
// Kind→available map — the same gating collectDescriptorTableRows applies, so the
// maintained-store path and the list path agree on which kinds are visible.
func typedTableSources(
	ctx context.Context,
	domainName string,
	collectIndexer func(streamspec.Descriptor) cache.Indexer,
) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(domainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := collectIndexer(d) != nil && runtimeResourceAllowed(ctx, domainName, d.Group, d.Resource)
		sources = append(sources, typedTableResourceSource{
			Kind:      d.Kind,
			Group:     d.Group,
			Resource:  d.Resource,
			Available: ok,
		})
		available[d.Kind] = ok
	}
	return sources, available
}

// buildTypedTableSnapshot is the shared Build skeleton: parse the (cluster- or
// namespace-scoped) query scope, then serve the query straight from the
// informer-fed maintained store when one is wired (querying it in place,
// O(log N + page)), else list + re-project via collectDescriptorTableRows.
// makePayload constructs the domain's named payload struct so the wire JSON and
// the generated frontend types stay per-domain.
func buildTypedTableSnapshot[T any](
	ctx context.Context,
	scope string,
	spec typedTableDomainSpec[T],
	collectIndexer func(streamspec.Descriptor) cache.Indexer,
	maintained *typedMaintainedStore[T],
	makePayload func(ClusterMeta, ResourceQueryEnvelope, []T) any,
) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), spec.domain, "")
	if err != nil {
		return nil, err
	}

	// rowsScope selects the store/list rows: the parsed namespace for a
	// namespace-scoped domain, all rows ("") for a cluster-scoped one.
	rowsScope := ""
	if spec.scopeRequiredErr != "" {
		parsedScope, scopeErr := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), spec.scopeRequiredErr)
		if scopeErr != nil {
			return nil, scopeErr
		}
		rowsScope = parsedScope.Namespace
	}

	var resolved typedSnapshotPage[T]
	var version uint64
	if maintained != nil {
		sources, available := typedTableSources(ctx, spec.domain, collectIndexer)
		resolved = resolveMaintainedDirect(
			maintained.store,
			query,
			available,
			rowsScope,
			spec.adapter,
			spec.schema,
			capabilitiesWithAvailableKinds(spec.capabilities, sources),
			spec.entryLimit,
			spec.description,
			spec.kindOf,
			func() []T {
				rows := maintained.rows(rowsScope, available)
				spec.sortRows(rows)
				return rows
			},
			typedTableQueryResourceIssues(ctx, spec.domain, query, sources),
		)
		version = maintained.snapshotVersion()
	} else {
		rows, sources, v, listErr := collectDescriptorTableRows[T](ctx, spec.domain, collectIndexer, meta, rowsScope)
		if listErr != nil {
			if spec.listErrorPrefix != "" {
				return nil, fmt.Errorf("%s: %w", spec.listErrorPrefix, listErr)
			}
			return nil, listErr
		}
		version = v
		spec.sortRows(rows)
		resolved = resolveTypedSnapshotPageViaStore(
			spec.domain,
			rows,
			query,
			spec.adapter,
			spec.schema,
			capabilitiesWithAvailableKinds(spec.capabilities, sources),
			spec.entryLimit,
			spec.description,
			spec.kindOf,
			typedTableQueryResourceIssues(ctx, spec.domain, query, sources),
		)
	}

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
		Version: version,
		Payload: makePayload(meta, resolved.Envelope, resolved.Rows),
		Stats:   resolved.Stats,
	}, nil
}

// newRegisteredTypedTableStore wires the shared maintained-store scaffolding every
// typed-table domain's Register performs: build the store, register it with the
// governor for spill/restore/reconcile across Cold/re-warm, feed it from the
// ingest reflectors' Table-half Sinks for the cut kinds, and register informer
// handlers for any uncut kind (gatewayFactory only for domains with Gateway-API
// kinds; ingestManager may be nil in unit tests — the cut kinds then have no feed).
func newRegisteredTypedTableStore[T any](
	reg *domain.Registry,
	spec typedTableDomainSpec[T],
	clusterMeta ClusterMeta,
	collectIndexer func(streamspec.Descriptor) cache.Indexer,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
	ingestManager *ingest.IngestManager,
) (*typedMaintainedStore[T], error) {
	maintained := newTypedMaintainedStore(clusterMeta, spec.schema, spec.adapter)
	reg.RegisterMaintainedStore(spec.domain, maintained)
	feedMaintainedFromIngest(maintained, spec.domain, ingestManager)
	if err := registerMaintainedHandlers(maintained, spec.domain, collectIndexer, factory, gatewayFactory); err != nil {
		return nil, err
	}
	return maintained, nil
}
