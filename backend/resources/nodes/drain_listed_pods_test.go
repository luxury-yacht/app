/*
 * backend/resources/nodes/drain_listed_pods_test.go
 *
 * A drain only ever removes the pods it listed. A StatefulSet can recreate a pod
 * under the same name on another node while the drain runs, and that replacement
 * must be left alone. These run the real kubectl drain helper; the fake clients do
 * not evaluate preconditions, so they assert what is sent to the API server.
 */

package nodes_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	policyv1beta1 "k8s.io/api/policy/v1beta1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
)

const drainPodNamespace = "frontend"

var (
	drainPodsGVR = schema.GroupVersionResource{Version: "v1", Resource: "pods"}
	drainPodsGVK = schema.GroupVersionKind{Version: "v1", Kind: "Pod"}
)

type podRemoval struct {
	name string
	uid  string
}

type podRemovalMode struct {
	name    string
	options types.DrainNodeOptions
	// evictionVersion is the policy version discovery advertises, when not v1.
	evictionVersion string
}

func drainOptionsFor(disableEviction, skipWait bool) types.DrainNodeOptions {
	return types.DrainNodeOptions{
		DisableEviction:            disableEviction,
		DeleteEmptyDirData:         true,
		IgnoreDaemonSets:           true,
		SkipWaitForPodsToTerminate: skipWait,
	}
}

func podRemovalModes() []podRemovalMode {
	return []podRemovalMode{
		{name: "evict and wait", options: drainOptionsFor(false, false)},
		{name: "evict without waiting", options: drainOptionsFor(false, true)},
		{name: "evict through policy/v1beta1", options: drainOptionsFor(false, true), evictionVersion: "v1beta1"},
		{name: "delete and wait", options: drainOptionsFor(true, false)},
		{name: "delete without waiting", options: drainOptionsFor(true, true)},
	}
}

func applyRemovalMode(t *testing.T, client *fake.Clientset, mode podRemovalMode) {
	t.Helper()
	if mode.evictionVersion == "" {
		return
	}
	discoveryClient, ok := client.Discovery().(*fakediscovery.FakeDiscovery)
	require.True(t, ok, "expected fake discovery client")
	discoveryClient.Resources[0].APIResources[0].Version = mode.evictionVersion
}

func evictionTarget(object runtime.Object) (string, *metav1.DeleteOptions) {
	switch eviction := object.(type) {
	case *policyv1.Eviction:
		return eviction.Name, eviction.DeleteOptions
	case *policyv1beta1.Eviction:
		return eviction.Name, eviction.DeleteOptions
	}
	return "", nil
}

func preconditionUID(options *metav1.DeleteOptions) string {
	if options == nil || options.Preconditions == nil || options.Preconditions.UID == nil {
		return ""
	}
	return string(*options.Preconditions.UID)
}

// removalFrom reads one recorded action as a pod removal.
func removalFrom(action cgotesting.Action) (podRemoval, bool) {
	if action.GetResource().Resource != "pods" {
		return podRemoval{}, false
	}
	switch typed := action.(type) {
	case cgotesting.DeleteAction:
		options := typed.GetDeleteOptions()
		return podRemoval{name: typed.GetName(), uid: preconditionUID(&options)}, true
	case cgotesting.CreateAction:
		if action.GetSubresource() != "eviction" {
			return podRemoval{}, false
		}
		name, options := evictionTarget(typed.GetObject())
		return podRemoval{name: name, uid: preconditionUID(options)}, true
	}
	return podRemoval{}, false
}

func podRemovals(client *fake.Clientset) []podRemoval {
	removals := []podRemoval{}
	for _, action := range client.Actions() {
		if removal, ok := removalFrom(action); ok {
			removals = append(removals, removal)
		}
	}
	return removals
}

// answerEvictions has the fake do what the API server would: an accepted eviction
// removes the pod. A name answer returns non-nil is refused with that error instead.
func answerEvictions(client *fake.Clientset, refuse func(name string) error) {
	client.Fake.PrependReactor("create", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		create, ok := action.(cgotesting.CreateAction)
		if !ok || action.GetSubresource() != "eviction" {
			return false, nil, nil
		}
		name, _ := evictionTarget(create.GetObject())
		if err := refuse(name); err != nil {
			return true, nil, err
		}
		return true, create.GetObject(), client.Tracker().Delete(drainPodsGVR, drainPodNamespace, name)
	})
}

func refuseDeletes(client *fake.Clientset, refuse func(name string) error) {
	client.Fake.PrependReactor("delete", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		if err := refuse(action.(cgotesting.DeleteAction).GetName()); err != nil {
			return true, nil, err
		}
		return false, nil, nil
	})
}

