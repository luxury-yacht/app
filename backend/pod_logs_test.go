package backend

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	cgofake "k8s.io/client-go/kubernetes/fake"
	kubescheme "k8s.io/client-go/kubernetes/scheme"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
	restclient "k8s.io/client-go/rest"
	restfake "k8s.io/client-go/rest/fake"
)

// Previous logs read five containers at a time, each within its own timeout. A
// pod with many containers whose reads are slow but within that timeout loads
// every container, however long the reads take together.
func TestFetchContainerLogsReadsEveryContainerOfASlowPod(t *testing.T) {
	app := wrapperResourceGatewayFixture(t)
	clusterID := "config:ctx"
	const containerCount = 15
	synctest.Test(t, func(t *testing.T) {
		pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}}
		for i := range containerCount {
			pod.Spec.Containers = append(pod.Spec.Containers, corev1.Container{Name: fmt.Sprintf("c%d", i)})
		}
		// Each read answers after 12 s, within the 20 s per-container limit.
		client := &slowLogsClient{Clientset: cgofake.NewClientset(pod), delay: 12 * time.Second}
		app.clusters = map[string]*clusterClients{
			clusterID: {meta: ClusterMeta{ID: clusterID, Name: "ctx"}, kubeconfigPath: "/path", kubeconfigContext: "ctx", client: client},
		}

		resp := app.gateway.FetchContainerLogs(clusterID, ContainerLogsFetchRequest{
			Scope:    clusterID + "|default:/v1:pod:web",
			Previous: true,
		})

		if len(resp.Issues) != 0 {
			t.Fatalf("expected every container to be read, got issues %+v", resp.Issues)
		}
		if len(resp.Entries) != containerCount {
			t.Fatalf("expected %d entries, got %d (error %q)", containerCount, len(resp.Entries), resp.Error)
		}
	})
}

// slowLogsClient answers every pod log read after delay, or with the request's
// context error when it ends first.
type slowLogsClient struct {
	*cgofake.Clientset
	delay time.Duration
}

func (c *slowLogsClient) CoreV1() corev1client.CoreV1Interface {
	return slowLogsCore{CoreV1Interface: c.Clientset.CoreV1(), delay: c.delay}
}

type slowLogsCore struct {
	corev1client.CoreV1Interface
	delay time.Duration
}

func (c slowLogsCore) Pods(namespace string) corev1client.PodInterface {
	return slowLogsPods{PodInterface: c.CoreV1Interface.Pods(namespace), delay: c.delay}
}

type slowLogsPods struct {
	corev1client.PodInterface
	delay time.Duration
}

func (p slowLogsPods) GetLogs(string, *corev1.PodLogOptions) *restclient.Request {
	client := &restfake.RESTClient{
		GroupVersion:         corev1.SchemeGroupVersion,
		NegotiatedSerializer: kubescheme.Codecs.WithoutConversion(),
		VersionedAPIPath:     "/api/v1",
		Client: restfake.CreateHTTPClient(func(request *http.Request) (*http.Response, error) {
			select {
			case <-time.After(p.delay):
			case <-request.Context().Done():
				return nil, request.Context().Err()
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z previous run\n")),
			}, nil
		}),
	}
	return client.Request()
}
