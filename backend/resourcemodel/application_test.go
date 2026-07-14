package resourcemodel

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestApplicationCandidatePrefersHelmThenLabelsThenOwner(t *testing.T) {
	controller := true
	obj := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{
		Namespace: "payments",
		Name:      "api",
		Annotations: map[string]string{
			"meta.helm.sh/release-name": "payments-release",
		},
		Labels: map[string]string{
			"app.kubernetes.io/part-of": "payments-suite",
		},
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
			Name:       "payments-api",
			Controller: &controller,
		}},
	}}

	candidate, ok := ApplicationCandidateForObject("cluster-a", obj)
	if !ok {
		t.Fatal("expected a candidate")
	}
	if candidate.Name != "payments-release" || candidate.Evidence != ApplicationEvidenceHelm {
		t.Fatalf("candidate = %#v, want Helm release payments-release", candidate)
	}
	if candidate.Confidence != ApplicationConfidenceMedium || candidate.Root != nil {
		t.Fatalf("unconfirmed Helm candidate = %#v, want medium and non-navigable", candidate)
	}

	delete(obj.Annotations, "meta.helm.sh/release-name")
	candidate, ok = ApplicationCandidateForObject("cluster-a", obj)
	if !ok || candidate.Name != "payments-suite" || candidate.Evidence != ApplicationEvidenceLabel || candidate.Confidence != ApplicationConfidenceLow || candidate.Root != nil {
		t.Fatalf("label candidate = %#v, want lower-confidence non-navigable payments-suite", candidate)
	}

	delete(obj.Labels, "app.kubernetes.io/part-of")
	candidate, ok = ApplicationCandidateForObject("cluster-a", obj)
	if !ok || candidate.Name != "payments-api" || candidate.Evidence != ApplicationEvidenceOwner || candidate.Confidence != ApplicationConfidenceMedium || candidate.Root == nil {
		t.Fatalf("owner candidate = %#v, want navigable payments-api", candidate)
	}
	if candidate.Root.ClusterID != "cluster-a" || candidate.Root.Group != "apps" || candidate.Root.Version != "v1" || candidate.Root.Kind != "Deployment" || candidate.Root.Namespace != "payments" || candidate.Root.Name != "payments-api" {
		t.Fatalf("owner root = %#v, want complete cluster/GVK/object identity", candidate.Root)
	}
}

func TestApplicationCandidateKeepsIncompleteOwnerGroupingOnly(t *testing.T) {
	controller := true
	obj := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{
		Namespace: "batch",
		Name:      "run-once",
		OwnerReferences: []metav1.OwnerReference{{
			Kind:       "CronJob",
			Name:       "nightly",
			Controller: &controller,
		}},
	}}

	candidate, ok := ApplicationCandidateForObject("cluster-a", obj)
	if !ok || candidate.Name != "nightly" || candidate.Evidence != ApplicationEvidenceOwner || candidate.Confidence != ApplicationConfidenceLow || candidate.Root != nil {
		t.Fatalf("candidate = %#v, want lower-confidence non-navigable owner group", candidate)
	}
}

func TestHelmReleaseStorageCandidateUsesReleaseLabels(t *testing.T) {
	obj := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{
		Namespace: "payments",
		Name:      "sh.helm.release.v1.payments.v7",
		Labels: map[string]string{
			"owner":   "helm",
			"name":    "payments",
			"version": "7",
			"status":  "deployed",
		},
	}}

	candidate, ok := HelmReleaseStorageCandidateForObject(obj, "")
	if !ok || candidate.Namespace != "payments" || candidate.Name != "payments" || candidate.Revision != 7 || candidate.Status != "deployed" {
		t.Fatalf("candidate = %#v, want payments revision 7 deployed", candidate)
	}
}
