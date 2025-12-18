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
type Option func(*builder)

type builder struct {
	ctx        context.Context
	client     kubernetes.Interface
	apiExt     *apiextensionsclientset.Clientset
	dynamic    dynamic.Interface
	metrics    *metricsclient.Clientset
	restConfig *rest.Config
}

// WithContext sets the application context.
func WithContext(ctx context.Context) Option {
	return func(b *builder) {
		b.ctx = ctx
	}
}

// WithKubeClient injects the supplied Kubernetes client. Note that
// InitializeForTesting will start the refresh subsystem when the client is
// non-nil, matching production wiring.
func WithKubeClient(client kubernetes.Interface) Option {
	return func(b *builder) {
		b.client = client
	}
}

// WithEnsureClient sets the EnsureClient callback used by the wrapped App.
// WithAPIExtensions injects the apiextensions clientset used by CRD handlers.
func WithAPIExtensions(client *apiextensionsclientset.Clientset) Option {
	return func(b *builder) {
		b.apiExt = client
	}
}

// WithDynamicClient injects a dynamic client for generic resource operations.
func WithDynamicClient(client dynamic.Interface) Option {
	return func(b *builder) {
		b.dynamic = client
	}
}

// WithMetricsClient injects the metrics client to avoid lazy initialisation.
func WithMetricsClient(client *metricsclient.Clientset) Option {
	return func(b *builder) {
		b.metrics = client
	}
}

// WithRestConfig provides the REST config used to instantiate dynamic/metrics clients.
func WithRestConfig(config *rest.Config) Option {
	return func(b *builder) {
		b.restConfig = config
	}
}

// New constructs a backend App pre-configured for unit testing.
func New(t testing.TB, opts ...Option) *backend.App {
	t.Helper()

	b := builder{
		ctx: context.Background(),
	}
	for _, opt := range opts {
		opt(&b)
	}

	app := backend.NewApp()
	appCtx := b.ctx
	if appCtx == nil {
		appCtx = context.Background()
	}
	app.InitializeForTesting(appCtx, b.client)

	if b.restConfig != nil {
		app.SetRestConfig(b.restConfig)
	}
	if b.metrics != nil {
		app.SetMetricsClient(b.metrics)
	}
	if b.apiExt != nil {
		app.SetApiExtensionsClient(b.apiExt)
	}
	if b.dynamic != nil {
		app.SetDynamicClient(b.dynamic)
	}

	return app
}
