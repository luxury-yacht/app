package nodes

import (
	"bytes"
	"context"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/rest"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

const (
	maxNodeLogDiscoveryDepth = 5
	maxNodeLogDiscoveryNodes = 64
	nodeLogDiscoveryWorkers  = 8
	defaultNodeLogTailBytes  = 256 * 1024
	maxNodeLogTailBytes      = 1024 * 1024
)

var (
	nodeLogAnchorPattern = regexp.MustCompile(`<a\s+href="([^"]+)">([^<]+)</a>`)
	nodeLogFetchRawFunc  = func(ctx context.Context, client rest.Interface, absPath string) ([]byte, error) {
		if client == nil {
			return nil, fmt.Errorf("kubernetes REST client not initialized")
		}
		return client.Get().AbsPath(absPath).DoRaw(ctx)
	}
)

type nodeLogListingEntry struct {
	Href  string
	Label string
}

type nodeLogProbeKind string

const (
	nodeLogProbeDirectory nodeLogProbeKind = "directory"
	nodeLogProbeText      nodeLogProbeKind = "text"
	nodeLogProbeBinary    nodeLogProbeKind = "binary"
)

type nodeLogDiscoveryTask struct {
	path  string
	body  []byte
	depth int
}

type nodeLogDiscoveryState struct {
	mu      sync.Mutex
	visited map[string]struct{}
	sources map[string]restypes.NodeLogSource
}

// DiscoverLogs probes the kubelet node log endpoint and returns directly readable sources.
func (s *Service) DiscoverLogs(nodeName string) restypes.NodeLogDiscoveryResponse {
	if err := s.ensureClient("Nodes"); err != nil {
		return restypes.NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	if s.deps.KubernetesClient == nil {
		return restypes.NodeLogDiscoveryResponse{Reason: "kubernetes client not initialized"}
	}

	rootBody, err := s.fetchNodeLogPath(nodeName, "")
	if err != nil {
		return restypes.NodeLogDiscoveryResponse{Reason: classifyNodeLogError(err)}
	}

	if !isNodeLogDirectoryListing(rootBody) {
		switch probeNodeLogPath("", rootBody) {
		case nodeLogProbeText:
			rootSource := restypes.NodeLogSource{
				ID:    "__root__",
				Label: "Node Logs",
				Kind:  "path",
				Path:  "",
			}
			return restypes.NodeLogDiscoveryResponse{Supported: true, Sources: []restypes.NodeLogSource{rootSource}}
		case nodeLogProbeBinary:
			return restypes.NodeLogDiscoveryResponse{Reason: "node log endpoint returned only binary or compressed content"}
		default:
			return restypes.NodeLogDiscoveryResponse{Reason: "node log endpoint returned no usable sources"}
		}
	}

	sources := make(map[string]restypes.NodeLogSource)
	s.discoverNodeLogSources(nodeName, rootBody, sources)

	if len(sources) == 0 {
		return restypes.NodeLogDiscoveryResponse{Reason: "node log endpoint did not expose any directly readable log sources"}
	}

	ordered := make([]restypes.NodeLogSource, 0, len(sources))
	for _, source := range sources {
		ordered = append(ordered, source)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].Label == ordered[j].Label {
			return ordered[i].Path < ordered[j].Path
		}
		return ordered[i].Label < ordered[j].Label
	})

	return restypes.NodeLogDiscoveryResponse{Supported: true, Sources: ordered}
}

// FetchLogs returns the raw content for a previously discovered node log source.
func (s *Service) FetchLogs(nodeName string, req restypes.NodeLogFetchRequest) restypes.NodeLogFetchResponse {
	sourcePath := strings.TrimSpace(req.SourcePath)
	tailBytes := normalizeNodeLogTailBytes(req.TailBytes)
	source := restypes.NodeLogSource{
		ID:    sourcePath,
		Label: nodeLogSourceLabel(sourcePath),
		Kind:  nodeLogSourceKind(sourcePath),
		Path:  sourcePath,
	}

	if !isDisplayableNodeLogSource(sourcePath) {
		return restypes.NodeLogFetchResponse{
			Source:     source,
			SourcePath: sourcePath,
			Error:      "selected source appears to be compressed or binary and cannot be displayed",
		}
	}
	if !isSupportedNodeLogSource(sourcePath) {
		return restypes.NodeLogFetchResponse{
			Source:     source,
			SourcePath: sourcePath,
			Error:      "selected source is already available in the pod/workload logs views",
		}
	}

	if err := s.ensureClient("Nodes"); err != nil {
		return restypes.NodeLogFetchResponse{Source: source, SourcePath: sourcePath, Error: err.Error()}
	}
	if s.deps.KubernetesClient == nil {
		return restypes.NodeLogFetchResponse{
			Source:     source,
			SourcePath: sourcePath,
			Error:      "kubernetes client not initialized",
		}
	}

	body, err := s.fetchNodeLogPath(nodeName, sourcePath)
	if err != nil {
		return restypes.NodeLogFetchResponse{
			Source:     source,
			SourcePath: sourcePath,
			Error:      classifyNodeLogError(err),
		}
	}

	switch probeNodeLogPath(sourcePath, body) {
	case nodeLogProbeDirectory:
		return restypes.NodeLogFetchResponse{
			Source:     source,
			SourcePath: sourcePath,
			Error:      "selected source is a directory; deeper browsing is not supported yet",
		}
	case nodeLogProbeBinary:
		return restypes.NodeLogFetchResponse{
			Source:     source,
			SourcePath: sourcePath,
			Error:      "selected source appears to be compressed or binary and cannot be displayed",
		}
	}

	content, truncated := truncateNodeLogContent(body, tailBytes)

	return restypes.NodeLogFetchResponse{
		Source:     source,
		SourcePath: sourcePath,
		Content:    content,
		Truncated:  truncated,
	}
}

