package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/stretchr/testify/require"
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
			assembler := workloadRowAssembler{hpaKnown: true, hpaTargets: buildHPATargetSet([]hpapkg.ScaleTarget{
				{Namespace: "team-a", APIVersion: test.target, Kind: "Deployment", Name: "api"},
			})}
			row := WorkloadSummary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: test.group, Version: test.version, Kind: "Deployment", Namespace: "team-a", Name: "api"}}
			assembler.append(row)
			require.NotNil(t, assembler.items[0].HPAManaged)
			require.Equal(t, test.managed, *assembler.items[0].HPAManaged)
		})
	}
}
