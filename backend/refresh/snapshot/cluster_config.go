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

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const clusterConfigDomainName = "cluster-config"

// ClusterConfigBuilder aggregates configuration resources for the cluster tab.
type ClusterConfigBuilder struct {
	storageClassLister      storagelisters.StorageClassLister
	ingressClassLister      networklisters.IngressClassLister
	validatingWebhookLister admissionlisters.ValidatingWebhookConfigurationLister
	mutatingWebhookLister   admissionlisters.MutatingWebhookConfigurationLister
	perms                   ClusterConfigPermissions
}

// ClusterConfigPermissions indicates which resources should be included in the domain.
type ClusterConfigPermissions struct {
	IncludeStorageClasses     bool
	IncludeIngressClasses     bool
	IncludeValidatingWebhooks bool
	IncludeMutatingWebhooks   bool
}

// ClusterConfigSnapshot represents the payload exposed to the UI.
type ClusterConfigSnapshot struct {
	ClusterMeta
	Resources []ClusterConfigEntry `json:"resources"`
}

// ClusterConfigEntry covers a storage class, ingress class, or webhook config.
type ClusterConfigEntry struct {
	ClusterMeta
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Details   string `json:"details"`
	IsDefault bool   `json:"isDefault,omitempty"`
	Age       string `json:"age"`
}

// RegisterClusterConfigDomain registers the domain with the registry.
func RegisterClusterConfigDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	perms ClusterConfigPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterConfigBuilder{
		storageClassLister:      nil,
		ingressClassLister:      nil,
		validatingWebhookLister: nil,
		mutatingWebhookLister:   nil,
	}
	if perms.IncludeStorageClasses {
		builder.storageClassLister = factory.Storage().V1().StorageClasses().Lister()
	}
	if perms.IncludeIngressClasses {
		builder.ingressClassLister = factory.Networking().V1().IngressClasses().Lister()
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
	return b.buildFromListers(ctx)
}

func (b *ClusterConfigBuilder) buildFromListers(ctx context.Context) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	var version uint64
	entries := make([]ClusterConfigEntry, 0, 64)

	if b.storageClassLister != nil {
		storageClasses, err := b.storageClassLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		for _, sc := range storageClasses {
			if sc == nil {
				continue
			}
			entries = append(entries, ClusterConfigEntry{
				ClusterMeta: meta,
				Kind:      "StorageClass",
				Name:      sc.Name,
				Details:   sc.Provisioner,
				IsDefault: isDefaultClass(sc.Annotations),
				Age:       formatAge(sc.CreationTimestamp.Time),
			})
			if v := resourceVersionOrTimestamp(sc); v > version {
				version = v
			}
		}
	}

	if b.ingressClassLister != nil {
		ingressClasses, err := b.ingressClassLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		for _, ic := range ingressClasses {
			if ic == nil {
				continue
			}
			entries = append(entries, ClusterConfigEntry{
				ClusterMeta: meta,
				Kind:      "IngressClass",
				Name:      ic.Name,
				Details:   ic.Spec.Controller,
				IsDefault: isDefaultClass(ic.Annotations),
				Age:       formatAge(ic.CreationTimestamp.Time),
			})
			if v := resourceVersionOrTimestamp(ic); v > version {
				version = v
			}
		}
	}

	if b.validatingWebhookLister != nil {
		validatingWebhooks, err := b.validatingWebhookLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		for _, webhook := range validatingWebhooks {
			if webhook == nil {
				continue
			}
			entries = append(entries, ClusterConfigEntry{
				ClusterMeta: meta,
				Kind:    "ValidatingWebhookConfiguration",
				Name:    webhook.Name,
				Details: webhookDetails(len(webhook.Webhooks)),
				Age:     formatAge(webhook.CreationTimestamp.Time),
			})
			if v := resourceVersionOrTimestamp(webhook); v > version {
				version = v
			}
		}
	}

	if b.mutatingWebhookLister != nil {
		mutatingWebhooks, err := b.mutatingWebhookLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		for _, webhook := range mutatingWebhooks {
			if webhook == nil {
				continue
			}
			entries = append(entries, ClusterConfigEntry{
				ClusterMeta: meta,
				Kind:    "MutatingWebhookConfiguration",
				Name:    webhook.Name,
				Details: webhookDetails(len(webhook.Webhooks)),
				Age:     formatAge(webhook.CreationTimestamp.Time),
			})
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

	return &refresh.Snapshot{
		Domain:  clusterConfigDomainName,
		Version: version,
		Payload: ClusterConfigSnapshot{ClusterMeta: meta, Resources: entries},
		Stats:   refresh.SnapshotStats{ItemCount: len(entries)},
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

func webhookDetails(count int) string {
	if count == 1 {
		return "1 webhook"
	}
	return fmt.Sprintf("%d webhooks", count)
}
