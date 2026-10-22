package testsupport

import (
	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// DependenciesOption customises construction of common.Dependencies.
type DependenciesOption func(*dependenciesBuilder)

type dependenciesBuilder struct {
	logger        common.Logger
	kubeClient    kubernetes.Interface
	metricsClient metricsclient.Interface
	setMetrics    func(metricsclient.Interface)
	dynamicClient dynamic.Interface
	restConfig    *rest.Config
	ensureClient  common.EnsureClientFunc
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

// NewResourceDependencies returns a fully-populated Dependencies bundle suitable for resource services.
func NewResourceDependencies(opts ...DependenciesOption) common.Dependencies {
	builder := dependenciesBuilder{
		setMetrics: func(metricsclient.Interface) {
			// The default test dependency does not retain a metrics client.
		},
		ensureClient: func(string) error { return nil },
	}
	for _, opt := range opts {
		opt(&builder)
	}

	return common.Dependencies{
		Logger:              builder.logger,
		KubernetesClient:    builder.kubeClient,
		MetricsClient:       builder.metricsClient,
		SetMetricsClient:    builder.setMetrics,
		DynamicClient:       builder.dynamicClient,
		RestConfig:          builder.restConfig,
		EnsureClient:        builder.ensureClient,
		EnsureAPIExtensions: func(string) error { return nil },
	}
}
