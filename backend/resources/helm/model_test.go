package helm

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	helmtime "helm.sh/helm/v3/pkg/time"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildResourceModelSyntheticIdentityAndFacts(t *testing.T) {
	first := helmtime.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	last := helmtime.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)
	rel := &release.Release{
		Name:      "orders",
		Namespace: "apps",
		Version:   3,
		Chart: &chart.Chart{Metadata: &chart.Metadata{
			Name:        "orders-chart",
			Version:     "1.2.3",
			AppVersion:  "4.5.6",
			Annotations: map[string]string{"category": "backend"},
		}},
		Info: &release.Info{
			Status:        release.StatusDeployed,
			FirstDeployed: first,
			LastDeployed:  last,
			Description:   "Upgrade complete",
		},
		Labels: map[string]string{"app.kubernetes.io/name": "orders"},
	}
	history := []*release.Release{{
		Version: 2,
		Chart:   &chart.Chart{Metadata: &chart.Metadata{Name: "orders-chart", Version: "1.2.2"}},
		Info:    &release.Info{Status: release.StatusSuperseded, LastDeployed: first},
	}}
	resources := []resourcemodel.ResourceLink{
		resourcemodel.NewNamespacedResourceLink("cluster-a", "apps", "v1", "Deployment", "", "apps", "orders", ""),
	}
	opts := resourcemodel.ResourceModelBuildOptions{
		Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeRelationshipFacts | resourcemodel.MaterializeDetailFacts,
	}

	model := BuildResourceModel("cluster-a", rel, "", resources, history, opts)
	require.Equal(t, resourcemodel.ResourceSourceSynthetic, model.Source)
	require.Equal(t, resourcemodel.ResourceRef{
		ClusterID: "cluster-a",
		Group:     "helm.sh",
		Version:   "v3",
		Kind:      "HelmRelease",
		Resource:  "releases",
		Namespace: "apps",
		Name:      "orders",
	}, model.Ref)
	require.Equal(t, "deployed", model.Status.State)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, map[string]string{"category": "backend"}, model.Metadata.Annotations)

	facts := BuildFacts(rel, resources, history, opts)
	require.Equal(t, "orders-chart-1.2.3", facts.Chart)
	require.Equal(t, "1.2.3", facts.Version)
	require.Equal(t, "4.5.6", facts.AppVersion)
	require.Equal(t, 3, facts.Revision)
	require.Equal(t, "deployed", facts.RawStatus)
	require.Equal(t, "Upgrade complete", facts.Description)
	require.Equal(t, metav1.NewTime(last.Time), *facts.Updated)
	require.Len(t, facts.Resources, 1)
	require.Equal(t, "Deployment", facts.Resources[0].Ref.Kind)
	require.Equal(t, "apps", facts.Resources[0].Ref.Group)
	require.Equal(t, "v1", facts.Resources[0].Ref.Version)
	require.Equal(t, "apps", facts.Resources[0].Ref.Namespace)
	require.Len(t, facts.History, 1)
	require.Equal(t, "superseded", facts.History[0].Status)
}

func TestBuildFactsSummaryMaterializationOmitsDetailPayloads(t *testing.T) {
	rel := &release.Release{
		Name:      "orders",
		Namespace: "apps",
		Version:   3,
		Chart:     &chart.Chart{Metadata: &chart.Metadata{Name: "orders-chart", Version: "1.2.3"}},
		Info: &release.Info{
			Status:      release.StatusDeployed,
			Description: "Upgrade complete",
			Notes:       "detail notes should not be in table payloads",
		},
	}
	history := []*release.Release{{Version: 2, Info: &release.Info{Status: release.StatusSuperseded}}}
	resources := []resourcemodel.ResourceLink{
		resourcemodel.NewNamespacedResourceLink("cluster-a", "apps", "v1", "Deployment", "", "apps", "orders", ""),
	}

	facts := BuildFacts(rel, resources, history, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts})
	require.Equal(t, "orders-chart-1.2.3", facts.Chart)
	require.Equal(t, "deployed", facts.RawStatus)
	require.Equal(t, "Upgrade complete", facts.Description)
	require.Empty(t, facts.Notes)
	require.Empty(t, facts.History)
	require.Empty(t, facts.Resources)
}
