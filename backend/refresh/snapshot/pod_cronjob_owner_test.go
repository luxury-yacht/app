package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func cronJobOwnedJob() *batchv1.Job {
	return &batchv1.Job{ObjectMeta: metav1.ObjectMeta{
		Namespace: "batch",
		Name:      "nightly-29123456",
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "batch/v1",
			Kind:       "CronJob",
			Name:       "nightly",
			Controller: ptrBool(true),
		}},
	}}
}

func jobOwnedPod() *corev1.Pod {
	return &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Namespace: "batch",
		Name:      "nightly-29123456-abcde",
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "batch/v1",
			Kind:       "Job",
			Name:       "nightly-29123456",
			Controller: ptrBool(true),
		}},
	}}
}

func TestJobProjectionCarriesCronJobControllerIdentity(t *testing.T) {
	projected, err := NewJobIngestProjector(ClusterMeta{ClusterID: "c-1"})(cronJobOwnedJob())
	if err != nil {
		t.Fatalf("project job: %v", err)
	}
	owner, ok := projected.(ingest.Bundle).Aggregate.(JobControllerOwner)
	if !ok {
		t.Fatalf("job aggregate = %T, want JobControllerOwner", projected.(ingest.Bundle).Aggregate)
	}
	if owner.Namespace != "batch" || owner.JobName != "nightly-29123456" ||
		owner.APIVersion != "batch/v1" || owner.Kind != "CronJob" || owner.Name != "nightly" {
		t.Fatalf("job controller owner = %#v", owner)
	}
}

func TestPodProjectionResolvesJobToCronJobAndHealMatchesFreshProjection(t *testing.T) {
	jobOwner := JobControllerOwner{
		Namespace: "batch", JobName: "nightly-29123456",
		APIVersion: "batch/v1", Kind: "CronJob", Name: "nightly",
	}
	lookup := func(namespace, name string) (JobControllerOwner, bool) {
		return jobOwner, namespace == jobOwner.Namespace && name == jobOwner.JobName
	}
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}

	freshRaw, err := NewPodIngestProjector(meta, PodOwnerSources{JobControllerOwner: lookup})(jobOwnedPod())
	if err != nil {
		t.Fatalf("fresh project: %v", err)
	}
	fresh := freshRaw.(ingest.Bundle)
	row := fresh.Table.(PodSummary)
	if row.OwnerAPIVersion != "batch/v1" || row.OwnerKind != "CronJob" || row.OwnerName != "nightly" {
		t.Fatalf("resolved owner = %s %s/%s", row.OwnerAPIVersion, row.OwnerKind, row.OwnerName)
	}
	if row.DirectOwnerKind != "Job" || row.DirectOwnerName != "nightly-29123456" {
		t.Fatalf("direct owner = %s/%s", row.DirectOwnerKind, row.DirectOwnerName)
	}
	aggregate := fresh.Aggregate.(streamrows.PodAggregate)
	if aggregate.OwnerKey != WorkloadOwnerKey("Job", "batch", "nightly-29123456") {
		t.Fatalf("owner key = %q", aggregate.OwnerKey)
	}
	if got, err := filterPodRowsByScope([]PodSummary{row}, "workload:batch:batch:v1:CronJob:nightly"); err != nil || len(got) != 1 {
		t.Fatalf("CronJob scope result = %#v, %v", got, err)
	}
	if got, err := filterPodRowsByScope([]PodSummary{row}, "workload:batch:batch:v1:Job:nightly-29123456"); err != nil || len(got) != 1 {
		t.Fatalf("Job scope result = %#v, %v", got, err)
	}

	racedRaw, err := NewPodIngestProjector(meta, PodOwnerSources{})(jobOwnedPod())
	if err != nil {
		t.Fatalf("raced project: %v", err)
	}
	healed, changed := HealPodBundleJobOwner(racedRaw.(ingest.Bundle), jobOwner)
	if !changed {
		t.Fatal("heal declined unresolved Job owner")
	}
	if !reflect.DeepEqual(healed, fresh) {
		t.Fatalf("healed bundle diverges from fresh projection:\nhealed: %#v\nfresh: %#v", healed, fresh)
	}
	if _, changed := HealPodBundleJobOwner(healed, jobOwner); changed {
		t.Fatal("heal accepted an already-resolved Job owner")
	}
}
