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

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const clusterStorageDomainName = "cluster-storage"

// ClusterStorageBuilder constructs PersistentVolume summaries.
type ClusterStorageBuilder struct {
	pvLister corelisters.PersistentVolumeLister
}

// ClusterStorageSnapshot is the payload exposed to the frontend.
type ClusterStorageSnapshot struct {
	ClusterMeta
	Volumes []ClusterStorageEntry `json:"volumes"`
}

// ClusterStorageEntry represents a persistent volume in the cluster view.
type ClusterStorageEntry struct {
	ClusterMeta
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	StorageClass string `json:"storageClass,omitempty"`
	Capacity     string `json:"capacity"`
	AccessModes  string `json:"accessModes"`
	Status       string `json:"status"`
	Claim        string `json:"claim"`
	Age          string `json:"age"`
}

// RegisterClusterStorageDomain registers the storage domain.
func RegisterClusterStorageDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterStorageBuilder{
		pvLister: factory.Core().V1().PersistentVolumes().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterStorageDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build creates a snapshot of persistent volumes.
func (b *ClusterStorageBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.pvLister == nil {
		return nil, fmt.Errorf("cluster storage: persistent volume lister unavailable")
	}
	meta := CurrentClusterMeta()
	pvs, err := b.pvLister.List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("cluster storage: failed to list persistent volumes: %w", err)
	}
	entries := make([]ClusterStorageEntry, 0, len(pvs))
	var version uint64
	for _, pv := range pvs {
		if pv == nil {
			continue
		}
		entry := ClusterStorageEntry{
			ClusterMeta: meta,
			Kind:         "PersistentVolume",
			Name:         pv.Name,
			StorageClass: pv.Spec.StorageClassName,
			Capacity:     formatStorageCapacity(pv),
			AccessModes:  formatAccessModes(pv.Spec.AccessModes),
			Status:       string(pv.Status.Phase),
			Claim:        formatClaimRef(pv.Spec.ClaimRef),
			Age:          formatAge(pv.CreationTimestamp.Time),
		}
		entries = append(entries, entry)
		if v := resourceVersionOrTimestamp(pv); v > version {
			version = v
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})

	return &refresh.Snapshot{
		Domain:  clusterStorageDomainName,
		Version: version,
		Payload: ClusterStorageSnapshot{ClusterMeta: meta, Volumes: entries},
		Stats:   refresh.SnapshotStats{ItemCount: len(entries)},
	}, nil
}

func formatStorageCapacity(pv *corev1.PersistentVolume) string {
	if pv == nil {
		return "-"
	}
	if qty, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
		return qty.String()
	}
	return "-"
}

func formatAccessModes(modes []corev1.PersistentVolumeAccessMode) string {
	if len(modes) == 0 {
		return "-"
	}
	values := make([]string, 0, len(modes))
	for _, mode := range modes {
		values = append(values, string(mode))
	}
	return strings.Join(values, ",")
}

func formatClaimRef(ref *corev1.ObjectReference) string {
	if ref == nil {
		return "-"
	}
	if ref.Namespace != "" {
		return fmt.Sprintf("%s/%s", ref.Namespace, ref.Name)
	}
	return ref.Name
}
