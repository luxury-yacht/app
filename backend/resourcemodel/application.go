package resourcemodel

import (
	"strconv"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	applicationPartOfLabel    = "app.kubernetes.io/part-of"
	applicationInstanceLabel  = "app.kubernetes.io/instance"
	applicationNameLabel      = "app.kubernetes.io/name"
	helmManagedByLabel        = "app.kubernetes.io/managed-by"
	helmReleaseNameAnnotation = "meta.helm.sh/release-name"
	helmReleaseSecretType     = "helm.sh/release.v1"
	helmReleaseOwnerLabel     = "owner"
	helmReleaseOwnerValue     = "helm"
	helmReleaseNameLabel      = "name"
	helmReleaseRevisionLabel  = "version"
	helmReleaseStatusLabel    = "status"
)

// ApplicationEvidence identifies the strongest signal that assigned a workload
// to an application group.
type ApplicationEvidence string

const (
	ApplicationEvidenceHelm  ApplicationEvidence = "helm"
	ApplicationEvidenceOwner ApplicationEvidence = "owner"
	ApplicationEvidenceLabel ApplicationEvidence = "label"
)

// ApplicationConfidence communicates whether a group is backed by a confirmed
// application root, a complete structural owner, or grouping-only metadata.
type ApplicationConfidence string

const (
	ApplicationConfidenceHigh   ApplicationConfidence = "high"
	ApplicationConfidenceMedium ApplicationConfidence = "medium"
	ApplicationConfidenceLow    ApplicationConfidence = "low"
)

// ApplicationCandidate is the compact grouping signal projected from one
// workload. Root is populated only when the source object itself supplies a
// complete, openable owner reference. Helm roots are attached later after the
// grouping builder confirms a current release exists; label roots stay nil.
type ApplicationCandidate struct {
	Name       string
	Evidence   ApplicationEvidence
	Confidence ApplicationConfidence
	Root       *ResourceRef
}

// HelmReleaseStorageCandidate is the metadata-only part of one Helm storage
// revision. The application builder selects the newest revision per release and
// never decodes or retains the release payload.
type HelmReleaseStorageCandidate struct {
	Namespace string
	Name      string
	Revision  int
	Status    string
}

// ApplicationCandidateForObject chooses one application signal in descending
// semantic order: explicit Helm release, recommended application labels, then a
// controlling owner. Label-only and incomplete-owner groups are intentionally
// non-navigable.
func ApplicationCandidateForObject(clusterID string, obj metav1.Object) (ApplicationCandidate, bool) {
	if obj == nil {
		return ApplicationCandidate{}, false
	}
	annotations := obj.GetAnnotations()
	labels := obj.GetLabels()

	if releaseName := strings.TrimSpace(annotations[helmReleaseNameAnnotation]); releaseName != "" {
		return ApplicationCandidate{
			Name:       releaseName,
			Evidence:   ApplicationEvidenceHelm,
			Confidence: ApplicationConfidenceMedium,
		}, true
	}
	if strings.EqualFold(strings.TrimSpace(labels[helmManagedByLabel]), "helm") {
		if releaseName := strings.TrimSpace(labels[applicationInstanceLabel]); releaseName != "" {
			return ApplicationCandidate{
				Name:       releaseName,
				Evidence:   ApplicationEvidenceHelm,
				Confidence: ApplicationConfidenceMedium,
			}, true
		}
	}
	for _, key := range []string{applicationPartOfLabel, applicationInstanceLabel, applicationNameLabel} {
		if name := strings.TrimSpace(labels[key]); name != "" {
			return ApplicationCandidate{
				Name:       name,
				Evidence:   ApplicationEvidenceLabel,
				Confidence: ApplicationConfidenceLow,
			}, true
		}
	}

	for _, owner := range obj.GetOwnerReferences() {
		if owner.Controller == nil || !*owner.Controller || strings.TrimSpace(owner.Name) == "" {
			continue
		}
		candidate := ApplicationCandidate{
			Name:       strings.TrimSpace(owner.Name),
			Evidence:   ApplicationEvidenceOwner,
			Confidence: ApplicationConfidenceLow,
		}
		groupVersion, err := schema.ParseGroupVersion(strings.TrimSpace(owner.APIVersion))
		if err != nil || strings.TrimSpace(groupVersion.Version) == "" || strings.TrimSpace(owner.Kind) == "" || strings.TrimSpace(clusterID) == "" {
			return candidate, true
		}
		root := NewResourceRef(
			clusterID,
			groupVersion.Group,
			groupVersion.Version,
			strings.TrimSpace(owner.Kind),
			"",
			obj.GetNamespace(),
			strings.TrimSpace(owner.Name),
			string(owner.UID),
		)
		candidate.Confidence = ApplicationConfidenceMedium
		candidate.Root = &root
		return candidate, true
	}
	return ApplicationCandidate{}, false
}

// HelmReleaseStorageCandidateForObject projects the labels Helm writes on a
// release revision. It accepts both Secret and legacy ConfigMap storage markers.
func HelmReleaseStorageCandidateForObject(obj metav1.Object, secretType string) (HelmReleaseStorageCandidate, bool) {
	if obj == nil {
		return HelmReleaseStorageCandidate{}, false
	}
	labels := obj.GetLabels()
	isHelm := strings.EqualFold(strings.TrimSpace(secretType), helmReleaseSecretType) ||
		strings.EqualFold(strings.TrimSpace(labels[helmReleaseOwnerLabel]), helmReleaseOwnerValue) ||
		strings.HasPrefix(obj.GetName(), HelmReleaseNamePrefix)
	if !isHelm {
		return HelmReleaseStorageCandidate{}, false
	}
	name := strings.TrimSpace(labels[helmReleaseNameLabel])
	if name == "" {
		name = strings.TrimSpace(HelmReleaseName(obj.GetName()))
	}
	if name == "" {
		return HelmReleaseStorageCandidate{}, false
	}
	revision, err := strconv.Atoi(strings.TrimSpace(labels[helmReleaseRevisionLabel]))
	if err != nil || revision < 0 {
		return HelmReleaseStorageCandidate{}, false
	}
	return HelmReleaseStorageCandidate{
		Namespace: obj.GetNamespace(),
		Name:      name,
		Revision:  revision,
		Status:    strings.ToLower(strings.TrimSpace(labels[helmReleaseStatusLabel])),
	}, true
}