func acceptAll(string) error { return nil }

func recreatePodElsewhere(t *testing.T, client *fake.Clientset, name string) {
	t.Helper()
	replacement := testsupport.PodFixture(drainPodNamespace, name)
	replacement.UID = "uid-replacement"
	replacement.Spec.NodeName = "node-2"
	require.NoError(t, client.Tracker().Update(drainPodsGVR, replacement, drainPodNamespace))
}

func requirePodReplaced(t *testing.T, client *fake.Clientset, name string) {
	t.Helper()
	current, err := client.Tracker().Get(drainPodsGVR, drainPodNamespace, name)
	require.NoError(t, err, "the replacement must not be removed")
	require.Equal(t, "uid-replacement", string(current.(*corev1.Pod).UID))
}

func TestServiceDrainBindsEveryPodRemovalToTheListedPod(t *testing.T) {
	for _, mode := range podRemovalModes() {
		t.Run(mode.name, func(t *testing.T) {
			service, client, node := newNodeService(t)
			addNodePatchReactor(t, client)
			applyRemovalMode(t, client, mode)
			answerEvictions(client, acceptAll)

			require.NoError(t, service.Drain(context.Background(), node.Name, "", mode.options))

			require.ElementsMatch(t, []podRemoval{
				{name: "app-0", uid: "uid-app-0"},
				{name: "app-1", uid: "uid-app-1"},
			}, podRemovals(client))
		})
	}
}

func TestServiceDrainLeavesAPodRecreatedAfterTheList(t *testing.T) {
	for _, mode := range podRemovalModes() {
		t.Run(mode.name, func(t *testing.T) {
			service, client, node := newNodeService(t)
			addNodePatchReactor(t, client)
			applyRemovalMode(t, client, mode)
			answerEvictions(client, acceptAll)
			client.Fake.PrependReactor("list", "pods", func(cgotesting.Action) (bool, runtime.Object, error) {
				listed, err := client.Tracker().List(drainPodsGVR, drainPodsGVK, "")
				recreatePodElsewhere(t, client, "app-0")
				return true, listed, err
			})

			require.NoError(t, service.Drain(context.Background(), node.Name, "", mode.options))

			require.Equal(t, []podRemoval{{name: "app-1", uid: "uid-app-1"}}, podRemovals(client))
			requirePodReplaced(t, client, "app-0")
		})
	}
}

// The pod is replaced after the last check and before the API server handles the
// request. The server refuses with 409, or 429 when a disruption budget is involved.
func TestServiceDrainCountsARefusalCausedByAReplacementAsRemoved(t *testing.T) {
	refusals := map[string]error{
		"conflict":          apierrors.NewConflict(corev1.Resource("pods"), "app-0", nil),
		"too many requests": apierrors.NewTooManyRequests("the disruption budget is exhausted", 0),
	}
	for _, mode := range podRemovalModes() {
		for refusalName, refusal := range refusals {
			t.Run(mode.name+" answered "+refusalName, func(t *testing.T) {
				service, client, node := newNodeService(t)
				addNodePatchReactor(t, client)
				applyRemovalMode(t, client, mode)
				refuseOnce := func(name string) error {
					if name != "app-0" {
						return nil
					}
					recreatePodElsewhere(t, client, name)
					return refusal
				}
				answerEvictions(client, refuseOnce)
				refuseDeletes(client, refuseOnce)

				// kubectl retries a 429 for as long as its context lives.
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()

				require.NoError(t, service.Drain(ctx, node.Name, "", mode.options))

				require.Equal(t, 1, countRemovalsOf(client, "app-0"), "the replacement must not be targeted again")
				requirePodReplaced(t, client, "app-0")
			})
		}
	}
}

func countRemovalsOf(client *fake.Clientset, name string) int {
	count := 0
	for _, removal := range podRemovals(client) {
		if removal.name == name {
			count++
		}
	}
	return count
}

func TestServiceDrainStillFailsWhenTheListedPodRefusesRemoval(t *testing.T) {
	for _, mode := range podRemovalModes() {
		t.Run(mode.name, func(t *testing.T) {
			service, client, node := newNodeService(t)
			addNodePatchReactor(t, client)
			applyRemovalMode(t, client, mode)
			refuse := func(name string) error {
				return apierrors.NewConflict(corev1.Resource("pods"), name, nil)
			}
			answerEvictions(client, refuse)
			refuseDeletes(client, refuse)

			err := service.Drain(context.Background(), node.Name, "", mode.options)

			require.Error(t, err, "a refusal about the listed pod is a real failure")
			pods, listErr := client.CoreV1().Pods(drainPodNamespace).List(context.Background(), metav1.ListOptions{})
			require.NoError(t, listErr)
			require.Len(t, pods.Items, 2)
		})
	}
}

