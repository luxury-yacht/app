package system

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes/fake"
)

type recordingHelmManifestProvider struct {
	fullObjectDetailProvider
	namespace string
	name      string
}

func (p *recordingHelmManifestProvider) FetchHelmManifest(_ context.Context, namespace, name string) (string, int, error) {
	p.namespace, p.name = namespace, name
	return "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n", 3, nil
}

// The registered object-map domain reads release manifests through the
// cluster's object detail provider, so a Helm release panel's Map tab builds.
func TestObjectMapRegistrationBuildsHelmReleaseMaps(t *testing.T) {
	client := fake.NewClientset()
	factory := informer.New(context.Background(), client, nil, 0, permissions.NewChecker(client, "cluster-a", time.Minute))
	registry := domain.New()
	provider := &recordingHelmManifestProvider{}
	registrations := domainRegistrations(context.Background(), registrationDeps{
		registry:        registry,
		informerFactory: factory,
		cfg:             Config{ClusterID: "cluster-a", ObjectDetailsProvider: provider},
	})
	require.NoError(t, findRegistration(t, registrations, "object-map").direct())

	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: "cluster-a"})
	_, err := registry.Build(ctx, "object-map", "cluster-a|default:helm.sh/v3:HelmRelease:shop")

	require.NoError(t, err)
	require.Equal(t, "default", provider.namespace)
	require.Equal(t, "shop", provider.name)
}
