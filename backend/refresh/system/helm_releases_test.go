package system

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"maps"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

var secretGVR = corev1.SchemeGroupVersion.WithResource("secrets")

// helmRevision is the Secret Helm's storage driver writes for one revision of
// a release.
func helmRevision(namespace, name string, version int, status release.Status) *corev1.Secret {
	return helmRevisionStoredAs(namespace, "sh.helm.release.v1."+name+".v"+strconv.Itoa(version), name, version, status)
}

// helmRevisionStoredAs is helmRevision under an explicit Secret name, so a
// test can move one Secret between releases.
func helmRevisionStoredAs(namespace, secretName, name string, version int, status release.Status) *corev1.Secret {
	payload, _ := json.Marshal(&release.Release{
		Name: name, Namespace: namespace, Version: version,
		Info:  &release.Info{Status: status, Description: "revision " + strconv.Itoa(version)},
		Chart: &chart.Chart{Metadata: &chart.Metadata{Name: name + "-chart", Version: "1.0." + strconv.Itoa(version), AppVersion: "2.0"}},
	})
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name: secretName, Namespace: namespace, UID: types.UID("uid-" + namespace + "-" + secretName),
			Labels: map[string]string{"owner": "helm", "name": name, "status": string(status), "version": strconv.Itoa(version)},
		},
		Type: "helm.sh/release.v1",
		Data: map[string][]byte{"release": []byte(base64.StdEncoding.EncodeToString(payload))},
	}
}

// helmRows maps each served release to its revision and status.
func helmRows(t *testing.T, h *ingestHarness, scope string) map[string]string {
	t.Helper()
	snap, err := h.subsystem.SnapshotService.Build(context.Background(), "namespace-helm", "c1|"+scope)
	require.NoError(t, err)
	payload, ok := snap.Payload.(snapshot.NamespaceHelmSnapshot)
	require.True(t, ok, "payload %T", snap.Payload)
	rows := make(map[string]string, len(payload.Rows))
	for _, row := range payload.Rows {
		rows[row.Ref.Namespace+"/"+row.Ref.Name] = fmt.Sprintf("%d %s", row.Revision, row.Status)
	}
	return rows
}

// awaitHelmRows reads the release table after each ring on sub until a read
// serves want.
func awaitHelmRows(t *testing.T, h *ingestHarness, sub *resourcestream.Subscription, scope string, want map[string]string) {
	t.Helper()
	deadline := time.After(10 * time.Second)
	var last map[string]string
	for {
		select {
		case <-sub.Updates:
			last = helmRows(t, h, scope)
			if maps.Equal(last, want) {
				return
			}
		case <-deadline:
			t.Fatalf("namespace-helm %s: no ring was followed by a read serving %v (last read %v)", scope, want, last)
		}
	}
}

// Install, upgrade, rollback, and uninstall each reach the release table
// through the Secrets reflector, and the read each doorbell triggers shows the
// release's current revision.
func TestHelmReleaseLifecycleReachesTheReleaseTable(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "").ingestHarness()
	scope := "namespace:team-a"
	sub := h.subscribe(t, "namespace-helm", scope)

	server.Create(t, helmRevision("team-a", "web", 1, release.StatusDeployed))
	awaitHelmRows(t, h, sub, scope, map[string]string{"team-a/web": "1 deployed"})

	server.Update(t, helmRevision("team-a", "web", 1, release.StatusSuperseded))
	server.Create(t, helmRevision("team-a", "web", 2, release.StatusDeployed))
	awaitHelmRows(t, h, sub, scope, map[string]string{"team-a/web": "2 deployed"})

	server.Update(t, helmRevision("team-a", "web", 2, release.StatusSuperseded))
	server.Create(t, helmRevision("team-a", "web", 3, release.StatusDeployed))
	awaitHelmRows(t, h, sub, scope, map[string]string{"team-a/web": "3 deployed"})

	for version := 1; version <= 3; version++ {
		server.Delete(t, helmRevision("team-a", "web", version, release.StatusSuperseded))
	}
	awaitHelmRows(t, h, sub, scope, map[string]string{})
}

// A revision Secret relabeled to another release leaves its old release and
// joins the new one.
func TestHelmRevisionMovingBetweenReleasesUpdatesBoth(t *testing.T) {
	h := newIngestHarness(t)
	secrets := h.store(t, secretGVR)
	sub := h.subscribe(t, "namespace-helm", "namespace:team-a")
	stored := helmRevisionStoredAs("team-a", "release-record", "web", 1, release.StatusDeployed)
	stored.ResourceVersion = "1"
	require.NoError(t, secrets.Add(stored))
	awaitHelmRows(t, h, sub, "namespace:team-a", map[string]string{"team-a/web": "1 deployed"})

	moved := helmRevisionStoredAs("team-a", "release-record", "api", 1, release.StatusDeployed)
	moved.ResourceVersion = "2"
	require.NoError(t, secrets.Update(moved))
	awaitHelmRows(t, h, sub, "namespace:team-a", map[string]string{"team-a/api": "1 deployed"})
}

