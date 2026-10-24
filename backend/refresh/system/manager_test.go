package system

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	cgotesting "k8s.io/client-go/testing"
)

func TestNewPermissionInfrastructureDisablesWatchList(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, true)

	checker, grants, err := newPermissionInfrastructure(Config{
		KubernetesClient:  kubernetesfake.NewClientset(),
		AllowedNamespaces: []string{"default"},
	})

	require.NoError(t, err)
	require.NotNil(t, checker)
	require.NotNil(t, grants)
	require.False(t, clientfeatures.FeatureGates().Enabled(clientfeatures.WatchListClient))
}

func TestRegisterWorkloadReflectorsRejectsMissingRequiredStore(t *testing.T) {
	mgr := ingest.NewIngestManager(
		streamrows.ClusterMeta{ClusterID: "cluster-a"},
		kubernetesfake.NewClientset(),
		nil,
		nil,
	)
	meta := snapshot.ClusterMeta{ClusterID: "cluster-a"}
	require.True(t, mgr.RegisterReflector(snapshot.JobGVR, snapshot.JobGVK, snapshot.NewJobIngestProjector(meta), false))

	err := registerWorkloadReflectors(mgr, meta)

	require.ErrorContains(t, err, "Job")
}

func TestNewSubsystemRecordsPermissionIssuesOnAuthorizationFailure(t *testing.T) {
	client := kubernetesfake.NewClientset()
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("ssar denied")
	})

	dynScheme := testsupport.NewScheme(t)
	dyn := dynamicfake.NewSimpleDynamicClient(dynScheme)

	cfg := Config{
		KubernetesClient:    client,
		RestConfig:          &rest.Config{},
		MetricsInterval:     time.Millisecond,
		APIExtensionsClient: apiextensionsfake.NewClientset(),
		DynamicClient:       dyn,
		ObjectDetailsProvider: noopObjectDetailProvider{
			err: snapshot.ErrObjectDetailNotImplemented,
		},
		Logger:               applog.Noop,
		NodeMaintenanceStore: nodemaintenance.NewStore(5),
	}

	manager, recorder, issues, cache, grants, err := NewSubsystem(cfg)

	require.NoError(t, err)
	require.NotNil(t, manager)
	require.NotNil(t, recorder)
	require.NotEmpty(t, issues)
	require.Nil(t, cache)
	require.NotNil(t, grants)
}

type noopObjectDetailProvider struct {
	err error
}

func (p noopObjectDetailProvider) FetchObjectDetails(context.Context, schema.GroupVersionKind, string, string) (snapshot.ObjectDetail, error) {
	return snapshot.ObjectDetail{}, p.err
}

// NewSubsystem is the tuple-unpacking convenience over NewSubsystemWithServices,
// kept in test scope: production uses NewSubsystemWithServices directly.
// NewSubsystem prepares the refresh manager and supporting services.
func NewSubsystem(cfg Config) (*refresh.Manager, *telemetry.Recorder, []PermissionIssue, map[string]bool, *permissions.Grants, error) {
	subsystem, err := NewSubsystemWithServices(context.Background(), cfg)
	if err != nil {
		recorder := telemetry.NewRecorder()
		recorder.SetClusterMeta(cfg.ClusterID, cfg.ClusterName)
		return nil, recorder, nil, nil, nil, err
	}
	return subsystem.Manager,
		subsystem.Telemetry,
		subsystem.PermissionIssues,
		nil,
		subsystem.PermissionGrants,
		nil
}
