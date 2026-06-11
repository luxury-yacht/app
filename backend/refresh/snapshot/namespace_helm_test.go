package snapshot

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	releasetime "helm.sh/helm/v3/pkg/time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func newHelmRelease(name, namespace string, version int, status release.Status, now time.Time) *release.Release {
	return &release.Release{
		Name:      name,
		Namespace: namespace,
		Version:   version,
		Chart: &chart.Chart{
			Metadata: &chart.Metadata{
				Name:       "nginx",
				Version:    "1.2.3",
				AppVersion: "2.0.0",
			},
		},
		Info: &release.Info{
			Status:        status,
			FirstDeployed: releasetime.Time{Time: now.Add(-2 * time.Hour)},
			LastDeployed:  releasetime.Time{Time: now.Add(-30 * time.Minute)},
			Description:   "Deployed successfully",
		},
	}
}

// helmReleaseSecret encodes a release the way helm's secrets storage driver
// does: json → gzip → base64 text under Data["release"], with the driver's
// type and labels.
func helmReleaseSecret(t *testing.T, rls *release.Release) *corev1.Secret {
	t.Helper()
	payload, err := json.Marshal(rls)
	require.NoError(t, err)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, err = gz.Write(payload)
	require.NoError(t, err)
	require.NoError(t, gz.Close())
	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())

	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("sh.helm.release.v1.%s.v%d", rls.Name, rls.Version),
			Namespace: rls.Namespace,
			Labels: map[string]string{
				"owner":   "helm",
				"name":    rls.Name,
				"version": strconv.Itoa(rls.Version),
				"status":  rls.Info.Status.String(),
			},
		},
		Type: helmReleaseSecretType,
		Data: map[string][]byte{"release": []byte(encoded)},
	}
}

func corruptHelmSecret(name, namespace string, version int, status release.Status) *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("sh.helm.release.v1.%s.v%d", name, version),
			Namespace: namespace,
			Labels: map[string]string{
				"owner":   "helm",
				"name":    name,
				"version": strconv.Itoa(version),
				"status":  status.String(),
			},
		},
		Type: helmReleaseSecretType,
		Data: map[string][]byte{"release": []byte("not-base64!!!")},
	}
}

func syncedHelmBuilder(t *testing.T, secrets ...*corev1.Secret) *NamespaceHelmBuilder {
	t.Helper()
	return &NamespaceHelmBuilder{
		secretLister:  testsupport.NewSecretLister(t, secrets...),
		secretsSynced: func() bool { return true },
	}
}

func TestNamespaceHelmBuilder(t *testing.T) {
	now := time.Now()

	builder := syncedHelmBuilder(t,
		// Older revision is corrupt on purpose: only the latest revision per
		// release may be decoded.
		corruptHelmSecret("app", "default", 1, release.StatusSuperseded),
		helmReleaseSecret(t, newHelmRelease("app", "default", 2, release.StatusDeployed, now)),
		// A release in another namespace must not leak into the scope.
		helmReleaseSecret(t, newHelmRelease("other", "staging", 1, release.StatusDeployed, now)),
		// Non-helm secrets are ignored.
		&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "plain", Namespace: "default"},
			Type:       corev1.SecretTypeOpaque,
		},
	)

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceHelmDomainName, snapshot.Domain)
	require.Equal(t, uint64(2), snapshot.Version)

	payload, ok := snapshot.Payload.(NamespaceHelmSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)

	entry := payload.Rows[0]
	require.Equal(t, "app", entry.Name)
	require.Equal(t, "nginx-1.2.3", entry.Chart)
	require.Equal(t, "2.0.0", entry.AppVersion)
	require.Equal(t, "deployed", entry.Status)
	require.Equal(t, "deployed", entry.StatusState)
	require.Equal(t, "ready", entry.StatusPresentation)
	require.Equal(t, "info.status", entry.StatusReason)
	require.Equal(t, 2, entry.Revision)
	require.Equal(t, "Deployed successfully", entry.Description)
	require.NotEmpty(t, entry.Age)
	require.NotEmpty(t, entry.Updated)
}

func TestNamespaceHelmBuilderAllNamespaces(t *testing.T) {
	now := time.Now()

	builder := syncedHelmBuilder(t,
		helmReleaseSecret(t, newHelmRelease("app-default", "default", 1, release.StatusDeployed, now)),
		// In-flight operations are current state and must appear.
		helmReleaseSecret(t, newHelmRelease("app-staging", "staging", 2, release.StatusPendingUpgrade, now)),
		// A release whose LATEST record is uninstalled (kept history) is gone.
		helmReleaseSecret(t, newHelmRelease("app-gone", "staging", 3, release.StatusUninstalled, now)),
	)

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceHelmSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)

	// Sorted namespace-then-name.
	require.Equal(t, "app-default", payload.Rows[0].Name)
	require.Equal(t, "default", payload.Rows[0].Namespace)
	require.Equal(t, "app-staging", payload.Rows[1].Name)
	require.Equal(t, "staging", payload.Rows[1].Namespace)
	require.Equal(t, "pending-upgrade", payload.Rows[1].Status)
}

func TestNamespaceHelmBuilderAllNamespacesCapsRows(t *testing.T) {
	now := time.Now()
	secrets := make([]*corev1.Secret, 0, config.SnapshotNamespaceHelmEntryLimit+1)
	for i := 0; i < config.SnapshotNamespaceHelmEntryLimit+1; i++ {
		rls := newHelmRelease(fmt.Sprintf("app-%04d", i), fmt.Sprintf("ns-%04d", i), 1, release.StatusDeployed, now)
		secrets = append(secrets, helmReleaseSecret(t, rls))
	}

	builder := syncedHelmBuilder(t, secrets...)

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceHelmSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, config.SnapshotNamespaceHelmEntryLimit)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotNamespaceHelmEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "Helm releases")
}

func TestNamespaceHelmBuilderQueryPage(t *testing.T) {
	now := time.Now()

	builder := syncedHelmBuilder(t,
		helmReleaseSecret(t, newHelmRelease("alpha", "default", 1, release.StatusDeployed, now)),
		helmReleaseSecret(t, newHelmRelease("beta", "default", 1, release.StatusDeployed, now)),
	)

	snapshot, err := builder.Build(
		context.Background(),
		"namespace:default?limit=1&sort=name&sortDirection=asc",
	)
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceHelmSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "alpha", payload.Rows[0].Name)
}

func TestNamespaceHelmBuilderSkipsCorruptLatestRecord(t *testing.T) {
	now := time.Now()

	builder := syncedHelmBuilder(t,
		corruptHelmSecret("broken", "default", 1, release.StatusDeployed),
		helmReleaseSecret(t, newHelmRelease("healthy", "default", 1, release.StatusDeployed, now)),
	)

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceHelmSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "healthy", payload.Rows[0].Name)
}

// See TestClusterEventsBuilderWaitsForCacheSync: an unsynced secrets informer
// must not produce a confident empty page; the build waits and errors on
// deadline.
func TestNamespaceHelmBuilderWaitsForCacheSync(t *testing.T) {
	builder := &NamespaceHelmBuilder{
		secretLister:  testsupport.NewSecretLister(t),
		secretsSynced: func() bool { return false },
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	snapshot, err := builder.Build(ctx, "namespace:default")
	require.Error(t, err)
	require.Nil(t, snapshot)
}
