package snapshot

import (
	"context"
	"fmt"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
)

// Test feeds for the typed-table and Events domains. Tests describe a cluster as
// per-kind indexers of typed objects; production builders serve from maintained
// stores their reflectors fill, so these helpers fill the store through each
// kind's StreamRow, the projection its reflector applies at intake.

// emptyIndexer stands for a served kind with no objects.
var emptyIndexer = cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})

// availableFromIndexers reports a kind available when the test supplies an
// indexer for it, as registration does when a kind is permitted and served.
func availableFromIndexers(indexerFor func(streamspec.Descriptor) cache.Indexer) kindAvailability {
	return func(d streamspec.Descriptor) bool { return indexerFor(d) != nil }
}

// maintainedFromIndexers fills a domain's maintained store from the test
// indexers through each descriptor's StreamRow.
func maintainedFromIndexers[T any](meta ClusterMeta, spec typedTableDomainSpec[T], indexerFor func(streamspec.Descriptor) cache.Indexer) *typedMaintainedStore[T] {
	maintained := newTypedMaintainedStore(meta, spec.schema, spec.adapter)
	for _, d := range kindregistry.StreamDescriptorsForDomain(spec.domain) {
		indexer := indexerFor(d)
		if indexer == nil {
			continue
		}
		for _, obj := range indexer.List() {
			maintained.ingest(d, obj)
		}
	}
	return maintained
}

func clusterCRDBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *ClusterCRDBuilder {
	return &ClusterCRDBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, clusterCRDDomainSpec(), indexerFor)}
}

func clusterConfigBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *ClusterConfigBuilder {
	return &ClusterConfigBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, clusterConfigDomainSpec(), indexerFor)}
}

func clusterRBACBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *ClusterRBACBuilder {
	return &ClusterRBACBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, clusterRBACDomainSpec(), indexerFor)}
}

func clusterStorageBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *ClusterStorageBuilder {
	return &ClusterStorageBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, clusterStorageDomainSpec(), indexerFor)}
}

func namespaceConfigBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *NamespaceConfigBuilder {
	return &NamespaceConfigBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, namespaceConfigDomainSpec(), indexerFor)}
}

func namespaceAutoscalingBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *NamespaceAutoscalingBuilder {
	return &NamespaceAutoscalingBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, namespaceAutoscalingDomainSpec(), indexerFor)}
}

func namespaceQuotasBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *NamespaceQuotasBuilder {
	return &NamespaceQuotasBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, namespaceQuotasDomainSpec(), indexerFor)}
}

func namespaceStorageBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *NamespaceStorageBuilder {
	return &NamespaceStorageBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, namespaceStorageDomainSpec(), indexerFor)}
}

func namespaceRBACBuilderFor(meta ClusterMeta, indexerFor func(streamspec.Descriptor) cache.Indexer) *NamespaceRBACBuilder {
	return &NamespaceRBACBuilder{available: availableFromIndexers(indexerFor), maintained: maintainedFromIndexers(meta, namespaceRBACDomainSpec(), indexerFor)}
}

// clusterEventsBuilderFor serves the Cluster Events table from a store its
// events sink filled, as the owned reflector's initial list does.
func clusterEventsBuilderFor(t testing.TB, meta ClusterMeta, events ...*corev1.Event) *ClusterEventsBuilder {
	t.Helper()
	maintained := newTypedMaintainedStore(meta, clusterEventsQuerypageSchema(), clusterEventTableQueryAdapter())
	feedEventTable(t, meta, maintained, clusterEventEntry, func(row ClusterEventEntry) EventSummary { return EventSummary(row) }, events...)
	return &ClusterEventsBuilder{maintained: maintained}
}

// namespaceEventsBuilderFor serves the Namespace Events table from a store its
// events sink filled.
func namespaceEventsBuilderFor(t testing.TB, meta ClusterMeta, events ...*corev1.Event) *NamespaceEventsBuilder {
	t.Helper()
	maintained := newTypedMaintainedStore(meta, namespaceEventsQuerypageSchema(), namespacedEventTableQueryAdapter())
	feedEventTable(t, meta, maintained, namespaceEventSummary, func(row EventSummary) EventSummary { return row }, events...)
	return &NamespaceEventsBuilder{maintained: maintained}
}

// clusterEventsProjectedBuilder fills the Cluster Events store by projecting each
// Event directly, bypassing the events sink: the reference a sink-fed store must
// match.
func clusterEventsProjectedBuilder(meta ClusterMeta, events ...*corev1.Event) *ClusterEventsBuilder {
	maintained := newTypedMaintainedStore(meta, clusterEventsQuerypageSchema(), clusterEventTableQueryAdapter())
	for _, event := range events {
		if row, ok := projectClusterEventEntry(meta, event); ok {
			maintained.upsertRow(row, event)
		}
	}
	return &ClusterEventsBuilder{maintained: maintained}
}

// namespaceEventsProjectedBuilder is clusterEventsProjectedBuilder for the
// Namespace Events table.
func namespaceEventsProjectedBuilder(meta ClusterMeta, events ...*corev1.Event) *NamespaceEventsBuilder {
	maintained := newTypedMaintainedStore(meta, namespaceEventsQuerypageSchema(), namespacedEventTableQueryAdapter())
	for _, event := range events {
		if row, ok := projectNamespaceEventSummary(meta, event); ok {
			maintained.upsertRow(row, event)
		}
	}
	return &NamespaceEventsBuilder{maintained: maintained}
}

