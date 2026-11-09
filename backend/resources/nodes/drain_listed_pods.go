/*
 * backend/resources/nodes/drain_listed_pods.go
 *
 * Holds a drain to the pods it listed. A StatefulSet can recreate a pod under the
 * same name on another node while the drain runs. The kubectl drain helper removes
 * pods by namespace and name and has no hook for its requests, so its client is
 * wrapped once the pods are listed.
 */

package nodes

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	policyv1beta1 "k8s.io/api/policy/v1beta1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/kubernetes"
	typedcorev1 "k8s.io/client-go/kubernetes/typed/core/v1"
	typedpolicyv1 "k8s.io/client-go/kubernetes/typed/policy/v1"
	typedpolicyv1beta1 "k8s.io/client-go/kubernetes/typed/policy/v1beta1"
	kubectldrain "k8s.io/kubectl/pkg/drain"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resources/common"
)

// listedPodsClient binds every pod removal the drain helper sends to the UID it
// listed. A pod whose name now belongs to another pod counts as removed: the helper
// is told NotFound, which it already treats as the pod being gone.
type listedPodsClient struct {
	kubernetes.Interface
	uids map[types.NamespacedName]types.UID
}

func clientForListedPods(ctx context.Context, client kubernetes.Interface, pods []corev1.Pod, usesEviction bool) (kubernetes.Interface, error) {
	uids := make(map[types.NamespacedName]types.UID, len(pods))
	for _, pod := range pods {
		uids[types.NamespacedName{Namespace: pod.Namespace, Name: pod.Name}] = pod.UID
	}
	if usesEviction && len(pods) > 0 {
		fetched, err := withCoreResourcesFetched(ctx, client)
		if err != nil {
			return nil, err
		}
		client = fetched
	}
	return listedPodsClient{Interface: client, uids: uids}, nil
}

// CheckEvictionSupport is kubectl's check, ended by ctx.
func CheckEvictionSupport(ctx context.Context, client kubernetes.Interface) (schema.GroupVersion, error) {
	fetched, err := withCoreResourcesFetched(ctx, client)
	if err != nil {
		return schema.GroupVersion{}, err
	}
	return kubectldrain.CheckEvictionSupport(fetched)
}

// coreGroupVersion is the API group kubectl's eviction check asks about.
const coreGroupVersion = "v1"

// withCoreResourcesFetched does the lookup kubectl's eviction check needs, under
// ctx. kubectl's own lookup takes no context and client-go applies no timeout to a
// shared client, so nothing else could stop it on a cluster that stops answering.
func withCoreResourcesFetched(ctx context.Context, client kubernetes.Interface) (kubernetes.Interface, error) {
	resources, err := client.Discovery().ServerResourcesForGroupVersionWithContext(ctx, coreGroupVersion)
	if err != nil {
		return nil, err
	}
	return fetchedCoreResourcesClient{Interface: client, resources: resources}, nil
}

type fetchedCoreResourcesClient struct {
	kubernetes.Interface
	resources *metav1.APIResourceList
}

func (c fetchedCoreResourcesClient) Discovery() discovery.DiscoveryInterfaces {
	return fetchedCoreResources{DiscoveryInterfaces: c.Interface.Discovery(), resources: c.resources}
}

type fetchedCoreResources struct {
	discovery.DiscoveryInterfaces
	resources *metav1.APIResourceList
}

func (d fetchedCoreResources) ServerResourcesForGroupVersion(groupVersion string) (*metav1.APIResourceList, error) {
	if groupVersion == coreGroupVersion {
		return d.resources, nil
	}
	return d.DiscoveryInterfaces.ServerResourcesForGroupVersion(groupVersion)
}

// remove sends one removal attempt for a listed pod. It reads the pod first because
// an eviction spends the replacement's disruption budget before the API server looks
// at the UID. It reads again after any refusal, because neither a 429 nor a 404 says
// which pod it was about; only the pod's current UID can.
func (c listedPodsClient) remove(ctx context.Context, namespace, name string, send func(*metav1.Preconditions) error) error {
	uid := c.uids[types.NamespacedName{Namespace: namespace, Name: name}]
	if c.listedPodGone(ctx, namespace, name, uid) {
		return apierrors.NewNotFound(corev1.Resource("pods"), name)
	}
	err := send(common.DeleteOptionsForUID(string(uid)).Preconditions)
	if err == nil {
		return nil
	}
	if c.listedPodGone(ctx, namespace, name, uid) {
		return apierrors.NewNotFound(corev1.Resource("pods"), name)
	}
	if apierrors.IsNotFound(err) {
		// A webhook's 404 about something else. kubectl would count the pod as removed.
		return fmt.Errorf("pod %s/%s was not removed: %s", namespace, name, err.Error())
	}
	return err
}

