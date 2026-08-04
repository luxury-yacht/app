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
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/internal/sentryreporting"
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

// ResourceRequestOperation converts a package-owned resource identity into the
// closed telemetry schema. Namespace and object names are intentionally not
// accepted.
func ResourceRequestOperation(
	action string,
	identity resourcekind.Identity,
) sentryreporting.Operation {
	scope := sentryreporting.KubernetesScopeCluster
	if identity.Namespaced {
		scope = sentryreporting.KubernetesScopeNamespaced
	}
	return sentryreporting.NewKubernetesRequestOperation(sentryreporting.KubernetesRequest{
		Action:   sentryreporting.KubernetesAction(action),
		Group:    identity.Group,
		Version:  identity.Version,
		Resource: identity.Resource,
		Scope:    scope,
	})
}

// DynamicResourceRequestOperation is the equivalent path for discovery-backed
// or non-built-in resources whose identity is known only at runtime.
func DynamicResourceRequestOperation(
	action string,
	group string,
	version string,
	resource string,
	subresource string,
	namespaced bool,
) sentryreporting.Operation {
	scope := sentryreporting.KubernetesScopeCluster
	if namespaced {
		scope = sentryreporting.KubernetesScopeNamespaced
	}
	return sentryreporting.NewKubernetesRequestOperation(sentryreporting.KubernetesRequest{
		Action:      sentryreporting.KubernetesAction(action),
		Group:       group,
		Version:     version,
		Resource:    resource,
		Subresource: subresource,
		Scope:       scope,
	})
}

// LogResourceRequestFailure is the normal built-in-resource reporting path.
func (d Dependencies) LogResourceRequestFailure(
	err error,
	what string,
	action string,
	identity resourcekind.Identity,
	source ...string,
) {
	d.LogRequestFailure(err, what, ResourceRequestOperation(action, identity), source...)
}

func (d Dependencies) LogDynamicResourceRequestFailure(
	err error,
	what string,
	action string,
	group string,
	version string,
	resource string,
	subresource string,
	namespaced bool,
	source ...string,
) {
	d.LogRequestFailure(
		err,
		what,
		DynamicResourceRequestOperation(action, group, version, resource, subresource, namespaced),
		source...,
	)
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
	d.Logger = applog.OperationScoped(d.Logger, applog.OperationIDFromContext(ctx))
	return d
}

// LogRequestFailure records a failed Kubernetes API call as "<what>: <err>".
//
// Cancellation is an expected lifecycle event — the panel closed, the user
// navigated away, or the cluster disconnected — so it is logged for debugging
// rather than raised as an application error. Only ERROR entries are forwarded
// to error reporting, so this keeps routine cancellations out of Sentry while
// every real failure still gets there.
func (d Dependencies) LogRequestFailure(
	err error,
	what string,
	operation sentryreporting.Operation,
	source ...string,
) {
	if errors.Is(err, context.Canceled) {
		applog.Debug(d.Logger, fmt.Sprintf("%s: %v", what, err), source...)
		return
	}
	applog.ReportErrorWithOperation(d.Logger, err, what, operation, source...)
}

// LogOperationalFailure preserves a cause when no privacy-reviewed operation
// shape is available. It never promotes the human-readable message into the
// telemetry operation context.
func (d Dependencies) LogOperationalFailure(err error, what string, source ...string) {
	if errors.Is(err, context.Canceled) {
		applog.Debug(d.Logger, fmt.Sprintf("%s: %v", what, err), source...)
		return
	}
	applog.ReportError(d.Logger, err, what, source...)
}
