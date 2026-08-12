package app

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// Option customises App construction for tests.
type Option func(context.Context, *builder) context.Context

type builder struct {
	client     kubernetes.Interface
	apiExt     *apiextensionsclientset.Clientset
	dynamic    dynamic.Interface
	metrics    *metricsclient.Clientset
	restConfig *rest.Config
}

// WithContext sets the application context.
func WithContext(ctx context.Context) Option {
	return func(_ context.Context, _ *builder) context.Context {
		return ctx
	}
}

// WithKubeClient injects the supplied Kubernetes client. Note that
// InitializeForTesting will start the refresh subsystem when the client is
// non-nil, matching production wiring.
func WithKubeClient(client kubernetes.Interface) Option {
	return func(ctx context.Context, b *builder) context.Context {
		b.client = client
		return ctx
	}
}

// WithEnsureClient sets the EnsureClient callback used by the wrapped App.
// WithAPIExtensions injects the apiextensions clientset used by CRD handlers.
func WithAPIExtensions(client *apiextensionsclientset.Clientset) Option {
	return func(ctx context.Context, b *builder) context.Context {
		b.apiExt = client
		return ctx
	}
}

// WithDynamicClient injects a dynamic client for generic resource operations.
func WithDynamicClient(client dynamic.Interface) Option {
	return func(ctx context.Context, b *builder) context.Context {
		b.dynamic = client
		return ctx
	}
}

// WithMetricsClient injects the metrics client to avoid lazy initialisation.
func WithMetricsClient(client *metricsclient.Clientset) Option {
	return func(ctx context.Context, b *builder) context.Context {
		b.metrics = client
		return ctx
	}
}

// WithRestConfig provides the REST config used to instantiate dynamic/metrics clients.
func WithRestConfig(config *rest.Config) Option {
	return func(ctx context.Context, b *builder) context.Context {
		b.restConfig = config
		return ctx
	}
}

// New constructs a backend App pre-configured for unit testing.
func New(t testing.TB, opts ...Option) *backend.App {
	t.Helper()

	b := builder{}
	appCtx := context.Background()
	for _, opt := range opts {
		appCtx = opt(appCtx, &b)
	}

	app := backend.NewApp(nil)
	if appCtx == nil {
		appCtx = context.Background()
	}
	backend.InitializeForTesting(app, appCtx, b.client)

	if b.restConfig != nil {
		backend.SetRestConfigForTest(app, b.restConfig)
	}
	if b.metrics != nil {
		backend.SetMetricsClientForTest(app, b.metrics)
	}
	if b.apiExt != nil {
		backend.SetApiExtensionsClientForTest(app, b.apiExt)
	}
	if b.dynamic != nil {
		backend.SetDynamicClientForTest(app, b.dynamic)
	}

	return app
}
