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

// NamespaceConfigBuilder constructs config summaries for a namespace.
type NamespaceConfigBuilder struct {
	configMaps corelisters.ConfigMapLister
	secrets    corelisters.SecretLister
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

// ConfigSummary describes a ConfigMap or Secret entry.
type ConfigSummary struct {
	ClusterMeta
	Kind         string `json:"kind"`
	TypeAlias    string `json:"typeAlias,omitempty"`
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Data         int    `json:"data"`
	Age          string `json:"age"`
	AgeTimestamp int64  `json:"ageTimestamp,omitempty"`
}

// RegisterNamespaceConfigDomain registers the namespace config domain.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
func RegisterNamespaceConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	perms NamespaceConfigPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceConfigBuilder{}
	if perms.IncludeConfigMaps {
		builder.configMaps = factory.Core().V1().ConfigMaps().Lister()
	}
	if perms.IncludeSecrets {
		builder.secrets = factory.Core().V1().Secrets().Lister()
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles ConfigMap and Secret summaries for a namespace scope.
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

	configMapsAvailable := b.configMaps != nil && runtimeResourceAllowed(ctx, namespaceConfigDomainName, "", "configmaps")
	var configMaps []*corev1.ConfigMap
	if configMapsAvailable {
		configMaps, err = b.listConfigMaps(parsedScope.Namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace config: failed to list configmaps: %w", err)
		}
	}

	secretsAvailable := b.secrets != nil && runtimeResourceAllowed(ctx, namespaceConfigDomainName, "", "secrets")
	var secrets []*corev1.Secret
	if secretsAvailable {
		secrets, err = b.listSecrets(parsedScope.Namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace config: failed to list secrets: %w", err)
		}
	}

	sources := []typedTableResourceSource{
		{Kind: "ConfigMap", Group: "", Resource: "configmaps", Available: configMapsAvailable},
		{Kind: "Secret", Group: "", Resource: "secrets", Available: secretsAvailable},
	}
	issues := typedTableQueryResourceIssues(ctx, namespaceConfigDomainName, query, sources)
	return b.buildSnapshot(meta, refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)), query, configMaps, secrets, issues, capabilitiesWithAvailableKinds(namespaceConfigQueryCapabilities(), sources))
}

func (b *NamespaceConfigBuilder) listConfigMaps(namespace string) ([]*corev1.ConfigMap, error) {
	if namespace == "" {
		return b.configMaps.List(labels.Everything())
	}
	return b.configMaps.ConfigMaps(namespace).List(labels.Everything())
}

func (b *NamespaceConfigBuilder) listSecrets(namespace string) ([]*corev1.Secret, error) {
	if namespace == "" {
		return b.secrets.List(labels.Everything())
	}
	return b.secrets.Secrets(namespace).List(labels.Everything())
}

func (b *NamespaceConfigBuilder) buildSnapshot(
	meta ClusterMeta,
	scope string,
	query typedTableQuery,
	configMaps []*corev1.ConfigMap,
	secrets []*corev1.Secret,
	issues []ResourceQueryIssue,
	capabilities ResourceQueryCapabilities,
) (*refresh.Snapshot, error) {
	resources := make([]ConfigSummary, 0, len(configMaps)+len(secrets))
	var version uint64

	for _, cm := range configMaps {
		if cm == nil {
			continue
		}
		// Delegate to the shared row builder so the full-snapshot path
		// and the streaming/incremental update path emit identical row
		// shapes. See BuildConfigMapSummary in streaming_helpers.go.
		resources = append(resources, BuildConfigMapSummary(meta, cm))
		if v := resourceVersionOrTimestamp(cm); v > version {
			version = v
		}
	}

	for _, secret := range secrets {
		if secret == nil {
			continue
		}
		resources = append(resources, BuildSecretSummary(meta, secret))
		if v := resourceVersionOrTimestamp(secret); v > version {
			version = v
		}
	}

	sortConfigSummaries(resources)

	resolved := resolveTypedSnapshotPage(
		namespaceConfigDomainName,
		resources,
		query,
		configTableQueryAdapter(),
		capabilities,
		config.SnapshotNamespaceConfigEntryLimit,
		"config resources",
		func(resource ConfigSummary) string { return resource.Kind },
		issues,
	)
	return &refresh.Snapshot{
		Domain:  namespaceConfigDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceConfigSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

func secretTypeAlias(secret *corev1.Secret) string {
	if secret == nil {
		return ""
	}
	switch secret.Type {
	case corev1.SecretTypeTLS:
		return "TLS"
	case corev1.SecretTypeServiceAccountToken:
		return "SA"
	case corev1.SecretTypeDockercfg, corev1.SecretTypeDockerConfigJson:
		return "Docker"
	case corev1.SecretTypeBasicAuth:
		return "Auth"
	case corev1.SecretTypeOpaque:
		return "Opaque"
	default:
		return string(secret.Type)
	}
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