func (s *Service) discoverNodeLogSources(
	nodeName string,
	rootBody []byte,
	sources map[string]restypes.NodeLogSource,
) {
	state := &nodeLogDiscoveryState{
		visited: map[string]struct{}{"": {}},
		sources: sources,
	}

	taskCh := make(chan nodeLogDiscoveryTask, nodeLogDiscoveryWorkers)
	var taskWG sync.WaitGroup
	var workerWG sync.WaitGroup

	for range nodeLogDiscoveryWorkers {
		workerWG.Add(1)
		go func() {
			defer workerWG.Done()
			for task := range taskCh {
				s.processNodeLogDiscoveryTask(nodeName, task, state, &taskWG, taskCh)
				taskWG.Done()
			}
		}()
	}

	taskWG.Add(1)
	taskCh <- nodeLogDiscoveryTask{path: "", body: rootBody, depth: 0}
	taskWG.Wait()
	close(taskCh)
	workerWG.Wait()
}

func (s *Service) processNodeLogDiscoveryTask(
	nodeName string,
	task nodeLogDiscoveryTask,
	state *nodeLogDiscoveryState,
	taskWG *sync.WaitGroup,
	taskCh chan<- nodeLogDiscoveryTask,
) {
	if task.depth >= maxNodeLogDiscoveryDepth || state.hasReachedSourceLimit() {
		return
	}

	for _, entry := range parseNodeLogDirectoryListing(task.body) {
		if state.hasReachedSourceLimit() {
			return
		}

		nextPath, ok := joinNodeLogPath(task.path, entry.Href)
		if !ok || !state.markVisited(nextPath) {
			continue
		}

		childBody, err := s.fetchNodeLogPath(nodeName, nextPath)
		if err != nil {
			continue
		}
		switch probeNodeLogPath(nextPath, childBody) {
		case nodeLogProbeDirectory:
			if task.depth+1 >= maxNodeLogDiscoveryDepth {
				continue
			}
			taskWG.Add(1)
			taskCh <- nodeLogDiscoveryTask{
				path:  nextPath,
				body:  childBody,
				depth: task.depth + 1,
			}
			continue
		case nodeLogProbeBinary:
			continue
		}
		if !isSupportedNodeLogSource(nextPath) {
			continue
		}

		state.addSource(nextPath)
	}
}

func (s *nodeLogDiscoveryState) hasReachedSourceLimit() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sources) >= maxNodeLogDiscoveryNodes
}

func (s *nodeLogDiscoveryState) markVisited(path string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, seen := s.visited[path]; seen {
		return false
	}
	s.visited[path] = struct{}{}
	return true
}

func (s *nodeLogDiscoveryState) addSource(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sources) >= maxNodeLogDiscoveryNodes {
		return
	}
	s.sources[path] = restypes.NodeLogSource{
		ID:    path,
		Label: nodeLogSourceLabel(path),
		Kind:  nodeLogSourceKind(path),
		Path:  path,
	}
}

func (s *Service) fetchNodeLogPath(nodeName, sourcePath string) ([]byte, error) {
	restClient := s.deps.KubernetesClient.Discovery().RESTClient()
	ctx := s.deps.Context
	if ctx == nil {
		ctx = context.Background()
	}
	return nodeLogFetchRawFunc(ctx, restClient, nodeLogProxyPath(nodeName, sourcePath))
}

func nodeLogProxyPath(nodeName, sourcePath string) string {
	trimmedPath := strings.TrimLeft(strings.TrimSpace(sourcePath), "/")
	base := fmt.Sprintf("/api/v1/nodes/%s/proxy/logs/", url.PathEscape(strings.TrimSpace(nodeName)))
	if trimmedPath == "" {
		return base
	}
	return base + trimmedPath
}

func classifyNodeLogError(err error) string {
	switch {
	case err == nil:
		return ""
	case apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err):
		return "node logs are not accessible with the current permissions"
	case apierrors.IsNotFound(err):
		return "node logs are not supported on this cluster"
	default:
		return err.Error()
	}
}

