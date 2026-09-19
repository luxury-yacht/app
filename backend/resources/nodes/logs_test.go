package nodes

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

// nodeLogProxyPath / nodeLogProxyPathWithSinceTime build the expected proxy
// paths for assertions; production builds paths via nodeLogProxyPathWithOptions.
func nodeLogProxyPath(nodeName, sourcePath string) string {
	return nodeLogProxyPathWithOptions(nodeName, sourcePath, "", 0)
}

func nodeLogProxyPathWithSinceTime(nodeName, sourcePath, sinceTime string) string {
	return nodeLogProxyPathWithOptions(nodeName, sourcePath, sinceTime, 0)
}

func stubNodeFetchLogs(t *testing.T, responses map[string][]byte) {
	originalFetch := nodeLogFetchRawFunc
	originalProbe := nodeLogFetchProbeFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
		nodeLogFetchProbeFunc = originalProbe
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, absPath string) ([]byte, error) {
		if body, ok := responses[absPath]; ok {
			return body, nil
		}
		return nil, errors.New("unexpected path: " + absPath)
	}
	nodeLogFetchProbeFunc = func(_ context.Context, _ rest.Interface, absPath string, _ int) ([]byte, error) {
		if body, ok := responses[absPath]; ok {
			return body, nil
		}
		return nil, errors.New("unexpected path: " + absPath)
	}
}

func TestDiscoverLogsFindsReadableSourcesOneLevelBelowRoot(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                   []byte(`<!doctype html><pre><a href="journal/">journal/</a><a href="pods/">pods/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):           []byte(`<!doctype html><pre><a href="kubelet">kubelet</a><a href="containerd">containerd</a></pre>`),
		nodeLogProxyPath(nodeName, "pods/"):              []byte(`<!doctype html><pre><a href="kube-system/">kube-system/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/kubelet"):    []byte("kubelet log line"),
		nodeLogProxyPath(nodeName, "journal/containerd"): []byte("containerd log line"),
		nodeLogProxyPath(nodeName, "pods/kube-system/"):  []byte(`<!doctype html><pre><a href="coredns">coredns</a></pre>`),
	}
	stubNodeFetchLogs(t, responses)

	resp := service.DiscoverLogs(context.Background(), nodeName)
	require.True(t, resp.Supported)
	require.Empty(t, resp.Reason)
	require.Equal(t,
		[]string{"journal / containerd", "journal / kubelet"},
		[]string{resp.Sources[0].Label, resp.Sources[1].Label},
	)
	require.Equal(t, "journal/containerd", resp.Sources[0].Path)
	require.Equal(t, "journal/kubelet", resp.Sources[1].Path)
}

func TestDiscoverLogsSkipsCompressedSources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                       []byte(`<!doctype html><pre><a href="journal/">journal/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):               []byte(`<!doctype html><pre><a href="kubelet">kubelet</a><a href="kubelet.log.gz">kubelet.log.gz</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/kubelet"):        []byte("kubelet log line"),
		nodeLogProxyPath(nodeName, "journal/kubelet.log.gz"): []byte("compressed bytes"),
	}
	stubNodeFetchLogs(t, responses)

	resp := service.DiscoverLogs(context.Background(), nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/kubelet", resp.Sources[0].Path)
}

func TestDiscoverLogsSkipsBinaryJournalLeaves(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                                  []byte(`<!doctype html><pre><a href="journal/">journal/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):                          []byte(`<!doctype html><pre><a href="machine-id/">machine-id/</a><a href="kubelet">kubelet</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/machine-id/"):               []byte(`<!doctype html><pre><a href="system.journal">system.journal</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/machine-id/system.journal"): []byte{0x4c, 0x50, 0x4b, 0x53, 0x48, 0x48, 0x52, 0x48, 0x00, 0x01},
		nodeLogProxyPath(nodeName, "journal/kubelet"):                   []byte("kubelet log line"),
	}
	stubNodeFetchLogs(t, responses)

	resp := service.DiscoverLogs(context.Background(), nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/kubelet", resp.Sources[0].Path)
}

func TestDiscoverLogsSkipsPodAndContainerSources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                []byte(`<!doctype html><pre><a href="journal/">journal/</a><a href="pods/">pods/</a><a href="containers/">containers/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):        []byte(`<!doctype html><pre><a href="kubelet">kubelet</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/kubelet"): []byte("kubelet log line"),
	}
	stubNodeFetchLogs(t, responses)

	resp := service.DiscoverLogs(context.Background(), nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/kubelet", resp.Sources[0].Path)
}