// listedPodGone reports whether the name is confirmed to no longer hold the listed
// pod. Any other failed read proves nothing, so the request still goes out bound to
// the UID.
func (c listedPodsClient) listedPodGone(ctx context.Context, namespace, name string, uid types.UID) bool {
	pod, err := c.Interface.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return errorstatus.ConfirmsObjectAbsent(err, corev1.Resource("pods"), name)
	}
	return pod.UID != uid
}

func (c listedPodsClient) CoreV1() typedcorev1.CoreV1Interface {
	return listedPodsCoreV1{CoreV1Interface: c.Interface.CoreV1(), client: c}
}

func (c listedPodsClient) PolicyV1() typedpolicyv1.PolicyV1Interface {
	return listedPodsPolicyV1{PolicyV1Interface: c.Interface.PolicyV1(), client: c}
}

func (c listedPodsClient) PolicyV1beta1() typedpolicyv1beta1.PolicyV1beta1Interface {
	return listedPodsPolicyV1beta1{PolicyV1beta1Interface: c.Interface.PolicyV1beta1(), client: c}
}

type listedPodsCoreV1 struct {
	typedcorev1.CoreV1Interface
	client listedPodsClient
}

func (c listedPodsCoreV1) Pods(namespace string) typedcorev1.PodInterface {
	return listedPodsPods{PodInterface: c.CoreV1Interface.Pods(namespace), namespace: namespace, client: c.client}
}

type listedPodsPods struct {
	typedcorev1.PodInterface
	namespace string
	client    listedPodsClient
}

// Get guards the poll kubectl uses to wait for a pod to end, which counts any 404 as
// the pod being gone.
func (p listedPodsPods) Get(ctx context.Context, name string, options metav1.GetOptions) (*corev1.Pod, error) {
	pod, err := p.PodInterface.Get(ctx, name, options)
	if apierrors.IsNotFound(err) && !errorstatus.ConfirmsObjectAbsent(err, corev1.Resource("pods"), name) {
		return pod, fmt.Errorf("could not confirm pod %s/%s has ended: %s", p.namespace, name, err.Error())
	}
	return pod, err
}

func (p listedPodsPods) Delete(ctx context.Context, name string, options metav1.DeleteOptions) error {
	return p.client.remove(ctx, p.namespace, name, func(preconditions *metav1.Preconditions) error {
		options.Preconditions = preconditions
		return p.PodInterface.Delete(ctx, name, options)
	})
}

type listedPodsPolicyV1 struct {
	typedpolicyv1.PolicyV1Interface
	client listedPodsClient
}

func (c listedPodsPolicyV1) Evictions(namespace string) typedpolicyv1.EvictionInterface {
	return listedPodsEvictionsV1{EvictionInterface: c.PolicyV1Interface.Evictions(namespace), client: c.client}
}

type listedPodsEvictionsV1 struct {
	typedpolicyv1.EvictionInterface
	client listedPodsClient
}

func (e listedPodsEvictionsV1) Evict(ctx context.Context, eviction *policyv1.Eviction) error {
	return e.client.remove(ctx, eviction.Namespace, eviction.Name, func(preconditions *metav1.Preconditions) error {
		eviction.DeleteOptions.Preconditions = preconditions
		return e.EvictionInterface.Evict(ctx, eviction)
	})
}

type listedPodsPolicyV1beta1 struct {
	typedpolicyv1beta1.PolicyV1beta1Interface
	client listedPodsClient
}

func (c listedPodsPolicyV1beta1) Evictions(namespace string) typedpolicyv1beta1.EvictionInterface {
	return listedPodsEvictionsV1beta1{EvictionInterface: c.PolicyV1beta1Interface.Evictions(namespace), client: c.client}
}

type listedPodsEvictionsV1beta1 struct {
	typedpolicyv1beta1.EvictionInterface
	client listedPodsClient
}

func (e listedPodsEvictionsV1beta1) Evict(ctx context.Context, eviction *policyv1beta1.Eviction) error {
	return e.client.remove(ctx, eviction.Namespace, eviction.Name, func(preconditions *metav1.Preconditions) error {
		eviction.DeleteOptions.Preconditions = preconditions
		return e.EvictionInterface.Evict(ctx, eviction)
	})
}
