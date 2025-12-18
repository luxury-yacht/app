package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apiextlisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const clusterCRDDomainName = "cluster-crds"

// ClusterCRDBuilder produces CustomResourceDefinition snapshots.
type ClusterCRDBuilder struct {
	crdLister apiextlisters.CustomResourceDefinitionLister
}

// ClusterCRDSnapshot is returned to the frontend.
type ClusterCRDSnapshot struct {
	Definitions []ClusterCRDEntry `json:"definitions"`
}

// ClusterCRDEntry represents an individual CRD in the table.
type ClusterCRDEntry struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Group     string `json:"group"`
	Scope     string `json:"scope"`
	Details   string `json:"details"`
	Age       string `json:"age"`
	TypeAlias string `json:"typeAlias,omitempty"`
}

// RegisterClusterCRDDomain registers the CRD domain with the registry.
func RegisterClusterCRDDomain(
	reg *domain.Registry,
	factory apiextinformers.SharedInformerFactory,
) error {
	if factory == nil {
		return errors.New("apiextensions informer factory is nil")
	}
	builder := &ClusterCRDBuilder{
		crdLister: factory.Apiextensions().V1().CustomResourceDefinitions().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterCRDDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build constructs the CRD snapshot payload.
func (b *ClusterCRDBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.crdLister == nil {
		return nil, fmt.Errorf("cluster crds: CRD lister unavailable")
	}
	crds, err := b.crdLister.List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("cluster crds: failed to list CRDs: %w", err)
	}

	entries := make([]ClusterCRDEntry, 0, len(crds))
	var version uint64
	for _, crd := range crds {
		if crd == nil {
			continue
		}
		entry := ClusterCRDEntry{
			Kind:      "CustomResourceDefinition",
			Name:      crd.Name,
			Group:     crd.Spec.Group,
			Scope:     string(crd.Spec.Scope),
			Details:   describeCRDVersions(crd),
			Age:       formatAge(crd.CreationTimestamp.Time),
			TypeAlias: "CRD",
		}
		entries = append(entries, entry)
		if v := resourceVersionOrTimestamp(crd); v > version {
			version = v
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})

	return &refresh.Snapshot{
		Domain:  clusterCRDDomainName,
		Version: version,
		Payload: ClusterCRDSnapshot{Definitions: entries},
		Stats:   refresh.SnapshotStats{ItemCount: len(entries)},
	}, nil
}

func describeCRDVersions(crd *apiextensionsv1.CustomResourceDefinition) string {
	if crd == nil {
		return ""
	}
	if len(crd.Spec.Versions) == 0 {
		return "Versions: -"
	}
	versions := make([]string, 0, len(crd.Spec.Versions))
	for _, version := range crd.Spec.Versions {
		label := version.Name
		if version.Served && version.Storage {
			label += "*"
		}
		versions = append(versions, label)
	}
	return fmt.Sprintf("Versions: %s", strings.Join(versions, ","))
}
