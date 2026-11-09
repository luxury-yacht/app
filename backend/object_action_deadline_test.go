/*
 * backend/object_action_deadline_test.go
 *
 * A batch waits for each object action before starting another, behind a dialog
 * that cannot be dismissed. So every action it runs must end, with a clear answer,
 * even when the cluster never responds. These use a real client against a stub
 * server, because the fake clients never see a request's context.
 */

package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	clienttesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

type sentRequest struct {
	method      string
	path        string
	remaining   time.Duration
	hasDeadline bool
}

// sentRequests records the deadline on every request a real client sends.
type sentRequests struct {
	mu   sync.Mutex
	sent []sentRequest
	next http.RoundTripper
}

func (r *sentRequests) RoundTrip(request *http.Request) (*http.Response, error) {
	deadline, hasDeadline := request.Context().Deadline()
	r.mu.Lock()
	r.sent = append(r.sent, sentRequest{
		method:      request.Method,
		path:        request.URL.Path,
		remaining:   time.Until(deadline),
		hasDeadline: hasDeadline,
	})
	r.mu.Unlock()
	return r.next.RoundTrip(request)
}

func (r *sentRequests) snapshot() []sentRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]sentRequest{}, r.sent...)
}

func isClusterWrite(request sentRequest) bool {
	return request.method != http.MethodGet && !strings.HasSuffix(request.path, "selfsubjectaccessreviews")
}

func answerStubRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch {
	case strings.HasSuffix(r.URL.Path, "selfsubjectaccessreviews"):
		fmt.Fprint(w, `{"status":{"allowed":true}}`)
	case r.Method == http.MethodDelete:
		fmt.Fprint(w, `{"kind":"Status","apiVersion":"v1","status":"Success"}`)
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/nodes/node"):
		fmt.Fprint(w, `{"metadata":{"name":"node","uid":"uid-node"}}`)
	default:
		fmt.Fprint(w, `{}`)
	}
}

func stubbedClusterFixture(t *testing.T) (*resourceGatewayFixture, *sentRequests) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(answerStubRequest))
	t.Cleanup(server.Close)
	recorder := &sentRequests{}
	restConfig := &rest.Config{
		Host: server.URL,
		QPS:  -1,
		WrapTransport: func(next http.RoundTripper) http.RoundTripper {
			recorder.next = next
			return recorder
		},
	}
	client, err := kubernetes.NewForConfig(restConfig)
	require.NoError(t, err)
	dynamicClient, err := dynamic.NewForConfig(restConfig)
	require.NoError(t, err)

	app := wrapperResourceGatewayFixture(t)
	app.clusters = map[string]*clusterClients{
		uidGuardCluster: {
			meta:              ClusterMeta{ID: uidGuardCluster, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
			dynamicClient:     dynamicClient,
			restConfig:        restConfig,
		},
	}
	return app, recorder
}

