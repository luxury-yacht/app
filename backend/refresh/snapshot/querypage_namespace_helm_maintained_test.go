package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/release"
	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/testsupport"
)

// TestNamespaceHelmBuilderMaintainedMatchesListPath is the namespace-helm maintained-store
// cutover gate: a builder serving from the re-aggregated store must produce the byte-identical
// NamespaceHelmSnapshot the list path produces — covering the synthesized aggregation's hard
// cases: latest revision wins, a superseded/uninstalled latest hides the release, multiple
// namespaces, and query scopes.
func TestNamespaceHelmBuilderMaintainedMatchesListPath(t *testing.T) {
	now := time.Now()
	secrets := []*corev1.Secret{
		helmReleaseSecret(t, newHelmRelease("app", "default", 1, release.StatusSuperseded, now)),
		helmReleaseSecret(t, newHelmRelease("app", "default", 2, release.StatusDeployed, now)), // latest -> shown
		helmReleaseSecret(t, newHelmRelease("db", "default", 1, release.StatusFailed, now)),
		helmReleaseSecret(t, newHelmRelease("svc", "staging", 2, release.StatusSuperseded, now)),
		helmReleaseSecret(t, newHelmRelease("svc", "staging", 3, release.StatusUninstalled, now)), // latest uninstalled -> hidden
	}
	lister := testsupport.NewSecretLister(t, secrets...)

	listBuilder := &NamespaceHelmBuilder{secretLister: lister, secretsSynced: func() bool { return true }}
	maintainedBuilder := &NamespaceHelmBuilder{
		secretLister: lister,
		meta:         ClusterMeta{},
		maintained:   newTypedMaintainedStore(ClusterMeta{}, helmQuerypageSchema(), helmTableQueryAdapter()),
	}
	for _, s := range secrets {
		maintainedBuilder.reaggregateRelease(s.Namespace, s.Labels["name"], s)
	}

	scopes := []string{
		"namespace:all",
		"namespace:default",
		"namespace:staging",
		"namespace:all?search=app",
		"namespace:default?sortField=status&sortDirection=desc",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(NamespaceHelmSnapshot),
			maintSnap.Payload.(NamespaceHelmSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
		// Version not asserted: helm's list version is the max revision number, the
		// maintained store's is a global monotonic counter — accepted divergence.
	}
}

// TestNamespaceHelmReaggregateRevertsOnLatestRevisionDelete pins the incremental-maintenance
// contract: when the latest revision secret is removed, re-aggregation reverts the row to the
// prior current revision (or removes it when none remains current).
func TestNamespaceHelmReaggregateRevertsOnLatestRevisionDelete(t *testing.T) {
	now := time.Now()
	v1 := helmReleaseSecret(t, newHelmRelease("app", "default", 1, release.StatusDeployed, now))
	v2 := helmReleaseSecret(t, newHelmRelease("app", "default", 2, release.StatusDeployed, now))

	b := &NamespaceHelmBuilder{
		secretLister: testsupport.NewSecretLister(t, v1, v2),
		meta:         ClusterMeta{},
		maintained:   newTypedMaintainedStore(ClusterMeta{}, helmQuerypageSchema(), helmTableQueryAdapter()),
	}
	b.reaggregateRelease("default", "app", v2)
	rows := b.maintained.rows("default", helmAvailableKinds)
	require.Len(t, rows, 1)
	require.Equal(t, 2, rows[0].Revision, "latest revision shown before delete")

	// Simulate deleting the latest revision: the lister now returns only v1.
	b.secretLister = testsupport.NewSecretLister(t, v1)
	b.reaggregateRelease("default", "app", v2)
	rows = b.maintained.rows("default", helmAvailableKinds)
	require.Len(t, rows, 1)
	require.Equal(t, 1, rows[0].Revision, "row reverts to the prior revision after the latest is deleted")

	// Removing the last revision removes the row entirely.
	b.secretLister = testsupport.NewSecretLister(t)
	b.reaggregateRelease("default", "app", v1)
	require.Empty(t, b.maintained.rows("default", helmAvailableKinds), "row removed when no revision remains")
}
