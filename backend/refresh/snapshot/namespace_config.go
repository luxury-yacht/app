package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
)

const (
	namespaceConfigDomainName       = "namespace-config"
	errNamespaceConfigScopeRequired = "namespace scope is required"
)

// NamespaceConfigPermissions indicates which resources should be included in the domain.
type NamespaceConfigPermissions struct {
	IncludeConfigMaps bool
	IncludeSecrets    bool
}

// NamespaceConfigBuilder constructs config summaries for a namespace. Each kind
// it serves (ConfigMap, Secret) contributes a collector that calls the kind
// package's stream-summary builder; Build loops them via collectDomainRows.
type NamespaceConfigBuilder struct {
	collectors []kindCollector[ConfigSummary]
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
		[]string{"ConfigMap", "Secret"},
	)
}

// ConfigSummary describes a ConfigMap or Secret entry. The type lives in the
// streamrows leaf so the kind packages can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type ConfigSummary = streamrows.ConfigSummary

// RegisterNamespaceConfigDomain registers the namespace config domain.
// Only listers for permitted resources are wired; denied resources contribute a
// collector with available=false so they still appear in the source list (for
// query capabilities/issues) but are not listed.
func RegisterNamespaceConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	perms NamespaceConfigPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	var configMaps corelisters.ConfigMapLister
	if perms.IncludeConfigMaps {
		configMaps = factory.Core().V1().ConfigMaps().Lister()
	}
	var secrets corelisters.SecretLister
	if perms.IncludeSecrets {
		secrets = factory.Core().V1().Secrets().Lister()
	}
	builder := &NamespaceConfigBuilder{
		collectors: []kindCollector[ConfigSummary]{
			newConfigMapCollector(configMaps),
			newSecretCollector(secrets),
		},
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// newConfigMapCollector returns the ConfigMap collector. A nil lister marks the
// kind unavailable (denied): it still appears in the source list but is not listed.
func newConfigMapCollector(lister corelisters.ConfigMapLister) kindCollector[ConfigSummary] {
	collector := kindCollector[ConfigSummary]{kind: "ConfigMap", group: "", resource: "configmaps", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, namespace string) ([]ConfigSummary, uint64, error) {
			items, err := listConfigMaps(lister, namespace)
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ConfigSummary, 0, len(items))
			var version uint64
			for _, cm := range items {
				if cm == nil {
					continue
				}
				rows = append(rows, configmap.BuildStreamSummary(meta, cm))
				if v := resourceVersionOrTimestamp(cm); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

// newSecretCollector returns the Secret collector. A nil lister marks the kind
// unavailable (denied): it still appears in the source list but is not listed.
func newSecretCollector(lister corelisters.SecretLister) kindCollector[ConfigSummary] {
	collector := kindCollector[ConfigSummary]{kind: "Secret", group: "", resource: "secrets", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, namespace string) ([]ConfigSummary, uint64, error) {
			items, err := listSecrets(lister, namespace)
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ConfigSummary, 0, len(items))
			var version uint64
			for _, sec := range items {
				if sec == nil {
					continue
				}
				rows = append(rows, secretpkg.BuildStreamSummary(meta, sec))
				if v := resourceVersionOrTimestamp(sec); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func listConfigMaps(lister corelisters.ConfigMapLister, namespace string) ([]*corev1.ConfigMap, error) {
	if namespace == "" {
		return lister.List(labels.Everything())
	}
	return lister.ConfigMaps(namespace).List(labels.Everything())
}

func listSecrets(lister corelisters.SecretLister, namespace string) ([]*corev1.Secret, error) {
	if namespace == "" {
		return lister.List(labels.Everything())
	}
	return lister.Secrets(namespace).List(labels.Everything())
}

// Build assembles the namespace-config rows by looping the kind collectors.
func (b *NamespaceConfigBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceConfigDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceConfigScopeRequired)
	if err != nil {
		return nil, err
	}

	resources, sources, version, err := collectDomainRows(ctx, namespaceConfigDomainName, b.collectors, meta, parsedScope.Namespace)
	if err != nil {
		return nil, err
	}

	sortConfigSummaries(resources)

	issues := typedTableQueryResourceIssues(ctx, namespaceConfigDomainName, query, sources)
	resolved := resolveTypedSnapshotPage(
		namespaceConfigDomainName,
		resources,
		query,
		configTableQueryAdapter(),
		capabilitiesWithAvailableKinds(namespaceConfigQueryCapabilities(), sources),
		config.SnapshotNamespaceConfigEntryLimit,
		"config resources",
		func(resource ConfigSummary) string { return resource.Kind },
		issues,
	)
	return &refresh.Snapshot{
		Domain:  namespaceConfigDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceConfigSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
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