func TestRunObjectActionNeverWaitsOnTheClusterWithoutADeadline(t *testing.T) {
	deployment := objectActionTarget(uidGuardCluster, "apps", "v1", "Deployment", "default", "demo")
	cronJob := objectActionTarget(uidGuardCluster, "batch", "v1", "CronJob", "default", "nightly")
	node := objectActionTarget(uidGuardCluster, "", "v1", "Node", "", "node")
	replicas := 2
	suspend := true

	cases := []struct {
		name    string
		request ObjectActionRequest
	}{
		{"delete pod", ObjectActionRequest{Action: ObjectActionDelete, Target: objectActionTarget(uidGuardCluster, "", "v1", "Pod", "default", "pod")}},
		{"delete node", ObjectActionRequest{Action: ObjectActionDelete, Target: node}},
		{"delete other kinds", ObjectActionRequest{Action: ObjectActionDelete, Target: objectActionTarget(uidGuardCluster, "", "v1", "ConfigMap", "default", "settings")}},
		{"restart", ObjectActionRequest{Action: ObjectActionRestart, Target: deployment}},
		{"scale", ObjectActionRequest{Action: ObjectActionScale, Target: deployment, Replicas: &replicas}},
		{"suspend", ObjectActionRequest{Action: ObjectActionSuspend, Target: cronJob, Suspend: &suspend}},
		{"cordon", ObjectActionRequest{Action: ObjectActionCordon, Target: node}},
		{"uncordon", ObjectActionRequest{Action: ObjectActionUncordon, Target: node}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, recorder := stubbedClusterFixture(t)

			_, err := app.gateway.RunObjectAction(tc.request)
			require.NoError(t, err)

			sent := recorder.snapshot()
			wrote := false
			for _, request := range sent {
				wrote = wrote || isClusterWrite(request)
				require.True(t, request.hasDeadline, "%s %s has no deadline", request.method, request.path)
				limit := config.ObjectActionRequestTimeout
				if strings.HasSuffix(request.path, "selfsubjectaccessreviews") {
					limit = config.PermissionCheckTimeout
				}
				require.LessOrEqual(t, request.remaining, limit, "%s %s", request.method, request.path)
			}
			require.True(t, wrote, "expected a write to the cluster, sent %v", sent)
		})
	}
}

// Starting a drain must return promptly, but the drain it starts runs for as long
// as the node takes, far past the deadline on the call that started it.
func TestStartDrainBoundsItsChecksButNotTheDrain(t *testing.T) {
	app, recorder := stubbedClusterFixture(t)
	target := objectActionTarget(uidGuardCluster, "", "v1", "Node", "", "node")
	target.UID = "uid-node"

	_, err := app.gateway.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionStartDrain, Target: target, DrainOptions: &DrainNodeOptions{},
	})
	require.NoError(t, err)

	var checks []sentRequest
	var cordon *sentRequest
	require.Eventually(t, func() bool {
		sent := recorder.snapshot()
		for index, request := range sent {
			if request.method == http.MethodPatch {
				checks, cordon = sent[:index], &request
				return true
			}
		}
		return false
	}, 5*time.Second, 5*time.Millisecond, "the drain never cordoned the node")

	require.False(t, cordon.hasDeadline, "the drain must not inherit the deadline on starting it")
	require.NotEmpty(t, checks)
	for _, check := range checks {
		require.True(t, check.hasDeadline, "%s %s must be bounded", check.method, check.path)
	}
}

func TestRunObjectActionSaysWhenTheClusterDidNotAnswer(t *testing.T) {
	app, client := uidGuardFixture(t, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod", Namespace: "default"}})
	client.PrependReactor("delete", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, &url.Error{Op: "Delete", URL: "https://cluster/pods/pod", Err: context.DeadlineExceeded}
	})

	_, err := app.gateway.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTarget(uidGuardCluster, "", "v1", "Pod", "default", "pod"),
	})

	status := errorstatus.Classify(err)
	require.Equal(t, errorstatus.ReasonDeadlineExceeded, status.Reason, "the batch stops starting objects on this reason")
	require.True(t, status.Expected, "a cluster that does not answer is not an application failure")
}

// A permission check is the first request of every action. When the cluster fails
// it, the reason must survive, or a cluster outage is reported as an app defect.
func TestRunObjectActionKeepsTheCauseOfAFailedPermissionCheck(t *testing.T) {
	app, client := uidGuardFixture(t, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod", Namespace: "default"}})
	client.PrependReactor("create", "selfsubjectaccessreviews", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewServiceUnavailable("the API server is restarting")
	})

	_, err := app.gateway.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTarget(uidGuardCluster, "", "v1", "Pod", "default", "pod"),
	})

	status := errorstatus.Classify(err)
	require.Equal(t, errorstatus.ReasonServiceUnavailable, status.Reason, "got: %s", status.Message)
	require.True(t, status.Expected, "a cluster outage is not an application failure")
}