// A relist after a watch gap carries several releases' changes at once,
// including a release whose every revision was deleted, which the relist only
// omits. Each affected namespace rings once, after the table holds the
// relisted set; an unchanged namespace stays quiet and keeps its release.
func TestHelmRelistRingsEachAffectedScopeOnce(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "").ingestHarness()
	server.Create(t, helmRevision("team-a", "web", 1, release.StatusDeployed))
	server.Create(t, helmRevision("team-b", "db", 1, release.StatusSuperseded))
	server.Create(t, helmRevision("team-b", "db", 2, release.StatusDeployed))
	server.Create(t, helmRevision("team-c", "cache", 1, release.StatusDeployed))
	require.Eventually(t, func() bool { return len(helmRows(t, h, "namespace:all")) == 3 }, 10*time.Second, 20*time.Millisecond)
	teamA := h.subscribe(t, "namespace-helm", "namespace:team-a")
	teamB := h.subscribe(t, "namespace-helm", "namespace:team-b")
	teamC := h.subscribe(t, "namespace-helm", "namespace:team-c")

	server.WatchGap(t, func() {
		server.Update(t, helmRevision("team-a", "web", 1, release.StatusSuperseded))
		server.Create(t, helmRevision("team-a", "web", 2, release.StatusDeployed))
		server.Delete(t, helmRevision("team-b", "db", 1, release.StatusSuperseded))
		server.Delete(t, helmRevision("team-b", "db", 2, release.StatusDeployed))
	})

	for _, ring := range []struct {
		sub   *resourcestream.Subscription
		scope string
		want  map[string]string
	}{
		{teamA, "namespace:team-a", map[string]string{"team-a/web": "2 deployed"}},
		{teamB, "namespace:team-b", map[string]string{}},
	} {
		select {
		case <-ring.sub.Updates:
		case <-time.After(10 * time.Second):
			t.Fatalf("%s never rang after the relist", ring.scope)
		}
		require.Equal(t, ring.want, helmRows(t, h, ring.scope), "%s: the read the ring triggered", ring.scope)
		require.Equal(t, 0, collect(ring.sub, 300*time.Millisecond), "%s rang more than once", ring.scope)
	}
	require.Equal(t, 0, collect(teamC, 100*time.Millisecond), "an unchanged namespace rang")
	require.Equal(t, map[string]string{"team-c/cache": "1 deployed"}, helmRows(t, h, "namespace:team-c"))
}

// A re-warm resumes the Secrets watch from its spilled resourceVersion and
// receives no Secret events (the releases existed at the last list), yet
// serves every unchanged release.
func TestHelmReleasesSurviveARewarmWithoutSecretChanges(t *testing.T) {
	server := newReflectorAPIServer(t)
	server.Create(t, helmRevision("team-a", "web", 1, release.StatusDeployed))
	server.Create(t, helmRevision("team-b", "db", 1, release.StatusDeployed))
	before := newReflectorHarness(t, server, "")
	require.Eventually(t, func() bool { return len(helmRows(t, before.ingestHarness(), "namespace:all")) == 2 }, 10*time.Second, 20*time.Millisecond)
	spill := t.TempDir()
	require.NoError(t, before.subsystem.IngestManager.SpillStores(spill))
	before.stop()

	after := newReflectorHarness(t, server, spill)
	require.Equal(t, map[string]string{"team-a/web": "1 deployed", "team-b/db": "1 deployed"}, helmRows(t, after.ingestHarness(), "namespace:all"))
}

// A re-warm whose spilled resourceVersion expired relists the Secrets, and
// the release table follows the relisted set: a release upgraded and one
// uninstalled while the cluster was Cold.
func TestHelmRewarmAfterExpiredVersionServesTheRelistedReleases(t *testing.T) {
	server := newReflectorAPIServer(t)
	before := newReflectorHarness(t, server, "")
	server.Create(t, helmRevision("team-a", "web", 1, release.StatusDeployed))
	server.Create(t, helmRevision("team-b", "db", 1, release.StatusDeployed))
	require.Eventually(t, func() bool { return len(helmRows(t, before.ingestHarness(), "namespace:all")) == 2 }, 10*time.Second, 20*time.Millisecond)
	spill := t.TempDir()
	require.NoError(t, before.subsystem.IngestManager.SpillStores(spill))
	before.stop()
	server.WatchGap(t, func() {
		server.Update(t, helmRevision("team-a", "web", 1, release.StatusSuperseded))
		server.Create(t, helmRevision("team-a", "web", 2, release.StatusDeployed))
		server.Delete(t, helmRevision("team-b", "db", 1, release.StatusDeployed))
	})

	after := newReflectorHarness(t, server, spill)
	require.Eventually(t, func() bool {
		return maps.Equal(helmRows(t, after.ingestHarness(), "namespace:all"), map[string]string{"team-a/web": "2 deployed"})
	}, 10*time.Second, 20*time.Millisecond)
}

// An identity scoped to team-a, with no cluster-wide Secret access, sees the
// Helm releases in team-a: Helm follows the Secrets partitions.
func TestScopedIdentitySeesHelmReleasesInItsNamespaces(t *testing.T) {
	h := newIngestHarnessReviewing(t, func(attrs authorizationv1.ResourceAttributes) bool {
		if attrs.Group == "" && (attrs.Resource == "secrets" || attrs.Resource == "configmaps") {
			return attrs.Namespace == "team-a"
		}
		return true
	}, "team-a")
	secrets := h.store(t, secretGVR)
	stored := helmRevision("team-a", "web", 1, release.StatusDeployed)
	stored.ResourceVersion = "1"
	require.NoError(t, secrets.PartitionView("team-a").Replace([]interface{}{stored}, "1"))

	require.Equal(t, map[string]string{"team-a/web": "1 deployed"}, helmRows(t, h, "namespace:team-a"))
}