func runDrainToCompletion(
	t *testing.T,
	ctx context.Context,
	service *nodes.Service,
	store *nodemaintenance.Store,
	nodeName, uid string,
	options types.DrainNodeOptions,
) nodemaintenance.DrainJob {
	t.Helper()
	completed := make(chan struct{})
	job, err := service.StartDrainWithCompletion(ctx, nodeName, uid, options, func(string) { close(completed) })
	require.NoError(t, err)
	select {
	case <-completed:
	case <-time.After(10 * time.Second):
		t.Fatal("the drain never finished")
	}
	finished, ok := store.JobForCluster(job.ID, job.ClusterID)
	require.True(t, ok)
	return finished
}

// kubectl formats a cancelled drain's errors without wrapping them, and words them
// as a timeout, so its error alone cannot say the user cancelled.
func TestServiceDrainReportsACancelledDrainAsCancelled(t *testing.T) {
	service, store, client, node := newNodeServiceWithStore(t)
	addNodePatchReactor(t, client)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	answerEvictions(client, func(string) error {
		cancel()
		return apierrors.NewTooManyRequests("the disruption budget is exhausted", 0)
	})
	timeout := 300
	options := drainOptionsFor(false, false)
	options.TimeoutSeconds = &timeout

	job := runDrainToCompletion(t, ctx, service, store, node.Name, "", options)

	require.Equal(t, nodemaintenance.DrainStatusCancelled, job.Status, "got: %s", job.Message)
	for _, event := range job.Events {
		require.NotRegexp(t, "timed out|timeout", event.Message, "nothing timed out; the user cancelled")
	}
}

const drainablePodList = `{"kind":"PodList","apiVersion":"v1","items":[{"metadata":{"name":"app-0","namespace":"frontend","uid":"uid-app-0",` +
	`"ownerReferences":[{"apiVersion":"apps/v1","kind":"ReplicaSet","name":"app","uid":"uid-rs","controller":true}]},"spec":{"nodeName":"node-1"}}]}`

// kubectl's eviction check takes no context, so without help Cancel cannot end it
// and the job stays active, refusing any new drain of that node.
func TestCancellingADrainInterruptsItsEvictionSupportCheck(t *testing.T) {
	for _, mode := range []podRemovalMode{
		{name: "evict and wait", options: drainOptionsFor(false, false)},
		{name: "evict without waiting", options: drainOptionsFor(false, true)},
	} {
		t.Run(mode.name, func(t *testing.T) {
			discoveryStarted := make(chan struct{})
			var once sync.Once
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.URL.Path == "/api/v1":
					once.Do(func() { close(discoveryStarted) })
					<-r.Context().Done()
				case strings.HasSuffix(r.URL.Path, "/pods"):
					fmt.Fprint(w, drainablePodList)
				default:
					fmt.Fprint(w, `{}`)
				}
			}))
			t.Cleanup(func() {
				server.CloseClientConnections()
				server.Close()
			})
			client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL, QPS: -1})
			require.NoError(t, err)
			store := nodemaintenance.NewStore(5)
			service := nodes.NewService(testsupport.NewResourceDependencies(
				testsupport.WithDepsKubeClient(client),
				testsupport.WithDepsLogger(applog.Noop),
			), store)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			go func() {
				<-discoveryStarted
				cancel()
			}()

			job := runDrainToCompletion(t, ctx, service, store, "node-1", "", mode.options)

			require.Equal(t, nodemaintenance.DrainStatusCancelled, job.Status, "got: %s", job.Message)
		})
	}
}

func TestServiceDrainDoesNotClaimAReplacedNodeIsStillCordoned(t *testing.T) {
	service, store, client, node := newNodeServiceWithStore(t)
	addNodePatchReactor(t, client)
	nodeWithUID(t, client, node, "uid-replacement")

	job := runDrainToCompletion(t, context.Background(), service, store, node.Name, "uid-selected", skipWaitDrainOptions())

	require.Equal(t, nodemaintenance.DrainStatusFailed, job.Status)
	for _, event := range job.Events {
		require.NotEqual(t, nodemaintenance.DrainPhaseCordonRetained, event.Phase, "the node it cordoned is gone")
	}
}

