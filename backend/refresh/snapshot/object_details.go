package snapshot

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	discoveryv1 "k8s.io/api/discovery/v1"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	objectDetailsDomain = "object-details"
	clusterScopeToken   = "__cluster__"
)

// ErrObjectDetailNotImplemented is returned when the provider does not support a kind.
var ErrObjectDetailNotImplemented = errors.New("object detail provider not implemented")

type objectDetailFetcher func(ctx context.Context, builder *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error)

// ObjectDetailProvider resolves rich object payloads for the object panel.
type ObjectDetailProvider interface {
	FetchObjectDetails(ctx context.Context, kind, namespace, name string) (interface{}, string, error)
}

// ObjectDetailsBuilder resolves Kubernetes objects for the object panel.
type ObjectDetailsBuilder struct {
	client   kubernetes.Interface
	apiExt   apiextensionsclientset.Interface
	provider ObjectDetailProvider
}

// ObjectDetailsSnapshotPayload is returned to the frontend.
type ObjectDetailsSnapshotPayload struct {
	ClusterMeta
	Details interface{} `json:"details"`
}

// RegisterObjectDetailsDomain wires the object-details domain into the registry.
func RegisterObjectDetailsDomain(
	reg *domain.Registry,
	client kubernetes.Interface,
	apiExt apiextensionsclientset.Interface,
	provider ObjectDetailProvider,
) error {
	if client == nil {
		return fmt.Errorf("kubernetes client is required for object details domain")
	}
	builder := &ObjectDetailsBuilder{
		client:   client,
		apiExt:   apiExt,
		provider: provider,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          objectDetailsDomain,
		BuildSnapshot: builder.Build,
	})
}

func (b *ObjectDetailsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	namespace, kind, name, err := parseObjectScope(scope)
	if err != nil {
		return nil, err
	}

	if b.provider != nil {
		if details, resourceVersion, err := b.provider.FetchObjectDetails(ctx, kind, namespace, name); err == nil {
			return b.buildSnapshot(ctx, scope, details, resourceVersion), nil
		} else if !errors.Is(err, ErrObjectDetailNotImplemented) {
			return nil, err
		}
	}

	fetcher, ok := objectDetailFetchers[strings.ToLower(kind)]
	if !ok {
		// Provide a minimal details payload rather than surfacing an error so the
		// frontend can render generic metadata for custom resources.
		details := map[string]string{
			"kind": cases.Title(language.English, cases.NoLower).String(kind),
			"name": name,
		}
		if namespace != "" {
			details["namespace"] = namespace
		}
		return b.buildSnapshot(ctx, scope, details, ""), nil
	}

	details, resourceVersion, err := fetcher(ctx, b, namespace, name)
	if err != nil {
		return nil, err
	}

	return b.buildSnapshot(ctx, scope, details, resourceVersion), nil
}

func (b *ObjectDetailsBuilder) buildSnapshot(ctx context.Context, scope string, details interface{}, resourceVersion string) *refresh.Snapshot {
	version := parseVersion(resourceVersion)

	return &refresh.Snapshot{
		Domain:  objectDetailsDomain,
		Scope:   scope,
		Version: version,
		Payload: ObjectDetailsSnapshotPayload{
			ClusterMeta: ClusterMetaFromContext(ctx),
			Details:     details,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: 1,
		},
	}
}

func parseObjectScope(scope string) (string, string, string, error) {
	if strings.TrimSpace(scope) == "" {
		return "", "", "", fmt.Errorf("object scope is required")
	}

	_, trimmed := refresh.SplitClusterScope(scope)
	parts := strings.SplitN(trimmed, ":", 3)
	if len(parts) != 3 {
		return "", "", "", fmt.Errorf("invalid object scope %q", trimmed)
	}

	namespace := parts[0]
	if namespace == clusterScopeToken {
		namespace = ""
	}

	kind := parts[1]
	name := parts[2]
	if name == "" {
		return "", "", "", fmt.Errorf("object name missing in scope %q", scope)
	}

	return namespace, kind, name, nil
}

