/*
 * backend/resources/common/deps.go
 *
 * Shared dependency bundle for resource services.
 * - Carries clients, config, and helper callbacks.
 */

package common

import (
	"context"

	"k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/metrics/pkg/client/clientset/versioned"
)

// EnsureClientFunc initialises core Kubernetes clients when required.
type EnsureClientFunc func(resourceKind string) error

// EnsureAPIExtensionsFunc initialises the API extensions client when required.
type EnsureAPIExtensionsFunc func(resourceKind string) error

// Dependencies provides the common set of collaborators required by resource handlers.
type Dependencies struct {
	Context             context.Context
	Logger              Logger
	KubernetesClient    kubernetes.Interface
	MetricsClient       versioned.Interface
	SetMetricsClient    func(versioned.Interface)
	DynamicClient       dynamic.Interface
	APIExtensionsClient clientset.Interface
	RestConfig          *rest.Config
	EnsureClient        EnsureClientFunc
	EnsureAPIExtensions EnsureAPIExtensionsFunc
	SelectedKubeconfig  string
	SelectedContext     string
	// ClusterID uniquely identifies the cluster these dependencies belong to.
	// Used for multi-cluster isolation in resources like drain jobs.
	ClusterID string
	// ClusterName is the human-readable name for the cluster.
	ClusterName string
}

// CloneWithContext returns a shallow copy using the supplied context.
func (d Dependencies) CloneWithContext(ctx context.Context) Dependencies {
	d.Context = ctx
	return d
}
