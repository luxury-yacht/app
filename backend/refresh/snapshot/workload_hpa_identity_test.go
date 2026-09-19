package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestWorkloadHPAOwnershipUsesRetainedRowGVK(t *testing.T) {
	for _, test := range []struct {
		group, version, target string
		managed                bool
	}{
		{"apps", "v1", "apps/v1", true},
		{"example.com", "v1", "apps/v1", false},
		{"apps", "v1beta1", "apps/v1", false},
		{"example.com", "v1", "example.com/v1", true},
	} {
		t.Run(test.group+"/"+test.version+"-"+test.target, func(t *testing.T) {
			assembler := workloadRowAssembler{hpaKnown: true, hpaTargets: buildHPATargetSet([]*autoscalingv1.HorizontalPodAutoscaler{{
				ObjectMeta: metav1.ObjectMeta{Namespace: "team-a"},
				Spec:       autoscalingv1.HorizontalPodAutoscalerSpec{ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{APIVersion: test.target, Kind: "Deployment", Name: "api"}},
			}})}
			row := WorkloadSummary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: test.group, Version: test.version, Kind: "Deployment", Namespace: "team-a", Name: "api"}}
			assembler.append(row)
			require.NotNil(t, assembler.items[0].HPAManaged)
			require.Equal(t, test.managed, *assembler.items[0].HPAManaged)
		})
	}
}
