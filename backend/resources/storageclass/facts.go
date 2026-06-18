/*
 * backend/resources/storageclass/facts.go
 *
 * Canonical StorageClass facts — the single typed extraction of a StorageClass's
 * intrinsic fields.
 */

package storageclass

// Facts is the canonical StorageClass model facts.
type Facts struct {
	Provisioner                 string `json:"provisioner,omitempty"`
	ReclaimPolicy               string `json:"reclaimPolicy,omitempty"`
	VolumeBindingMode           string `json:"volumeBindingMode,omitempty"`
	AllowVolumeExpansion        bool   `json:"allowVolumeExpansion,omitempty"`
	DefaultClass                bool   `json:"defaultClass"`
	DefaultClassAnnotation      string `json:"defaultClassAnnotation,omitempty"`
	DefaultClassAnnotationValue string `json:"defaultClassAnnotationValue,omitempty"`
}
