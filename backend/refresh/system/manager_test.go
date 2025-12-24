package system

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	clientgotesting "k8s.io/client-go/testing"

	"helm.sh/helm/v3/pkg/action"
)

func TestNewSubsystemRequiresDynamicClient(t *testing.T) {
	cfg := Config{
		KubernetesClient:    kubernetesfake.NewClientset(),
		RestConfig:          &rest.Config{},
		ResyncInterval:      time.Millisecond,
		MetricsInterval:     time.Millisecond,
		APIExtensionsClient: apiextensionsfake.NewClientset(),
		HelmFactory:         dummyHelmFactory,
		ObjectDetailsProvider: noopObjectDetailProvider{
			err: snapshot.ErrObjectDetailNotImplemented,
		},
		Logger: stubLogger{},
	}

	manager, handler, recorder, _, cache, _, err := NewSubsystem(cfg)

	require.Error(t, err)
	require.Nil(t, manager)
	require.Nil(t, handler)
	require.NotNil(t, recorder)
	require.Nil(t, cache)
	require.Contains(t, err.Error(), "dynamic client")
}

func TestNewSubsystemRequiresHelmFactory(t *testing.T) {
	dyn := testsupport.NewDynamicClient(t, runtime.NewScheme())

	cfg := Config{
		KubernetesClient:    kubernetesfake.NewClientset(),
		RestConfig:          &rest.Config{},
		ResyncInterval:      time.Millisecond,
		MetricsInterval:     time.Millisecond,
		APIExtensionsClient: apiextensionsfake.NewClientset(),
		DynamicClient:       dyn,
		ObjectDetailsProvider: noopObjectDetailProvider{
			err: snapshot.ErrObjectDetailNotImplemented,
		},
		Logger: stubLogger{},
	}

	manager, handler, recorder, _, cache, _, err := NewSubsystem(cfg)

	require.Error(t, err)
	require.Nil(t, manager)
	require.Nil(t, handler)
	require.NotNil(t, recorder)
	require.Nil(t, cache)
	require.Contains(t, err.Error(), "helm factory")
}

func TestNewSubsystemRecordsPermissionIssuesOnAuthorizationFailure(t *testing.T) {
	client := kubernetesfake.NewClientset()
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("ssar denied")
	})

	dynScheme := testsupport.NewScheme(t)
	dyn := dynamicfake.NewSimpleDynamicClient(dynScheme)

	cfg := Config{
		KubernetesClient:    client,
		RestConfig:          &rest.Config{},
		ResyncInterval:      time.Millisecond,
		MetricsInterval:     time.Millisecond,
		APIExtensionsClient: apiextensionsfake.NewClientset(),
		DynamicClient:       dyn,
		HelmFactory:         dummyHelmFactory,
		ObjectDetailsProvider: noopObjectDetailProvider{
			err: snapshot.ErrObjectDetailNotImplemented,
		},
		Logger: stubLogger{},
		PermissionCache: map[string]bool{
			"metrics.k8s.io/nodes/list": false,
			"metrics.k8s.io/pods/list":  false,
		},
	}

	manager, handler, recorder, issues, cache, factory, err := NewSubsystem(cfg)

	require.NoError(t, err)
	require.NotNil(t, manager)
	require.NotNil(t, handler)
	require.NotNil(t, recorder)
	require.NotEmpty(t, issues)
	require.NotNil(t, cache)
	require.NotNil(t, factory)
	require.Contains(t, cache, "metrics.k8s.io/nodes/list")
	require.Contains(t, cache, "metrics.k8s.io/pods/list")
}

func TestHealthHandlerReflectsInformerSync(t *testing.T) {
	t.Run("returns 503 when informer not synced", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz/refresh", nil)
		rec := httptest.NewRecorder()

		HealthHandler(fakeInformerHub{synced: false})(rec, req)

		require.Equal(t, http.StatusServiceUnavailable, rec.Code)
		require.Contains(t, rec.Body.String(), "informers not yet synced")
	})

	t.Run("returns 200 when informer synced", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz/refresh", nil)
		rec := httptest.NewRecorder()

		HealthHandler(fakeInformerHub{synced: true})(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "ok", rec.Body.String())
	})
}

func dummyHelmFactory(string) (*action.Configuration, error) {
	return &action.Configuration{}, nil
}

type noopObjectDetailProvider struct {
	err error
}

func (p noopObjectDetailProvider) FetchObjectDetails(context.Context, string, string, string) (interface{}, string, error) {
	return nil, "", p.err
}

type stubLogger struct{}

func (stubLogger) Debug(string, ...string) {}
func (stubLogger) Info(string, ...string)  {}
func (stubLogger) Warn(string, ...string)  {}
func (stubLogger) Error(string, ...string) {}

type fakeInformerHub struct {
	synced bool
}

func (h fakeInformerHub) Start(context.Context) error { return nil }

func (h fakeInformerHub) HasSynced(context.Context) bool { return h.synced }

func (fakeInformerHub) Shutdown() error { return nil }
