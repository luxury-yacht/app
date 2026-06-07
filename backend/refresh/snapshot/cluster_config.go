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
	)
}

// ClusterConfigEntry covers a storage class, ingress class, or webhook config.
type ClusterConfigEntry struct {
	ClusterMeta
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Details      string `json:"details"`
	IsDefault    bool   `json:"isDefault,omitempty"`
	Age          string `json:"age"`
	AgeTimestamp int64  `json:"ageTimestamp,omitempty"`
}

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
	var version uint64
	entries := make([]ClusterConfigEntry, 0, 64)
	storageClassesAvailable := b.storageClassLister != nil && runtimeResourceAllowed(ctx, clusterConfigDomainName, "storage.k8s.io", "storageclasses")
	ingressClassesAvailable := b.ingressClassLister != nil && runtimeResourceAllowed(ctx, clusterConfigDomainName, "networking.k8s.io", "ingressclasses")
	gatewayClassesAvailable := b.gatewayClassLister != nil && runtimeResourceAllowed(ctx, clusterConfigDomainName, "gateway.networking.k8s.io", "gatewayclasses")
	validatingWebhooksAvailable := b.validatingWebhookLister != nil && runtimeResourceAllowed(ctx, clusterConfigDomainName, "admissionregistration.k8s.io", "validatingwebhookconfigurations")
	mutatingWebhooksAvailable := b.mutatingWebhookLister != nil && runtimeResourceAllowed(ctx, clusterConfigDomainName, "admissionregistration.k8s.io", "mutatingwebhookconfigurations")

	if storageClassesAvailable {
		storageClasses, err := b.storageClassLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		// Delegate to the shared row builders so the full-snapshot path
		// and the streaming/incremental update path emit identical row
		// shapes. See BuildClusterStorageClassSummary /
		// BuildClusterIngressClassSummary /
		// BuildClusterValidatingWebhookSummary /
		// BuildClusterMutatingWebhookSummary in streaming_helpers.go.
		for _, sc := range storageClasses {
			if sc == nil {
				continue
			}
			entries = append(entries, BuildClusterStorageClassSummary(meta, sc))
			if v := resourceVersionOrTimestamp(sc); v > version {
				version = v
			}
		}
	}

	if ingressClassesAvailable {
		ingressClasses, err := b.ingressClassLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		for _, ic := range ingressClasses {
			if ic == nil {
				continue
			}
			entries = append(entries, BuildClusterIngressClassSummary(meta, ic))
			if v := resourceVersionOrTimestamp(ic); v > version {
				version = v
			}
		}
	}

	if gatewayClassesAvailable {
		gatewayClasses, err := b.gatewayClassLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		for _, gc := range gatewayClasses {
			if gc == nil {
				continue
			}
			entries = append(entries, BuildClusterGatewayClassSummary(meta, gc))
			if v := resourceVersionOrTimestamp(gc); v > version {
				version = v
			}
		}
	}

	if validatingWebhooksAvailable {
		validatingWebhooks, err := b.validatingWebhookLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		for _, webhook := range validatingWebhooks {
			if webhook == nil {
				continue
			}
			entries = append(entries, BuildClusterValidatingWebhookSummary(meta, webhook))
			if v := resourceVersionOrTimestamp(webhook); v > version {
				version = v
			}
		}
	}

	if mutatingWebhooksAvailable {
		mutatingWebhooks, err := b.mutatingWebhookLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		for _, webhook := range mutatingWebhooks {
			if webhook == nil {
				continue
			}
			entries = append(entries, BuildClusterMutatingWebhookSummary(meta, webhook))
			if v := resourceVersionOrTimestamp(webhook); v > version {
				version = v
			}
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind == entries[j].Kind {
			return entries[i].Name < entries[j].Name
		}
		return entries[i].Kind < entries[j].Kind
	})
	issues := typedTableQueryResourceIssues(ctx, clusterConfigDomainName, query, []typedTableResourceSource{
		{Kind: "StorageClass", Group: "storage.k8s.io", Resource: "storageclasses", Available: storageClassesAvailable},
		{Kind: "IngressClass", Group: "networking.k8s.io", Resource: "ingressclasses", Available: ingressClassesAvailable},
		{Kind: "GatewayClass", Group: "gateway.networking.k8s.io", Resource: "gatewayclasses", Available: gatewayClassesAvailable},
		{Kind: "ValidatingWebhookConfiguration", Group: "admissionregistration.k8s.io", Resource: "validatingwebhookconfigurations", Available: validatingWebhooksAvailable},
		{Kind: "MutatingWebhookConfiguration", Group: "admissionregistration.k8s.io", Resource: "mutatingwebhookconfigurations", Available: mutatingWebhooksAvailable},
	})

	if query.Enabled {
		page := applyTypedTableQuery(entries, query, clusterConfigTableQueryAdapter())
		exact := len(issues) == 0
		return &refresh.Snapshot{
			Domain:  clusterConfigDomainName,
			Scope:   scope,
			Version: version,
			Payload: ClusterConfigSnapshot{
				ClusterMeta:           meta,
				ResourceQueryEnvelope: typedQueryEnvelope(clusterConfigDomainName, page, clusterConfigQueryCapabilities()).withDegraded(exact, issues),
				Rows:                  page.Rows,
			},
			Stats: refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}, nil
	}

	var totalItems int
	entries, totalItems = truncateSnapshotWindow(entries, config.SnapshotClusterConfigEntryLimit)

	return &refresh.Snapshot{
		Domain:  clusterConfigDomainName,
		Version: version,
		Payload: ClusterConfigSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: typedWindowEnvelope(clusterConfigDomainName, totalItems, totalItems == len(entries) && len(issues) == 0, snapshotSortedKinds(entries, func(entry ClusterConfigEntry) string { return entry.Kind }), clusterConfigQueryCapabilities()).withIssues(issues),
			Rows:                  entries,
		},
		Stats: snapshotWindowStats(len(entries), totalItems, "cluster configuration resources"),
	}, nil
}

func isDefaultClass(annotations map[string]string) bool {
	if len(annotations) == 0 {
		return false
	}
	keys := []string{
		"storageclass.kubernetes.io/is-default-class",
		"storageclass.beta.kubernetes.io/is-default-class",
		"ingressclass.kubernetes.io/is-default-class",
	}
	for _, key := range keys {
		if strings.EqualFold(annotations[key], "true") {
			return true
		}
	}
	return false
}