func isNodeLogDirectoryListing(body []byte) bool {
	trimmed := strings.TrimSpace(strings.ToLower(string(body)))
	return strings.HasPrefix(trimmed, "<!doctype html>") &&
		strings.Contains(trimmed, "<pre>") &&
		strings.Contains(trimmed, "<a href=")
}

func parseNodeLogDirectoryListing(body []byte) []nodeLogListingEntry {
	matches := nodeLogAnchorPattern.FindAllStringSubmatch(string(body), -1)
	if len(matches) == 0 {
		return nil
	}
	entries := make([]nodeLogListingEntry, 0, len(matches))
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		href := strings.TrimSpace(html.UnescapeString(match[1]))
		label := strings.TrimSpace(html.UnescapeString(match[2]))
		if href == "" || href == "../" || strings.Contains(href, "..") {
			continue
		}
		entries = append(entries, nodeLogListingEntry{Href: href, Label: label})
	}
	return entries
}

func joinNodeLogPath(basePath, href string) (string, bool) {
	cleanHref := strings.TrimSpace(href)
	if cleanHref == "" {
		return "", false
	}
	if strings.Contains(cleanHref, "://") || strings.HasPrefix(cleanHref, "#") || strings.HasPrefix(cleanHref, "?") {
		return "", false
	}
	cleanHref = strings.TrimPrefix(cleanHref, "/")
	if strings.HasPrefix(cleanHref, "api/") {
		return "", false
	}

	base := strings.Trim(strings.TrimSpace(basePath), "/")
	child := strings.Trim(cleanHref, "/")
	if child == "" {
		return "", false
	}

	combined := child
	if base != "" {
		combined = base + "/" + child
	}
	if strings.HasSuffix(cleanHref, "/") {
		combined += "/"
	}
	return combined, true
}

func nodeLogSourceKind(sourcePath string) string {
	if strings.HasPrefix(strings.TrimLeft(sourcePath, "/"), "journal/") {
		return "journal"
	}
	return "path"
}

func nodeLogSourceLabel(sourcePath string) string {
	trimmed := strings.Trim(strings.TrimSpace(sourcePath), "/")
	if trimmed == "" {
		return "Node Logs"
	}
	return strings.Join(strings.Split(trimmed, "/"), " / ")
}

func isDisplayableNodeLogSource(sourcePath string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(sourcePath))
	return !strings.HasSuffix(trimmed, ".gz") &&
		!strings.HasSuffix(trimmed, ".journal") &&
		!strings.HasSuffix(trimmed, ".tar") &&
		!strings.HasSuffix(trimmed, ".tgz") &&
		!strings.HasSuffix(trimmed, ".zip") &&
		!strings.HasSuffix(trimmed, ".bz2") &&
		!strings.HasSuffix(trimmed, ".xz")
}

func isSupportedNodeLogSource(sourcePath string) bool {
	trimmed := strings.Trim(strings.ToLower(strings.TrimSpace(sourcePath)), "/")
	return !strings.HasPrefix(trimmed, "pods/") &&
		trimmed != "pods" &&
		!strings.HasPrefix(trimmed, "containers/") &&
		trimmed != "containers"
}

func normalizeNodeLogTailBytes(requested int) int {
	switch {
	case requested <= 0:
		return defaultNodeLogTailBytes
	case requested > maxNodeLogTailBytes:
		return maxNodeLogTailBytes
	default:
		return requested
	}
}

func truncateNodeLogContent(body []byte, tailBytes int) (string, bool) {
	if len(body) <= tailBytes {
		return string(body), false
	}

	trimmed := body[len(body)-tailBytes:]
	if newline := bytes.IndexByte(trimmed, '\n'); newline >= 0 && newline+1 < len(trimmed) {
		trimmed = trimmed[newline+1:]
	}

	return string(trimmed), true
}

func probeNodeLogPath(sourcePath string, body []byte) nodeLogProbeKind {
	if isNodeLogDirectoryListing(body) {
		return nodeLogProbeDirectory
	}
	if !isDisplayableNodeLogSource(sourcePath) {
		return nodeLogProbeBinary
	}
	if looksLikeBinaryNodeLogBody(body) {
		return nodeLogProbeBinary
	}
	return nodeLogProbeText
}

func looksLikeBinaryNodeLogBody(body []byte) bool {
	sample := body
	if len(sample) > 8192 {
		sample = sample[:8192]
	}
	if len(sample) == 0 {
		return false
	}
	if bytes.IndexByte(sample, 0) >= 0 || !utf8.Valid(sample) {
		return true
	}

	controlBytes := 0
	for _, b := range sample {
		switch {
		case b == '\n' || b == '\r' || b == '\t' || b == '\f' || b == '\b' || b == 0x1b:
			continue
		case b < 0x20 || b == 0x7f:
			controlBytes++
		}
	}

	return controlBytes > len(sample)/20
}