// kubectl treats any 404 as the pod being gone, but an admission webhook can answer
// 404 about something else while the pod is still running.
func TestServiceDrainFailsWhenA404IsNotAboutTheListedPod(t *testing.T) {
	for _, mode := range podRemovalModes() {
		t.Run(mode.name, func(t *testing.T) {
			service, client, node := newNodeService(t)
			addNodePatchReactor(t, client)
			applyRemovalMode(t, client, mode)
			refuse := func(string) error {
				return apierrors.NewNotFound(corev1.Resource("configmaps"), "required-config")
			}
			answerEvictions(client, refuse)
			refuseDeletes(client, refuse)

			// Counted as removed, kubectl would wait on these pods for as long as ctx lives.
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			err := service.Drain(ctx, node.Name, "", mode.options)

			require.Error(t, err, "the pods are still running")
			require.NoError(t, ctx.Err(), "the drain should fail, not wait on pods that were never removed")
			pods, listErr := client.CoreV1().Pods(drainPodNamespace).List(context.Background(), metav1.ListOptions{})
			require.NoError(t, listErr)
			require.Len(t, pods.Items, 2)
		})
	}
}

const evictionSupportedResources = `{"kind":"APIResourceList","groupVersion":"v1","resources":[{"name":"pods/eviction","singularName":"","namespaced":true,"group":"policy","version":"v1","kind":"Eviction","verbs":["create"]}]}`

// kubectl checks its timer before evicting. A slow read after that check must not
// let the eviction go out once the drain's timeout has passed.
func TestServiceDrainSubmitsNoEvictionAfterItsTimeout(t *testing.T) {
	var evictions atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v1":
			fmt.Fprint(w, evictionSupportedResources)
		case strings.HasSuffix(r.URL.Path, "/eviction"):
			evictions.Add(1)
			fmt.Fprint(w, `{"kind":"Status","apiVersion":"v1","status":"Success"}`)
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/pods/app-0"):
			select {
			case <-r.Context().Done():
			case <-time.After(1500 * time.Millisecond):
				fmt.Fprint(w, `{"metadata":{"name":"app-0","namespace":"frontend","uid":"uid-app-0"}}`)
			}
		case strings.HasSuffix(r.URL.Path, "/pods"):
			fmt.Fprint(w, drainablePodList)
		default:
			fmt.Fprint(w, `{}`)
		}
	}))
	t.Cleanup(func() {
		server.CloseClientConnections()
		server.Close()
	})
	client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL, QPS: -1})
	require.NoError(t, err)
	store := nodemaintenance.NewStore(5)
	service := nodes.NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
	), store)
	timeout := 1
	options := drainOptionsFor(false, false)
	options.TimeoutSeconds = &timeout

	job := runDrainToCompletion(t, context.Background(), service, store, "node-1", "", options)
	time.Sleep(700 * time.Millisecond) // past the read the stub holds open

	require.Equal(t, nodemaintenance.DrainStatusFailed, job.Status, "got: %s", job.Message)
	require.Zero(t, evictions.Load(), "the eviction went out after the timeout")
}

// A plain 404 on the read is an unserved endpoint or a proxy, not a missing pod, so
// the removal still goes out, bound to the listed UID.
func TestServiceDrainDoesNotCountAPlain404ReadAsThePodBeingGone(t *testing.T) {
	for _, mode := range podRemovalModes() {
		t.Run(mode.name, func(t *testing.T) {
			service, client, node := newNodeService(t)
			addNodePatchReactor(t, client)
			applyRemovalMode(t, client, mode)
			answerEvictions(client, acceptAll)
			client.Fake.PrependReactor("get", "pods", func(cgotesting.Action) (bool, runtime.Object, error) {
				return true, nil, apierrors.NewGenericServerResponse(404, "GET", corev1.Resource("pods"), "app-0", "404 page not found", 0, true)
			})

			require.NoError(t, service.Drain(context.Background(), node.Name, "", mode.options))

			require.ElementsMatch(t, []podRemoval{
				{name: "app-0", uid: "uid-app-0"},
				{name: "app-1", uid: "uid-app-1"},
			}, podRemovals(client))
		})
	}
}

// A webhook that times out reports "context deadline exceeded" in its own words,
// seconds into a drain whose timeout is minutes away.
func TestServiceDrainOnlyReportsATimeoutWhenItsTimeoutPassed(t *testing.T) {
	service, store, client, node := newNodeServiceWithStore(t)
	addNodePatchReactor(t, client)
	refuseDeletes(client, func(name string) error {
		return apierrors.NewInternalError(fmt.Errorf("failed to call webhook: context deadline exceeded"))
	})
	timeout := 300
	options := drainOptionsFor(true, false)
	options.TimeoutSeconds = &timeout

	job := runDrainToCompletion(t, context.Background(), service, store, node.Name, "", options)

	require.Equal(t, nodemaintenance.DrainStatusFailed, job.Status)
	require.NotContains(t, job.Message, "drain timed out")
}
