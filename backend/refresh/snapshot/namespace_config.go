package snapshot

import (
	"context"
	"fmt"
	"sort"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/secret"
)

const (
	namespaceConfigDomainName       = "namespace-config"
	errNamespaceConfigScopeRequired = "namespace scope is required"
)

// NamespaceConfigBuilder constructs config summaries (ConfigMap, Secret) for a
// namespace via the shared typed-table domain skeleton (typed_table_domain.go).
type NamespaceConfigBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[ConfigSummary]
}

// NamespaceConfigSnapshot payload returned to the frontend. It embeds the
// canonical ResourceQueryEnvelope (flattened into top-level JSON) plus the
// domain-typed rows.
type NamespaceConfigSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ConfigSummary `json:"rows"`
}

func namespaceConfigQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "data", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "typeAlias", "name", "namespace", "data"},
		[]string{configmap.Identity.Kind, secret.Identity.Kind},
	)
}

// ConfigSummary describes a ConfigMap or Secret entry. The type lives in the
// streamrows leaf so the kind packages can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type ConfigSummary = streamrows.ConfigSummary

func namespaceConfigDomainSpec() typedTableDomainSpec[ConfigSummary] {
	return typedTableDomainSpec[ConfigSummary]{
		domain:           namespaceConfigDomainName,
		scopeRequiredErr: errNamespaceConfigScopeRequired,
		entryLimit:       config.SnapshotNamespaceConfigEntryLimit,
		description:      "config resources",
		adapter:          configTableQueryAdapter(),
		schema:           configQuerypageSchema(),
		capabilities:     namespaceConfigQueryCapabilities(),
		kindOf:           func(resource ConfigSummary) string { return resource.Kind },
		sortRows:         sortConfigSummaries,
	}
}

// RegisterNamespaceConfigDomain registers the namespace config domain.
// Only indexers for permitted resources are wired; denied resources are skipped
// so they still appear in the source list (for query capabilities/issues) but
// are not listed.
//
// ConfigMap and Secret are owned-reflector ingest kinds (IngestOwned): when
// ingestManager is non-nil their maintained-store feed comes from the ingest
// reflectors' Table-half Sink and registerMaintainedHandlers skips them (the shared
// factory no longer caches them). When ingestManager is nil (a unit test) the store
// has no feed for the cut kinds.
func RegisterNamespaceConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := sharedFactoryIndexers(factory, allowed, namespaceConfigDomainName, ingestManager)
	maintained, err := newRegisteredTypedTableStore(reg, namespaceConfigDomainSpec(), clusterMeta, collectIndexer, factory, nil, ingestManager)
	if err != nil {
		return err
	}

	builder := &NamespaceConfigBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles the namespace-config rows. The query branch is served through
// the querypage engine (proven byte-equivalent to the bespoke typed-table
// executor in querypage_config_test.go).
func (b *NamespaceConfigBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, namespaceConfigDomainSpec(), b.collectIndexer, b.maintained,
		func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []ConfigSummary) any {
			return NamespaceConfigSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		})
}

func sortConfigSummaries(resources []ConfigSummary) {
	sort.SliceStable(resources, func(i, j int) bool {
		if resources[i].Namespace != resources[j].Namespace {
			return resources[i].Namespace < resources[j].Namespace
		}
		if resources[i].Name != resources[j].Name {
			return resources[i].Name < resources[j].Name
		}
		if resources[i].Kind != resources[j].Kind {
			return resources[i].Kind < resources[j].Kind
		}
		return resources[i].TypeAlias < resources[j].TypeAlias
	})
}