func parseVersion(rv string) uint64 {
	if rv == "" {
		return 0
	}
	if v, err := strconv.ParseUint(rv, 10, 64); err == nil {
		return v
	}
	return 0
}

var objectDetailFetchers = map[string]objectDetailFetcher{
	"pod": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		pod, err := b.client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(pod)
	},
	"deployment": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		deployment, err := b.client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(deployment)
	},
	"daemonset": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		ds, err := b.client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(ds)
	},
	"statefulset": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		sts, err := b.client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(sts)
	},
	"job": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		job, err := b.client.BatchV1().Jobs(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(job)
	},
	"cronjob": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		cj, err := b.client.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(cj)
	},
	"service": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		svc, err := b.client.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(svc)
	},
	"configmap": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		cm, err := b.client.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(cm)
	},
	"secret": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		secret, err := b.client.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(secret)
	},
	"ingress": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		ing, err := b.client.NetworkingV1().Ingresses(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(ing)
	},
	"networkpolicy": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		np, err := b.client.NetworkingV1().NetworkPolicies(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(np)
	},
	"endpointslice": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		selector := labels.Set{discoveryv1.LabelServiceName: name}.AsSelector().String()
		list, err := b.client.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			return nil, "", err
		}
		if len(list.Items) == 0 {
			empty := &discoveryv1.EndpointSliceList{Items: []discoveryv1.EndpointSlice{}}
			return empty, empty.ResourceVersion, nil
		}
		return list, list.ResourceVersion, nil
	},
	"persistentvolumeclaim": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		pvc, err := b.client.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(pvc)
	},
	"persistentvolume": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		pv, err := b.client.CoreV1().PersistentVolumes().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(pv)
	},
	"storageclass": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		sc, err := b.client.StorageV1().StorageClasses().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(sc)
	},
	"serviceaccount": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		sa, err := b.client.CoreV1().ServiceAccounts(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(sa)
	},
	"role": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		role, err := b.client.RbacV1().Roles(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(role)
	},
	"rolebinding": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		rb, err := b.client.RbacV1().RoleBindings(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(rb)
	},
	"clusterrole": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		cr, err := b.client.RbacV1().ClusterRoles().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(cr)
	},
	"clusterrolebinding": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		crb, err := b.client.RbacV1().ClusterRoleBindings().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(crb)
	},
	"resourcequota": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		rq, err := b.client.CoreV1().ResourceQuotas(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(rq)
	},
	"limitrange": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		lr, err := b.client.CoreV1().LimitRanges(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(lr)
	},
	"horizontalpodautoscaler": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		hpa, err := b.client.AutoscalingV1().HorizontalPodAutoscalers(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(hpa)
	},
	"poddisruptionbudget": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
		pdb, err := b.client.PolicyV1().PodDisruptionBudgets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(pdb)
	},
	"namespace": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		ns, err := b.client.CoreV1().Namespaces().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(ns)
	},
	"node": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		node, err := b.client.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(node)
	},
	"ingressclass": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		ic, err := b.client.NetworkingV1().IngressClasses().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(ic)
	},
	"customresourcedefinition": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		if b.apiExt == nil {
			return nil, "", fmt.Errorf("apiextensions client not configured")
		}
		crd, err := b.apiExt.ApiextensionsV1().CustomResourceDefinitions().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(crd)
	},
	"mutatingwebhookconfiguration": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		mwc, err := b.client.AdmissionregistrationV1().MutatingWebhookConfigurations().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(mwc)
	},
	"validatingwebhookconfiguration": func(ctx context.Context, b *ObjectDetailsBuilder, _ string, name string) (interface{}, string, error) {
		vwc, err := b.client.AdmissionregistrationV1().ValidatingWebhookConfigurations().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return wrapKubernetesObject(vwc)
	},
}

func wrapKubernetesObject(obj metav1.Object) (interface{}, string, error) {
	if obj == nil {
		return nil, "", fmt.Errorf("object is nil")
	}
	return obj, obj.GetResourceVersion(), nil
}