// projectClusterEventEntry projects an Event straight into a Cluster Events row,
// or reports ok=false when the table does not serve it.
func projectClusterEventEntry(meta ClusterMeta, event *corev1.Event) (ClusterEventEntry, bool) {
	if event == nil {
		return ClusterEventEntry{}, false
	}
	return clusterEventEntry(projectEventRow(meta, event))
}

// projectNamespaceEventSummary projects an Event straight into a Namespace
// Events row, or reports ok=false when the table does not serve it.
func projectNamespaceEventSummary(meta ClusterMeta, event *corev1.Event) (EventSummary, bool) {
	if event == nil {
		return EventSummary{}, false
	}
	return namespaceEventSummary(projectEventRow(meta, event))
}

// typedTableListOracle builds a typed table the way the removed list path did:
// list each permitted kind from the test indexers, project rows with the
// descriptor's StreamRow, and resolve the page with the per-build store engine.
// Oracle tests compare a maintained store's direct query against it.
type typedTableListOracle[T any] struct {
	spec       typedTableDomainSpec[T]
	indexerFor func(streamspec.Descriptor) cache.Indexer
}

func newTypedTableListOracle[T any](spec typedTableDomainSpec[T], indexerFor func(streamspec.Descriptor) cache.Indexer) typedTableListOracle[T] {
	return typedTableListOracle[T]{spec: spec, indexerFor: indexerFor}
}

func (o typedTableListOracle[T]) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	spec := o.spec
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), spec.domain, "")
	if err != nil {
		return nil, err
	}
	rowsScope := ""
	if spec.scopeRequiredErr != "" {
		parsedScope, scopeErr := parseNamespaceSnapshotScope(spec.domain, clusterID, baseScope, spec.scopeRequiredErr)
		if scopeErr != nil {
			return nil, scopeErr
		}
		rowsScope = parsedScope.Namespace
	}
	rows, sources, version, err := o.rows(ctx, meta, rowsScope)
	if err != nil {
		return nil, err
	}
	spec.sortRows(rows)
	resolved := resolveTypedSnapshotPageViaStore(
		spec.domain, rows, query, spec.adapter, spec.schema,
		newTypedSnapshotPageConfig(
			capabilitiesWithAvailableKinds(spec.capabilities, sources),
			spec.entryLimit,
			spec.description,
			spec.adapter.Kind,
			typedTableQueryResourceIssues(ctx, spec.domain, query, sources),
		),
	)
	snapshotScope := refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	if spec.scopeRequiredErr == "" && !query.Enabled {
		snapshotScope = ""
	}
	return &refresh.Snapshot{
		Domain:  spec.domain,
		Scope:   snapshotScope,
		Version: version,
		Payload: spec.payload(meta, resolved.Envelope, resolved.Rows),
		Stats:   resolved.Stats,
	}, nil
}

func (o typedTableListOracle[T]) rows(ctx context.Context, meta ClusterMeta, namespace string) ([]T, []typedTableResourceSource, uint64, error) {
	return collectDescriptorTableRows[T](ctx, o.spec.domain, o.indexerFor, meta, namespace)
}

// collectDescriptorTableRows lists every descriptor registered for the domain from
// the test indexers, gates each on the request's runtime permission, and projects
// each object into the domain's Row type via the descriptor's StreamRow closure.
// Cluster-scoped kinds (namespace "") list the whole indexer; namespaced scopes use
// the namespace index.
func collectDescriptorTableRows[Row any](
	ctx context.Context,
	domainName string,
	indexerFor func(streamspec.Descriptor) cache.Indexer,
	meta ClusterMeta,
	namespace string,
) ([]Row, []typedTableResourceSource, uint64, error) {
	rows := make([]Row, 0)
	sources := collectDescriptorSources(ctx, domainName, availableFromIndexers(indexerFor))
	descriptors := kindregistry.StreamDescriptorsForDomain(domainName)
	var version uint64
	for i, d := range descriptors {
		if !sources[i].State.servesRows() {
			continue
		}
		objects, err := descriptorObjects(indexerFor(d), namespace)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("%s: failed to list %s: %w", domainName, d.Resource, err)
		}
		descriptorRows, descriptorVersion := projectDescriptorRows[Row](d, meta, objects)
		rows = append(rows, descriptorRows...)
		if descriptorVersion > version {
			version = descriptorVersion
		}
	}
	return rows, sources, version, nil
}

func descriptorObjects(indexer cache.Indexer, namespace string) ([]interface{}, error) {
	if namespace == "" {
		return indexer.List(), nil
	}
	return indexer.ByIndex(cache.NamespaceIndex, namespace)
}

func projectDescriptorRows[Row any](descriptor streamspec.Descriptor, meta ClusterMeta, objects []interface{}) ([]Row, uint64) {
	rows := make([]Row, 0, len(objects))
	var version uint64
	for _, object := range objects {
		item, ok := object.(metav1.Object)
		if !ok {
			continue
		}
		row, ok := descriptor.StreamRow(meta, item).(Row)
		if !ok {
			continue
		}
		rows = append(rows, row)
		if itemVersion := resourceVersionOrTimestamp(item); itemVersion > version {
			version = itemVersion
		}
	}
	return rows, version
}
