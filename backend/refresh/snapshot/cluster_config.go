package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	admissionlisters "k8s.io/client-go/listers/admissionregistration/v1"
	networklisters "k8s.io/client-go/listers/networking/v1"
	storagelisters "k8s.io/client-go/listers/storage/v1"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
	gatewaylisters "sigs.k8s.io/gateway-api/pkg/client/listers/apis/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

const clusterConfigDomainName = "cluster-config"

// ClusterConfigBuilder aggregates configuration resources for the cluster tab.
type ClusterConfigBuilder struct {
	storageClassLister      storagelisters.StorageClassLister
	ingressClassLister      networklisters.IngressClassLister
	gatewayClassLister      gatewaylisters.GatewayClassLister
	validatingWebhookLister admissionlisters.ValidatingWebhookConfigurationLister
	mutatingWebhookLister   admissionlisters.MutatingWebhookConfigurationLister
	perms                   ClusterConfigPermissions
}

// ClusterConfigPermissions indicates which resources should be included in the domain.
type ClusterConfigPermissions struct {
	IncludeStorageClasses     bool
	IncludeIngressClasses     bool
	IncludeGatewayClasses     bool
	IncludeValidatingWebhooks bool
	IncludeMutatingWebhooks   bool
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
		[]string{"StorageClass", "IngressClass", "GatewayClass", "MutatingWebhookConfiguration", "ValidatingWebhookConfiguration"},
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
	perms ClusterConfigPermissions,
) error {
	return RegisterClusterConfigDomainWithGatewayAPI(reg, factory, nil, perms)
}

func RegisterClusterConfigDomainWithGatewayAPI(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
	perms ClusterConfigPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterConfigBuilder{
		storageClassLister:      nil,
		ingressClassLister:      nil,
		gatewayClassLister:      nil,
		validatingWebhookLister: nil,
		mutatingWebhookLister:   nil,
	}
	if perms.IncludeStorageClasses {
		builder.storageClassLister = factory.Storage().V1().StorageClasses().Lister()
	}
	if perms.IncludeIngressClasses {
		builder.ingressClassLister = factory.Networking().V1().IngressClasses().Lister()
	}
	if perms.IncludeGatewayClasses && gatewayFactory != nil {
		builder.gatewayClassLister = gatewayFactory.Gateway().V1().GatewayClasses().Lister()
	}
	if perms.IncludeValidatingWebhooks {
		builder.validatingWebhookLister = factory.Admissionregistration().V1().ValidatingWebhookConfigurations().Lister()
	}
	if perms.IncludeMutatingWebhooks {
		builder.mutatingWebhookLister = factory.Admissionregistration().V1().MutatingWebhookConfigurations().Lister()
	}
	builder.perms = perms
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
	collectors := []kindCollector[ClusterConfigEntry]{
		newStorageClassCollector(b.storageClassLister),
		newIngressClassCollector(b.ingressClassLister),
		newGatewayClassCollector(b.gatewayClassLister),
		newValidatingWebhookCollector(b.validatingWebhookLister),
		newMutatingWebhookCollector(b.mutatingWebhookLister),
	}
	entries, sources, version, err := collectDomainRows(ctx, clusterConfigDomainName, collectors, meta, "")
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

func newStorageClassCollector(lister storagelisters.StorageClassLister) kindCollector[ClusterConfigEntry] {
	collector := kindCollector[ClusterConfigEntry]{kind: "StorageClass", group: "storage.k8s.io", resource: "storageclasses", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, _ string) ([]ClusterConfigEntry, uint64, error) {
			items, err := lister.List(labels.Everything())
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ClusterConfigEntry, 0, len(items))
			var version uint64
			for _, sc := range items {
				if sc == nil {
					continue
				}
				rows = append(rows, storageclass.BuildStreamSummary(meta, sc))
				if v := resourceVersionOrTimestamp(sc); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newIngressClassCollector(lister networklisters.IngressClassLister) kindCollector[ClusterConfigEntry] {
	collector := kindCollector[ClusterConfigEntry]{kind: "IngressClass", group: "networking.k8s.io", resource: "ingressclasses", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, _ string) ([]ClusterConfigEntry, uint64, error) {
			items, err := lister.List(labels.Everything())
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ClusterConfigEntry, 0, len(items))
			var version uint64
			for _, ic := range items {
				if ic == nil {
					continue
				}
				rows = append(rows, ingressclass.BuildStreamSummary(meta, ic))
				if v := resourceVersionOrTimestamp(ic); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newGatewayClassCollector(lister gatewaylisters.GatewayClassLister) kindCollector[ClusterConfigEntry] {
	collector := kindCollector[ClusterConfigEntry]{kind: "GatewayClass", group: "gateway.networking.k8s.io", resource: "gatewayclasses", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, _ string) ([]ClusterConfigEntry, uint64, error) {
			items, err := lister.List(labels.Everything())
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ClusterConfigEntry, 0, len(items))
			var version uint64
			for _, gc := range items {
				if gc == nil {
					continue
				}
				rows = append(rows, gatewayclass.BuildStreamSummary(meta, gc))
				if v := resourceVersionOrTimestamp(gc); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newValidatingWebhookCollector(lister admissionlisters.ValidatingWebhookConfigurationLister) kindCollector[ClusterConfigEntry] {
	collector := kindCollector[ClusterConfigEntry]{kind: "ValidatingWebhookConfiguration", group: "admissionregistration.k8s.io", resource: "validatingwebhookconfigurations", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, _ string) ([]ClusterConfigEntry, uint64, error) {
			items, err := lister.List(labels.Everything())
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ClusterConfigEntry, 0, len(items))
			var version uint64
			for _, webhook := range items {
				if webhook == nil {
					continue
				}
				rows = append(rows, admission.BuildValidatingStreamSummary(meta, webhook))
				if v := resourceVersionOrTimestamp(webhook); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newMutatingWebhookCollector(lister admissionlisters.MutatingWebhookConfigurationLister) kindCollector[ClusterConfigEntry] {
	collector := kindCollector[ClusterConfigEntry]{kind: "MutatingWebhookConfiguration", group: "admissionregistration.k8s.io", resource: "mutatingwebhookconfigurations", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, _ string) ([]ClusterConfigEntry, uint64, error) {
			items, err := lister.List(labels.Everything())
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ClusterConfigEntry, 0, len(items))
			var version uint64
			for _, webhook := range items {
				if webhook == nil {
					continue
				}
				rows = append(rows, admission.BuildMutatingStreamSummary(meta, webhook))
				if v := resourceVersionOrTimestamp(webhook); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}
