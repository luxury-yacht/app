package testsupport

import (
	"context"

	"github.com/luxury-yacht/app/backend/resources/common"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// DependenciesOption customises construction of common.Dependencies.
type DependenciesOption func(*dependenciesBuilder)

type dependenciesBuilder struct {
	ctx                 context.Context
	logger              common.Logger
	kubeClient          kubernetes.Interface
	metricsClient       metricsclient.Interface
	setMetrics          func(metricsclient.Interface)
	dynamicClient       dynamic.Interface
	apiExtClient        apiextensionsclientset.Interface
	restConfig          *rest.Config
	ensureClient        common.EnsureClientFunc
	ensureAPIExtensions common.EnsureAPIExtensionsFunc
	selectedKubeconfig  string
	selectedContext     string
}

// WithDepsContext overrides the context embedded in Dependencies.
func WithDepsContext(ctx context.Context) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.ctx = ctx
	}
}

// WithDepsLogger sets the logger used by resource services.
func WithDepsLogger(logger common.Logger) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.logger = logger
	}
}

// WithDepsKubeClient injects the Kubernetes client.
func WithDepsKubeClient(client kubernetes.Interface) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.kubeClient = client
	}
}

// WithDepsMetricsClient injects the metrics client.
func WithDepsMetricsClient(client metricsclient.Interface) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.metricsClient = client
	}
}

// WithDepsSetMetrics overrides the SetMetricsClient callback.
func WithDepsSetMetrics(setter func(metricsclient.Interface)) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.setMetrics = setter
	}
}

// WithDepsDynamicClient injects the dynamic client.
func WithDepsDynamicClient(client dynamic.Interface) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.dynamicClient = client
	}
}

// WithDepsAPIExtensions injects the apiextensions client.
func WithDepsAPIExtensions(client apiextensionsclientset.Interface) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.apiExtClient = client
	}
}

// WithDepsRestConfig sets the REST config.
func WithDepsRestConfig(config *rest.Config) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.restConfig = config
	}
}

// WithDepsEnsureClient overrides the ensure client callback.
func WithDepsEnsureClient(fn common.EnsureClientFunc) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.ensureClient = fn
	}
}

// WithDepsEnsureAPIExtensions overrides the API extensions ensure callback.
func WithDepsEnsureAPIExtensions(fn common.EnsureAPIExtensionsFunc) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.ensureAPIExtensions = fn
	}
}

// WithDepsSelection seeds the kubeconfig/context selection metadata.
func WithDepsSelection(configPath, contextName string) DependenciesOption {
	return func(b *dependenciesBuilder) {
		b.selectedKubeconfig = configPath
		b.selectedContext = contextName
	}
}

// NewResourceDependencies returns a fully-populated Dependencies bundle suitable for resource services.
func NewResourceDependencies(opts ...DependenciesOption) common.Dependencies {
	builder := dependenciesBuilder{
		ctx:          context.Background(),
		setMetrics:   func(metricsclient.Interface) {},
		ensureClient: func(string) error { return nil },
		ensureAPIExtensions: func(string) error {
			return nil
		},
	}
	for _, opt := range opts {
		opt(&builder)
	}

	return common.Dependencies{
		Context:             builder.ctx,
		Logger:              builder.logger,
		KubernetesClient:    builder.kubeClient,
		MetricsClient:       builder.metricsClient,
		SetMetricsClient:    builder.setMetrics,
		DynamicClient:       builder.dynamicClient,
		APIExtensionsClient: builder.apiExtClient,
		RestConfig:          builder.restConfig,
		EnsureClient:        builder.ensureClient,
		EnsureAPIExtensions: builder.ensureAPIExtensions,
		SelectedKubeconfig:  builder.selectedKubeconfig,
		SelectedContext:     builder.selectedContext,
	}
}
