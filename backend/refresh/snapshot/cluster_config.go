package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

const clusterConfigDomainName = "cluster-config"

// ClusterConfigBuilder aggregates configuration resources for the cluster tab by
// listing each registered kind (shared- or Gateway-API-factory) from its indexer.
type ClusterConfigBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
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

// RegisterClusterConfigDomain registers the domain with the registry.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
func RegisterClusterConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
) error {
	return RegisterClusterConfigDomainWithGatewayAPI(reg, factory, nil, allowed)
}

func RegisterClusterConfigDomainWithGatewayAPI(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterConfigBuilder{
		collectIndexer: factoryIndexers(factory, gatewayFactory, allowed, clusterConfigDomainName),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build produces the cluster configuration snapshot.
func (b *ClusterConfigBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterConfigDomainName, "")
	if err != nil {
		return nil, err
	}
	return b.buildFromListers(ctx, refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)), query)
}

func (b *ClusterConfigBuilder) buildFromListers(ctx context.Context, scope string, query typedTableQuery) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	entries, sources, version, err := collectDescriptorTableRows[ClusterConfigEntry](ctx, clusterConfigDomainName, b.collectIndexer, meta, "")
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind == entries[j].Kind {
			return entries[i].Name < entries[j].Name
		}
		return entries[i].Kind < entries[j].Kind
	})
	issues := typedTableQueryResourceIssues(ctx, clusterConfigDomainName, query, sources)

	resolved := resolveTypedSnapshotPage(
		clusterConfigDomainName,
		entries,
		query,
		clusterConfigTableQueryAdapter(),
		capabilitiesWithAvailableKinds(clusterConfigQueryCapabilities(), sources),
		config.SnapshotClusterConfigEntryLimit,
		"cluster configuration resources",
		func(entry ClusterConfigEntry) string { return entry.Kind },
		issues,
	)
	// The window snapshot is the canonical unscoped refresh payload; only the
	// query page publishes the request scope.
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = scope
	}
	return &refresh.Snapshot{
		Domain:  clusterConfigDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: ClusterConfigSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
