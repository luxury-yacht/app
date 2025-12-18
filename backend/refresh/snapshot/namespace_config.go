package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	namespaceConfigDomainName       = "namespace-config"
	catalogNamespaceConfigLimit     = 1000
	errNamespaceConfigScopeRequired = "namespace scope is required"
)

// NamespaceConfigBuilder constructs config summaries for a namespace.
type NamespaceConfigBuilder struct {
	configMaps corelisters.ConfigMapLister
	secrets    corelisters.SecretLister
}

// NamespaceConfigSnapshot payload returned to the frontend.
type NamespaceConfigSnapshot struct {
	Resources []ConfigSummary `json:"resources"`
}

// ConfigSummary describes a ConfigMap or Secret entry.
type ConfigSummary struct {
	Kind      string `json:"kind"`
	TypeAlias string `json:"typeAlias,omitempty"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Data      int    `json:"data"`
	Age       string `json:"age"`
}

// RegisterNamespaceConfigDomain registers the namespace config domain.
func RegisterNamespaceConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceConfigBuilder{
		configMaps: factory.Core().V1().ConfigMaps().Lister(),
		secrets:    factory.Core().V1().Secrets().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles ConfigMap and Secret summaries for a namespace scope.
func (b *NamespaceConfigBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	trimmed := strings.TrimSpace(scope)
	if trimmed == "" {
		return nil, errors.New(errNamespaceConfigScopeRequired)
	}

	isAll := isAllNamespaceScope(trimmed)
	var (
		namespace  string
		err        error
		scopeLabel string
	)
	if isAll {
		scopeLabel = "namespace:all"
	} else {
		namespace, err = parseAutoscalingNamespace(trimmed)
		if err != nil {
			return nil, errors.New(errNamespaceConfigScopeRequired)
		}
		scopeLabel = trimmed
	}

	configMaps, err := b.listConfigMaps(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace config: failed to list configmaps: %w", err)
	}

	secrets, err := b.listSecrets(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace config: failed to list secrets: %w", err)
	}

	return b.buildSnapshot(scopeLabel, configMaps, secrets)
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

func (b *NamespaceConfigBuilder) buildSnapshot(scope string, configMaps []*corev1.ConfigMap, secrets []*corev1.Secret) (*refresh.Snapshot, error) {
	resources := make([]ConfigSummary, 0, len(configMaps)+len(secrets))
	var version uint64

	for _, cm := range configMaps {
		if cm == nil {
			continue
		}
		summary := ConfigSummary{
			Kind:      "ConfigMap",
			TypeAlias: "CM",
			Name:      cm.Name,
			Namespace: cm.Namespace,
			Data:      len(cm.Data) + len(cm.BinaryData),
			Age:       formatAge(cm.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(cm); v > version {
			version = v
		}
	}

	for _, secret := range secrets {
		if secret == nil {
			continue
		}
		summary := ConfigSummary{
			Kind:      "Secret",
			TypeAlias: secretTypeAlias(secret),
			Name:      secret.Name,
			Namespace: secret.Namespace,
			Data:      len(secret.Data) + len(secret.StringData),
			Age:       formatAge(secret.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(secret); v > version {
			version = v
		}
	}

	sortConfigSummaries(resources)

	if len(resources) > catalogNamespaceConfigLimit {
		resources = resources[:catalogNamespaceConfigLimit]
	}

	return &refresh.Snapshot{
		Domain:  namespaceConfigDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceConfigSnapshot{Resources: resources},
		Stats:   refresh.SnapshotStats{ItemCount: len(resources)},
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
