/*
 * backend/resources/persistentvolumeclaim/facts.go
 *
 * Canonical PersistentVolumeClaim facts. Capacity/Conditions/MountedBy reference
 * shared resourcemodel primitives.
 */

package persistentvolumeclaim

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical PersistentVolumeClaim model facts.
type Facts struct {
	Phase        string                          `json:"phase,omitempty"`
	StorageClass string                          `json:"storageClass,omitempty"`
	VolumeName   string                          `json:"volumeName,omitempty"`
	Capacity     resourcemodel.ResourceListFacts `json:"capacity,omitempty"`
	Conditions   []resourcemodel.ConditionFacts  `json:"conditions,omitempty"`
	MountedBy    []resourcemodel.ResourceLink    `json:"mountedBy,omitempty"`
}
