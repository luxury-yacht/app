package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
)

// fakeHPASource is the HPA ingest store's projected scale targets and the
// availability of each of its partitions.
type fakeHPASource struct {
	targets []hpapkg.ScaleTarget
	parts   []ingest.PartitionReadiness
	rv      string
}

func (s fakeHPASource) AggregateRows(gvr schema.GroupVersionResource) []interface{} {
	if gvr != HPAGVR {
		return nil
	}
	rows := make([]interface{}, 0, len(s.targets))
	for _, target := range s.targets {
		rows = append(rows, target)
	}
	return rows
}

func (s fakeHPASource) PartitionReadinessFor(gvr schema.GroupVersionResource) []ingest.PartitionReadiness {
	if gvr != HPAGVR {
		return nil
	}
	return s.parts
}

func (s fakeHPASource) StoreResourceVersion(gvr schema.GroupVersionResource) string {
	if gvr != HPAGVR {
		return ""
	}
	return s.rv
}

func readyEverywhere() []ingest.PartitionReadiness {
	return []ingest.PartitionReadiness{{State: refresh.ResourceReadinessReady}}
}

func hpaWorkloadsBuilder(t *testing.T, source hpaTargetSource) *NamespaceWorkloadsBuilder {
	t.Helper()
	replicas := int32(1)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", ResourceVersion: "10", CreationTimestamp: metav1.NewTime(time.Now().Add(-time.Hour))},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas, Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}}},
	}
	builder := &NamespaceWorkloadsBuilder{
		workloadIngest:     newFakeWorkloadIngestSource(ClusterMeta{}, deployment),
		includeDeployments: true,
		hpaSource:          source,
		perBuild:           &perBuildStoreCache[WorkloadSummary]{},
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})
	return builder
}

func webHPAManaged(t *testing.T, builder *NamespaceWorkloadsBuilder, scope string) *bool {
	t.Helper()
	snapshot, err := builder.Build(context.Background(), scope)
	require.NoError(t, err)
	payload := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, payload.Rows, 1)
	return payload.Rows[0].HPAManaged
}

var appsWebTarget = hpapkg.ScaleTarget{Namespace: "default", APIVersion: "apps/v1", Kind: "Deployment", Name: "web"}

// "Not HPA-managed" offers the ordinary Scale action, so it is reported only
// when the HPA data is actually complete. Settlement after a deadline degrade,
// a permission skip, or a still-loading store leaves it unknown.
func TestWorkloadHPAManagedNeedsCompleteHPAData(t *testing.T) {
	customTarget := hpapkg.ScaleTarget{Namespace: "default", APIVersion: "example.com/v1", Kind: "Deployment", Name: "web"}
	for _, tc := range []struct {
		name   string
		source hpaTargetSource
		want   *bool
	}{
		{"ready, other target", fakeHPASource{targets: []hpapkg.ScaleTarget{customTarget}, parts: readyEverywhere()}, ptrTo(false)},
		{"ready, matching target", fakeHPASource{targets: []hpapkg.ScaleTarget{customTarget, appsWebTarget}, parts: readyEverywhere()}, ptrTo(true)},
		{"loading", fakeHPASource{parts: []ingest.PartitionReadiness{{State: refresh.ResourceReadinessPending}}}, nil},
		{"deadline degraded", fakeHPASource{parts: []ingest.PartitionReadiness{{State: refresh.ResourceReadinessDegraded}}}, nil},
		{"permission skipped, including a restored baseline", fakeHPASource{targets: []hpapkg.ScaleTarget{customTarget}, parts: []ingest.PartitionReadiness{{State: refresh.ResourceReadinessUnavailable}}}, nil},
		{"no HPA source", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := webHPAManaged(t, hpaWorkloadsBuilder(t, tc.source), "namespace:default")
			require.Equal(t, tc.want, got)
		})
	}
}

// Under a namespace scope each namespace has its own HPA partition: a denied
// namespace makes only requests that cover it unknown.
func TestWorkloadHPAKnowledgeFollowsTheRequestedPartition(t *testing.T) {
	source := fakeHPASource{parts: []ingest.PartitionReadiness{
		{Namespace: "default", State: refresh.ResourceReadinessReady},
		{Namespace: "other", State: refresh.ResourceReadinessUnavailable},
	}}
	builder := hpaWorkloadsBuilder(t, source)
	require.Equal(t, ptrTo(false), webHPAManaged(t, builder, "namespace:default"))
	require.Nil(t, webHPAManaged(t, builder, "namespace:all"))
}

// A query-backed workloads page reuses its per-build store while the snapshot
// version is unchanged, so an HPA change must advance the version or the page
// keeps the old "HPA managed" flag.
func TestWorkloadQueryPageShowsHPAChange(t *testing.T) {
	builder := hpaWorkloadsBuilder(t, fakeHPASource{parts: readyEverywhere(), rv: "20"})
	scope := "namespace:default?limit=50"
	require.Equal(t, ptrTo(false), webHPAManaged(t, builder, scope))

	builder.hpaSource = fakeHPASource{targets: []hpapkg.ScaleTarget{appsWebTarget}, parts: readyEverywhere(), rv: "21"}
	require.Equal(t, ptrTo(true), webHPAManaged(t, builder, scope))
}

func ptrTo[T any](value T) *T { return &value }
