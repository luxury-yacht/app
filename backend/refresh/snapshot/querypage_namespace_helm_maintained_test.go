package snapshot

import (
	"context"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	corev1 "k8s.io/api/core/v1"
)

// The release table keeps only the decoded fields a row reads. Its rows must
// equal the rows the full releases map to, with the latest revision winning, a
// superseded or uninstalled latest hiding its release, and query scopes
// applied.
func TestHelmReleaseRowsMatchTheirFullReleases(t *testing.T) {
	now := time.Now()
	full := func(rls *release.Release) *release.Release {
		rls.Manifest = "kind: ConfigMap"
		rls.Config = map[string]interface{}{"replicas": 3}
		rls.Chart.Templates = []*chart.File{{Name: "templates/cm.yaml", Data: []byte("kind: ConfigMap")}}
		rls.Chart.Values = map[string]interface{}{"image": "nginx"}
		rls.Chart.Metadata.Annotations = map[string]string{"category": "web"}
		rls.Info.Notes = "thanks for installing"
		return rls
	}
	appV2 := full(newHelmRelease("app", "default", 2, release.StatusDeployed, now))
	db := full(newHelmRelease("db", "default", 1, release.StatusFailed, now))
	secrets := []*corev1.Secret{
		helmReleaseSecret(t, full(newHelmRelease("app", "default", 1, release.StatusSuperseded, now))),
		helmReleaseSecret(t, appV2),
		helmReleaseSecret(t, db),
		helmReleaseSecret(t, full(newHelmRelease("svc", "staging", 2, release.StatusSuperseded, now))),
		helmReleaseSecret(t, full(newHelmRelease("svc", "staging", 3, release.StatusUninstalled, now))),
	}
	builder := syncedHelmBuilder(t, secrets...)

	for _, tc := range []struct {
		scope    string
		releases []*release.Release
	}{
		{"namespace:all", []*release.Release{appV2, db}},
		{"namespace:default", []*release.Release{appV2, db}},
		{"namespace:staging", nil},
		{"namespace:all?search=app", []*release.Release{appV2}},
	} {
		snap, err := builder.Build(context.Background(), tc.scope)
		require.NoError(t, err, tc.scope)
		want := make([]NamespaceHelmSummary, 0, len(tc.releases))
		for _, rls := range tc.releases {
			row, ok := mapHelmRelease(rls, "", ClusterMeta{})
			require.True(t, ok)
			want = append(want, row)
		}
		sort.Slice(want, func(i, j int) bool { return want[i].Ref.Name < want[j].Ref.Name })
		require.Equal(t, want, snap.Payload.(NamespaceHelmSnapshot).Rows, tc.scope)
	}
}

// Deleting a release's latest revision reverts its row to the prior current
// revision, and deleting the last revision removes the row.
func TestHelmReleaseRowRevertsWhenItsLatestRevisionIsDeleted(t *testing.T) {
	now := time.Now()
	v1 := helmReleaseSecret(t, newHelmRelease("app", "default", 1, release.StatusDeployed, now))
	v2 := helmReleaseSecret(t, newHelmRelease("app", "default", 2, release.StatusDeployed, now))
	builder, feed := fedHelmBuilder(t, v1, v2)
	require.Equal(t, []int{2}, helmRevisions(builder))

	feed.DeleteBundle(helmSecretBundle(v2))
	require.Equal(t, []int{1}, helmRevisions(builder))

	feed.DeleteBundle(helmSecretBundle(v1))
	require.Empty(t, helmRevisions(builder))
}

func helmRevisions(builder *NamespaceHelmBuilder) []int {
	var revisions []int
	for _, row := range builder.maintained.rows("", helmAvailableKinds) {
		revisions = append(revisions, row.Revision)
	}
	return revisions
}
