package snapshot

import (
	"context"
	"fmt"
	"sort"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

const clusterConfigDomainName = "cluster-config"

// ClusterConfigBuilder aggregates configuration resources for the cluster tab via
// the shared typed-table domain skeleton (typed_table_domain.go).
type ClusterConfigBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[ClusterConfigEntry]
}

// clusterConfigQuerypageSchema derives the querypage Schema for the cluster config
// table from the existing typed-table adapter, via the shared generic schema builder.
// It REUSES the adapter's exact comparable sort-value encoder and row key, so the
// querypage engine orders rows byte-identically to the live typed-table executor.
func clusterConfigQuerypageSchema() querypage.Schema[ClusterConfigEntry] {
	return querypageSchemaFromAdapter(clusterConfigTableQueryAdapter(), []string{"name", "kind", "details", "age"})
}

// ClusterConfigSnapshot represents the payload exposed to the UI. It embeds the
// canonical ResourceQueryEnvelope (flattened into top-level JSON) plus the
// domain-typed rows.
type ClusterConfigSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterConfigEntry `json:"rows"`
}

func clusterConfigQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "details", "age"},
		[]string{"kinds"},
		[]string{"kind", "name", "details"},
		[]string{storageclass.Identity.Kind, ingressclass.Identity.Kind, gatewayclass.Identity.Kind, admission.MutatingIdentity.Kind, admission.ValidatingIdentity.Kind},
	)
}

// ClusterConfigEntry covers a storage class, ingress class, or webhook config.
// The type lives in the streamrows leaf so the kind packages can build it; this
// alias keeps the snapshot-side name and wire JSON unchanged.
type ClusterConfigEntry = streamrows.ClusterConfigEntry

func clusterConfigDomainSpec() typedTableDomainSpec[ClusterConfigEntry] {
	return typedTableDomainSpec[ClusterConfigEntry]{
		domain:       clusterConfigDomainName,
		entryLimit:   config.SnapshotClusterConfigEntryLimit,
		description:  "cluster configuration resources",
		adapter:      clusterConfigTableQueryAdapter(),
		schema:       clusterConfigQuerypageSchema(),
		capabilities: clusterConfigQueryCapabilities(),
		kindOf:       func(entry ClusterConfigEntry) string { return entry.Kind },
		sortRows:     sortClusterConfigEntries,
	}
}

func sortClusterConfigEntries(entries []ClusterConfigEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind == entries[j].Kind {
			return entries[i].Name < entries[j].Name
		}
		return entries[i].Kind < entries[j].Kind
	})
}

// RegisterClusterConfigDomainWithGatewayAPI registers the cluster-config domain.
//
// This domain is MIXED: StorageClass, IngressClass, and the admission webhook kinds
// are owned-reflector ingest kinds (IngestOwned), fed from the ingest reflectors'
// Table-half Sink; GatewayClass is NOT cut and is still fed from the Gateway-API
// informer via registerMaintainedHandlers (which skips the ingest-owned kinds). When
// ingestManager is nil (a unit test) the cut kinds have no feed.
func RegisterClusterConfigDomainWithGatewayAPI(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := factoryIndexers(factory, gatewayFactory, allowed, clusterConfigDomainName, ingestManager)
	maintained, err := newRegisteredTypedTableStore(reg, clusterConfigDomainSpec(), clusterMeta, collectIndexer, factory, gatewayFactory, ingestManager)
	if err != nil {
		return err
	}

	builder := &ClusterConfigBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build produces the cluster configuration snapshot.
func (b *ClusterConfigBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, clusterConfigDomainSpec(), b.collectIndexer, b.maintained,
		func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []ClusterConfigEntry) any {
			return ClusterConfigSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		})
}
