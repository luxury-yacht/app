package nodes

import (
	"context"
	"errors"
	"testing"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

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
		testsupport.WithDepsContext(context.Background()),
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

	resp := service.DiscoverLogs(nodeName)
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
		testsupport.WithDepsContext(context.Background()),
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

	resp := service.DiscoverLogs(nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/kubelet", resp.Sources[0].Path)
}

func TestDiscoverLogsSkipsBinaryJournalLeaves(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
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

	resp := service.DiscoverLogs(nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/kubelet", resp.Sources[0].Path)
}

func TestDiscoverLogsSkipsPodAndContainerSources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                []byte(`<!doctype html><pre><a href="journal/">journal/</a><a href="pods/">pods/</a><a href="containers/">containers/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):        []byte(`<!doctype html><pre><a href="kubelet">kubelet</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/kubelet"): []byte("kubelet log line"),
	}
	stubNodeFetchLogs(t, responses)

	resp := service.DiscoverLogs(nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/kubelet", resp.Sources[0].Path)
}

func TestDiscoverLogsTraversesNestedJournalDirectories(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
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

	resp := service.DiscoverLogs(nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/services/kubernetes/kubelet", resp.Sources[0].Path)
}

func TestDiscoverLogsIncludesWellKnownServiceQueries(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
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

	resp := service.DiscoverLogs(nodeName)
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
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		return nil, apierrors.NewForbidden(schema.GroupResource{Resource: "nodes"}, "node-a", errors.New("denied"))
	}

	resp := service.DiscoverLogs("node-a")
	require.False(t, resp.Supported)
	require.Contains(t, resp.Reason, "not accessible")
}

func TestFetchLogsRejectsDirectorySources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		return []byte(`<!doctype html><pre><a href="kubelet">kubelet</a></pre>`), nil
	}

	resp := service.FetchLogs("node-a", restypes.NodeLogFetchRequest{SourcePath: "journal/"})
	require.Contains(t, resp.Error, "directory")
}

func TestFetchLogsRejectsCompressedSources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	resp := service.FetchLogs("node-a", restypes.NodeLogFetchRequest{SourcePath: "journal/kubelet.log.gz"})
	require.Contains(t, resp.Error, "compressed or binary")
}

func TestFetchLogsSupportsWellKnownServiceQueries(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
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

	resp := service.FetchLogs("node-a", restypes.NodeLogFetchRequest{SourcePath: "service:kubelet"})
	require.Empty(t, resp.Error)
	require.Equal(t, "kubelet service log line", resp.Content)
	require.Equal(t, "service", resp.Source.Kind)
	require.Equal(t, "services / kubelet", resp.Source.Label)
}

func TestFetchLogsForwardsSinceTimeQueryParameter(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
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

	resp := service.FetchLogs("node-a", restypes.NodeLogFetchRequest{
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
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		return []byte{0x00, 0xff, 0x10, 0x1f, 0x00}, nil
	}

	resp := service.FetchLogs("node-a", restypes.NodeLogFetchRequest{SourcePath: "journal/opaque-leaf"})
	require.Contains(t, resp.Error, "compressed or binary")
}

func TestFetchLogsRejectsPodAndContainerSources(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	resp := service.FetchLogs("node-a", restypes.NodeLogFetchRequest{SourcePath: "pods/kube-system/coredns"})
	require.Contains(t, resp.Error, "already available in the pod/workload logs views")

	resp = service.FetchLogs("node-a", restypes.NodeLogFetchRequest{SourcePath: "containers/containerd.log"})
	require.Contains(t, resp.Error, "already available in the pod/workload logs views")
}

func TestFetchLogsTruncatesLargeResponses(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, _ string) ([]byte, error) {
		return []byte("line-a\nline-b\nline-c\n"), nil
	}

	resp := service.FetchLogs("node-a", restypes.NodeLogFetchRequest{
		SourcePath: "journal/kubelet",
		TailBytes:  8,
	})
	require.True(t, resp.Truncated)
	require.Equal(t, "line-c\n", resp.Content)
}
