/*
 * backend/resources/common/deps.go
 *
 * Shared dependency bundle for resource services.
 * - Carries clients, config, and helper callbacks.
 */

package common

import (
	"context"
	"errors"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/metrics/pkg/client/clientset/versioned"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
)

// EnsureClientFunc initialises core Kubernetes clients when required.
type EnsureClientFunc func(resourceKind string) error

// EnsureAPIExtensionsFunc initialises the API extensions client when required.
type EnsureAPIExtensionsFunc func(resourceKind string) error

// GatewayAPIPresence reports which Gateway API kinds are installed on a cluster.
type GatewayAPIPresence interface {
	AnyPresent() bool
	Has(kind string) bool
}

// VersionResolver returns the preferred served API version for a group/kind pair.
type VersionResolver interface {
	PreferredVersion(group, kind string) string
}

// Dependencies provides the common set of collaborators required by resource handlers.
type Dependencies struct {
	Context                context.Context
	Logger                 Logger
	KubernetesClient       kubernetes.Interface
	GatewayClient          gatewayversioned.Interface
	GatewayAPIPresence     GatewayAPIPresence
	GatewayVersionResolver VersionResolver
	MetricsClient          versioned.Interface
	SetMetricsClient       func(versioned.Interface)
	DynamicClient          dynamic.Interface
	APIExtensionsClient    clientset.Interface
	RestConfig             *rest.Config
	ResourceResolver       ResourceResolver
	EnsureClient           EnsureClientFunc
	EnsureAPIExtensions    EnsureAPIExtensionsFunc
	SelectedKubeconfig     string
	SelectedContext        string
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

// LogRequestFailure records a failed Kubernetes API call as "<what>: <err>".
//
// Cancellation is an expected lifecycle event — the panel closed, the user
// navigated away, or the cluster disconnected — so it is logged for debugging
// rather than raised as an application error. Only ERROR entries are forwarded
// to error reporting, so this keeps routine cancellations out of Sentry while
// every real failure still gets there.
func (d Dependencies) LogRequestFailure(err error, what string, source ...string) {
	message := fmt.Sprintf("%s: %v", what, err)
	if errors.Is(err, context.Canceled) {
		applog.Debug(d.Logger, message, source...)
		return
	}
	applog.Error(d.Logger, message, source...)
}
