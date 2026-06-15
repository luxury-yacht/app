/*
 * backend/resources/persistentvolume/facts.go
 *
 * Canonical PersistentVolume facts. Capacity references the shared
 * resourcemodel.ResourceListFacts primitive.
 */

package persistentvolume

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical PersistentVolume model facts.
type Facts struct {
	Phase          string                       `json:"phase,omitempty"`
	StorageClass   string                       `json:"storageClass,omitempty"`
	Capacity       resourcemodel.ResourceListFacts `json:"capacity,omitempty"`
	ReclaimPolicy  string                       `json:"reclaimPolicy,omitempty"`
	ClaimNamespace string                       `json:"claimNamespace,omitempty"`
	ClaimName      string                       `json:"claimName,omitempty"`
	Reason         string                       `json:"reason,omitempty"`
	Message        string                       `json:"message,omitempty"`
}
