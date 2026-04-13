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

func TestDiscoverLogsFindsReadableSourcesOneLevelBelowRoot(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                   []byte(`<!doctype html><pre><a href="journal/">journal/</a><a href="pods/">pods/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):           []byte(`<!doctype html><pre><a href="kubelet">kubelet</a><a href="containerd">containerd</a></pre>`),
		nodeLogProxyPath(nodeName, "pods/"):              []byte(`<!doctype html><pre><a href="kube-system/">kube-system/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/kubelet"):    []byte("kubelet log line"),
		nodeLogProxyPath(nodeName, "journal/containerd"): []byte("containerd log line"),
		nodeLogProxyPath(nodeName, "pods/kube-system/"):  []byte(`<!doctype html><pre><a href="coredns">coredns</a></pre>`),
	}

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, absPath string) ([]byte, error) {
		if body, ok := responses[absPath]; ok {
			return body, nil
		}
		return nil, errors.New("unexpected path: " + absPath)
	}

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

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                       []byte(`<!doctype html><pre><a href="journal/">journal/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):               []byte(`<!doctype html><pre><a href="kubelet">kubelet</a><a href="kubelet.log.gz">kubelet.log.gz</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/kubelet"):        []byte("kubelet log line"),
		nodeLogProxyPath(nodeName, "journal/kubelet.log.gz"): []byte("compressed bytes"),
	}

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, absPath string) ([]byte, error) {
		if body, ok := responses[absPath]; ok {
			return body, nil
		}
		return nil, errors.New("unexpected path: " + absPath)
	}

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

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                                  []byte(`<!doctype html><pre><a href="journal/">journal/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):                          []byte(`<!doctype html><pre><a href="machine-id/">machine-id/</a><a href="kubelet">kubelet</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/machine-id/"):               []byte(`<!doctype html><pre><a href="system.journal">system.journal</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/machine-id/system.journal"): []byte{0x4c, 0x50, 0x4b, 0x53, 0x48, 0x48, 0x52, 0x48, 0x00, 0x01},
		nodeLogProxyPath(nodeName, "journal/kubelet"):                   []byte("kubelet log line"),
	}

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, absPath string) ([]byte, error) {
		if body, ok := responses[absPath]; ok {
			return body, nil
		}
		return nil, errors.New("unexpected path: " + absPath)
	}

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

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                          []byte(`<!doctype html><pre><a href="journal/">journal/</a><a href="pods/">pods/</a><a href="containers/">containers/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):                  []byte(`<!doctype html><pre><a href="kubelet">kubelet</a></pre>`),
		nodeLogProxyPath(nodeName, "pods/"):                     []byte(`<!doctype html><pre><a href="kube-system/">kube-system/</a></pre>`),
		nodeLogProxyPath(nodeName, "containers/"):               []byte(`<!doctype html><pre><a href="containerd.log">containerd.log</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/kubelet"):           []byte("kubelet log line"),
		nodeLogProxyPath(nodeName, "pods/kube-system/"):         []byte(`<!doctype html><pre><a href="coredns">coredns</a></pre>`),
		nodeLogProxyPath(nodeName, "containers/containerd.log"): []byte("container log line"),
	}

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, absPath string) ([]byte, error) {
		if body, ok := responses[absPath]; ok {
			return body, nil
		}
		return nil, errors.New("unexpected path: " + absPath)
	}

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

	originalFetch := nodeLogFetchRawFunc
	t.Cleanup(func() {
		nodeLogFetchRawFunc = originalFetch
	})

	nodeName := "node-a"
	responses := map[string][]byte{
		nodeLogProxyPath(nodeName, ""):                                    []byte(`<!doctype html><pre><a href="journal/">journal/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/"):                            []byte(`<!doctype html><pre><a href="services/">services/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/services/"):                   []byte(`<!doctype html><pre><a href="kubernetes/">kubernetes/</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/services/kubernetes/"):        []byte(`<!doctype html><pre><a href="kubelet">kubelet</a></pre>`),
		nodeLogProxyPath(nodeName, "journal/services/kubernetes/kubelet"): []byte("kubelet log line"),
	}

	nodeLogFetchRawFunc = func(_ context.Context, _ rest.Interface, absPath string) ([]byte, error) {
		if body, ok := responses[absPath]; ok {
			return body, nil
		}
		return nil, errors.New("unexpected path: " + absPath)
	}

	resp := service.DiscoverLogs(nodeName)
	require.True(t, resp.Supported)
	require.Len(t, resp.Sources, 1)
	require.Equal(t, "journal/services/kubernetes/kubelet", resp.Sources[0].Path)
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
