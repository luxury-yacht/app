package snapshot

import (
	"testing"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestBuildSnapshotPopulatesTargetAPIVersion verifies that the autoscaling
// snapshot threads hpa.Spec.ScaleTargetRef.APIVersion onto the summary as
// TargetAPIVersion. The frontend uses this to open the scale target in the
// object panel with a fully-qualified GVK — required for CRDs that share
// a Kind across operator groups (e.g. two custom DBCluster types). See
// docs/plans/kind-only-objects.md.
func TestBuildSnapshotPopulatesTargetAPIVersion(t *testing.T) {
	// Two HPAs targeting different-group CRDs that happen to share Kind
	// and namespace+name. Without TargetAPIVersion the frontend cannot
	// tell them apart.
	ackHPA := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "ack-hpa",
			Namespace: "default",
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				Kind:       "DBCluster",
				Name:       "primary",
				APIVersion: "rds.services.k8s.aws/v1alpha1",
			},
			MaxReplicas: 5,
		},
	}
	cnpgHPA := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cnpg-hpa",
			Namespace: "default",
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				Kind:       "DBCluster",
				Name:       "primary",
				APIVersion: "postgresql.cnpg.io/v1",
			},
			MaxReplicas: 3,
		},
	}
	builtinHPA := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "deploy-hpa",
			Namespace: "default",
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				Kind:       "Deployment",
				Name:       "web",
				APIVersion: "apps/v1",
			},
			MaxReplicas: 10,
		},
	}

	builder := &NamespaceAutoscalingBuilder{}
	snap, err := builder.buildSnapshot(
		ClusterMeta{},
		"namespace:default",
		[]*autoscalingv1.HorizontalPodAutoscaler{ackHPA, cnpgHPA, builtinHPA},
	)
	if err != nil {
		t.Fatalf("buildSnapshot returned error: %v", err)
	}

	payload, ok := snap.Payload.(NamespaceAutoscalingSnapshot)
	if !ok {
		t.Fatalf("expected payload type NamespaceAutoscalingSnapshot, got %T", snap.Payload)
	}
	if len(payload.Resources) != 3 {
		t.Fatalf("expected 3 resources, got %d", len(payload.Resources))
	}

	// Index by HPA name (sorted by namespace then name).
	byName := make(map[string]AutoscalingSummary, len(payload.Resources))
	for _, r := range payload.Resources {
		byName[r.Name] = r
	}

	if got := byName["ack-hpa"].TargetAPIVersion; got != "rds.services.k8s.aws/v1alpha1" {
		t.Errorf("ack-hpa: TargetAPIVersion=%q, want rds.services.k8s.aws/v1alpha1", got)
	}
	if got := byName["cnpg-hpa"].TargetAPIVersion; got != "postgresql.cnpg.io/v1" {
		t.Errorf("cnpg-hpa: TargetAPIVersion=%q, want postgresql.cnpg.io/v1", got)
	}
	if got := byName["deploy-hpa"].TargetAPIVersion; got != "apps/v1" {
		t.Errorf("deploy-hpa: TargetAPIVersion=%q, want apps/v1", got)
	}

	// The legacy Target string is still populated for the table column.
	if got := byName["ack-hpa"].Target; got != "DBCluster/primary" {
		t.Errorf("ack-hpa: Target=%q, want DBCluster/primary", got)
	}
}