func TestDiscoverLogsTraversesNestedJournalDirectories(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                                    []byte(`<!doctype html><pre><a href="journal/">journal/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):                            []byte(`<!doctype html><pre><a href="services/">services/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/services/"):                   []byte(`<!doctype html><pre><a href="kubernetes/">kubernetes/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/services/kubernetes/"):        []byte(`<!doctype html><pre><a href="kubelet">kubelet</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/services/kubernetes/kubelet"): []byte("kubelet log line"),
	}
	stubNodeFetchLogs(t, responses)

	resp := service.DiscoverLogs(context.Background(), nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/services/kubernetes/kubelet", resp.Sources[0].Path)
}

func TestDiscoverLogsIncludesWellKnownServiceQueries(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                    []byte(`<!doctype html><pre><a href="journal/">journal/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):            []byte(`<!doctype html><pre><a href="machine-id/">machine-id/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/machine-id/"): []byte(`<!doctype html><pre></pre>`),
		nodeLogProxyPath(nodeName, "service:kubelet"):     []byte("kubelet service log line"),
		nodeLogProxyPath(nodeName, "service:containerd"):  []byte("containerd service log line"),
		nodeLogProxyPath(nodeName, "service:crio"):        []byte(`<!doctype html><pre><a href="journal/">journal/</a></pre>`),
		nodeLogProxyPath(nodeName, "service:cri-o"):       []byte{0x00, 0xff, 0x10},
		nodeLogProxyPath(nodeName, "service:docker"):      nil,
	}
	stubNodeFetchLogs(t, responses)

	resp := service.DiscoverLogs(context.Background(), nodeName)
	require.True(t, resp.Supported)
	require.Contains(t, resp.Sources, restypes.NodeLogSource{
		ID:    "service:kubelet",
		Label: "services / kubelet",
		Kind:  "service",
		Path:  "service:kubelet",
	})
	require.Contains(t, resp.Sources, restypes.NodeLogSource{
		ID:    "service:containerd",
		Label: "services / containerd",
		Kind:  "service",
		Path:  "service:containerd",
	})
}

func TestDiscoverLogsReturnsReasonForForbiddenEndpoint(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		return nil, apierrors.NewForbidden(schema.GroupResource{Resource: "nodes"}, "node-a", errors.New("denied"))
	}

	resp := service.DiscoverLogs(context.Background(), "node-a")
	require.False(t, resp.Supported)
	require.Contains(t, resp.Reason, "not accessible")
}

func TestFetchLogsRejectsDirectorySources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		return []byte(`<!doctype html><pre><a href="kubelet">kubelet</a></pre>`), nil
	}

	resp := service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{SourcePath: "journal/"})
	require.Contains(t, resp.Error, "directory")
}

func TestFetchLogsRejectsCompressedSources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	resp := service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{SourcePath: "journal/kubelet.log.gz"})
	require.Contains(t, resp.Error, "compressed or binary")
}

func TestFetchLogsRejectsUnsafeSourcePaths(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})
	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		t.Fatalf("unsafe source path should be rejected before fetch")
		return nil, nil
	}

	for _, sourcePath := range []string{
		"journal/../kubelet",
		"journal/%2e%2e/kubelet",
		"journal/kubelet?tailLines=100000",
		"journal\\kubelet",
		"/api/v1/nodes/node-a/proxy/logs/journal/kubelet",
		"service:kubelet/../../pods",
	} {
		resp := service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{SourcePath: sourcePath})
		require.Contains(t, resp.Error, "invalid node log source path", sourcePath)
	}
}

func TestFetchLogsSupportsWellKnownServiceQueries(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, absPath string) ([]byte, error) {
		require.Equal(t, nodeLogProxyPath("node-a", "service:kubelet"), absPath)
		return []byte("kubelet service log line"), nil
	}

	resp := service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{SourcePath: "service:kubelet"})
	require.Empty(t, resp.Error)
	require.Equal(t, "kubelet service log line", resp.Content)
	require.Equal(t, "service", resp.Source.Kind)
	require.Equal(t, "services / kubelet", resp.Source.Label)
}

func TestFetchLogsForwardsSinceTimeQueryParameter(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	sinceTime := "2026-04-13T18:00:00Z"
	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, absPath string) ([]byte, error) {
		require.Equal(
			t,
			nodeLogProxyPathWithSinceTime("node-a", "journal/kubelet", sinceTime),
			absPath,
		)
		return []byte("kubelet log line"), nil
	}

	resp := service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{
		SourcePath: "journal/kubelet",
		SinceTime:  sinceTime,
	})
	require.Empty(t, resp.Error)
	require.Equal(t, "kubelet log line", resp.Content)
}

func TestNodeLogProxyPathWithSinceTimeSupportsServiceQueries(t *testing.T) {
	require.Equal(
		t,
		"/api/v1/nodes/node-a/proxy/logs/?query=kubelet&sinceTime=2026-04-13T18%3A00%3A00Z",
		nodeLogProxyPathWithSinceTime("node-a", "service:kubelet", "2026-04-13T18:00:00Z"),
	)
}

func TestFetchLogsRejectsBinaryBodiesWithoutBinaryExtension(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		return []byte{0x00, 0xff, 0x10, 0x1f, 0x00}, nil
	}

	resp := service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{SourcePath: "journal/opaque-leaf"})
	require.Contains(t, resp.Error, "compressed or binary")
}

func TestFetchLogsRejectsPodAndContainerSources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	resp := service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{SourcePath: "pods/kube-system/coredns"})
	require.Contains(t, resp.Error, "already available in the pod/workload logs views")

	resp = service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{SourcePath: "containers/containerd.log"})
	require.Contains(t, resp.Error, "already available in the pod/workload logs views")
}

func TestFetchLogsTruncatesLargeResponses(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		return []byte("line-a\nline-b\nline-c\n"), nil
	}

	resp := service.FetchLogs(context.Background(), "node-a", restypes.NodeLogFetchRequest{
		SourcePath: "journal/kubelet",
		TailBytes:  8,
	})
	require.True(t, resp.Truncated)
	require.Equal(t, "line-c\n", resp.Content)
}

func TestDiscoverLogsCompletesWhenEveryDirectoryBranches(t *testing.T) {
	nodeName := "branching-node"
	responses := map[string][]byte{}
	var roots strings.Builder
	for parent := range nodeLogDiscoveryWorkers {
		fmt.Fprintf(&roots, `<a href="dir%d/">dir</a>`, parent)
		var children strings.Builder
		for child := range 3 {
			fmt.Fprintf(&children, `<a href="child%d/">child</a>`, child)
			path := fmt.Sprintf("dir%d/child%d/", parent, child)
			responses[nodeLogProxyPath(nodeName, path)] = []byte(`<!doctype html><pre><a href="log">log</a></pre>`)
			responses[nodeLogProxyPath(nodeName, path+"log")] = []byte("node log line")
		}
		responses[nodeLogProxyPath(nodeName, fmt.Sprintf("dir%d/", parent))] = []byte("<!doctype html><pre>" + children.String() + "</pre>")
	}
	responses[nodeLogProxyPath(nodeName, "")] = []byte("<!doctype html><pre>" + roots.String() + "</pre>")
	stubNodeFetchLogs(t, responses)
	fetch := nodeLogFetchRawFunc
	var arrivals [2]atomic.Int32
	barriers := [2]chan struct{}{make(chan struct{}), make(chan struct{})}
	nodeLogFetchRawFunc = func(ctx context.Context, client rest.Interface, path string) ([]byte, error) {
		for stage := range barriers {
			if !strings.HasSuffix(path, fmt.Sprintf("/child%d/", stage)) {
				continue
			}
			if arrivals[stage].Add(1) == nodeLogDiscoveryWorkers {
				close(barriers[stage])
			}
			select {
			case <-barriers[stage]:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return fetch(ctx, client, path)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsKubeClient(fake.NewClientset())))
	done := make(chan restypes.NodeLogDiscoveryResponse, 1)
	go func() { done <- service.DiscoverLogs(ctx, nodeName) }()
	select {
	case response := <-done:
		require.True(t, response.Supported, response.Reason)
		require.Len(t, response.Sources, nodeLogDiscoveryWorkers*3)
	case <-ctx.Done():
		t.Fatal("node log discovery blocked while directory workers queued their children")
	}
}

func TestDiscoverLogsKeepsSourceLimitAndDeduplicatesPaths(t *testing.T) {
	nodeName := "limited-node"
	responses := map[string][]byte{}
	var root strings.Builder
	root.WriteString(`<a href="deep/">deep</a><a href="deep/">duplicate</a>`)
	for i := range maxNodeLogDiscoveryNodes + 10 {
		path := fmt.Sprintf("log%d", i)
		fmt.Fprintf(&root, `<a href="%s">log</a><a href="%s">duplicate</a>`, path, path)
		responses[nodeLogProxyPath(nodeName, path)] = []byte("line")
	}
	responses[nodeLogProxyPath(nodeName, "")] = []byte("<!doctype html><pre>" + root.String() + "</pre>")
	for depth := 1; depth <= maxNodeLogDiscoveryDepth; depth++ {
		path := strings.Repeat("deep/", depth)
		responses[nodeLogProxyPath(nodeName, path)] = []byte(`<!doctype html><pre><a href="deep/">deeper</a></pre>`)
	}
	stubNodeFetchLogs(t, responses)
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsKubeClient(fake.NewClientset())))
	response := service.DiscoverLogs(context.Background(), nodeName)
	require.True(t, response.Supported, response.Reason)
	require.Len(t, response.Sources, maxNodeLogDiscoveryNodes)
	seen := map[string]bool{}
	for _, source := range response.Sources {
		require.False(t, seen[source.Path], "duplicate source %s", source.Path)
		seen[source.Path] = true
	}
}

func TestDiscoverLogsStartsNestedReadsWhileRootStillLoading(t *testing.T) {
	const nodeName = "streaming-node"
	stubNodeFetchLogs(t, map[string][]byte{
		nodeLogProxyPath(nodeName, ""):         []byte(`<!doctype html><pre><a href="fast/">fast</a><a href="slow/">slow</a></pre>`),
		nodeLogProxyPath(nodeName, "fast/"):    []byte(`<!doctype html><pre><a href="log">log</a></pre>`),
		nodeLogProxyPath(nodeName, "fast/log"): []byte("ready log"),
		nodeLogProxyPath(nodeName, "slow/"):    []byte(`<!doctype html><pre></pre>`),
	})
	leafRead := make(chan struct{})
	fetch, probe := nodeLogFetchRawFunc, nodeLogFetchProbeFunc
	nodeLogFetchRawFunc = func(ctx context.Context, client rest.Interface, path string) ([]byte, error) {
		if strings.HasSuffix(path, "/slow/") {
			select {
			case <-leafRead:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return fetch(ctx, client, path)
	}
	nodeLogFetchProbeFunc = func(ctx context.Context, client rest.Interface, path string, maxBytes int) ([]byte, error) {
		if strings.HasSuffix(path, "/fast/log") {
			close(leafRead)
		}
		return probe(ctx, client, path, maxBytes)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsKubeClient(fake.NewClientset())))
	response := service.DiscoverLogs(ctx, nodeName)
	require.NoError(t, ctx.Err(), "one slow root entry must not stop already discovered directories")
	require.True(t, response.Supported, response.Reason)
	require.Len(t, response.Sources, 1)
}

func TestDiscoverLogsBoundsDirectoryDepthAndVisitsEachPathOnce(t *testing.T) {
	const nodeName = "deep-node"
	responses := map[string][]byte{}
	for depth := 0; depth <= maxNodeLogDiscoveryDepth+1; depth++ {
		path := strings.Repeat("deep/", depth)
		responses[nodeLogProxyPath(nodeName, path)] = []byte(`<!doctype html><pre><a href="deep/">deep</a><a href="deep/">duplicate</a></pre>`)
	}
	stubNodeFetchLogs(t, responses)
	fetch := nodeLogFetchRawFunc
	var requests atomic.Int32
	nodeLogFetchRawFunc = func(ctx context.Context, client rest.Interface, path string) ([]byte, error) {
		requests.Add(1)
		return fetch(ctx, client, path)
	}
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsKubeClient(fake.NewClientset())))
	response := service.DiscoverLogs(context.Background(), nodeName)
	require.False(t, response.Supported)
	require.EqualValues(t, maxNodeLogDiscoveryDepth+1, requests.Load())
}

func TestDiscoverLogsJoinsWorkersAfterRequestCancellation(t *testing.T) {
	const nodeName = "cancelled-node"
	stubNodeFetchLogs(t, map[string][]byte{
		nodeLogProxyPath(nodeName, ""): []byte(`<!doctype html><pre><a href="journal/">journal</a></pre>`),
	})
	fetch := nodeLogFetchRawFunc
	started := make(chan struct{})
	var active atomic.Int32
	nodeLogFetchRawFunc = func(ctx context.Context, client rest.Interface, path string) ([]byte, error) {
		if !strings.HasSuffix(path, "/journal/") {
			return fetch(ctx, client, path)
		}
		active.Add(1)
		defer active.Add(-1)
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsKubeClient(fake.NewClientset())))
	done := make(chan restypes.NodeLogDiscoveryResponse, 1)
	go func() { done <- service.DiscoverLogs(ctx, nodeName) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("discovery request never started")
	}
	cancel()
	select {
	case response := <-done:
		require.False(t, response.Supported)
		require.Zero(t, active.Load(), "response must not outlive a worker request")
	case <-time.After(3 * time.Second):
		t.Fatal("discovery did not finish after request cancellation")
	}
}
