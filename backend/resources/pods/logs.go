/*
 * backend/resources/pods/logs.go
 *
 * Container log retrieval and follow helpers.
 * - Resolves workloads and streams logs.
 */

package pods

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/types"
	"golang.org/x/sync/errgroup"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
)

var containerLogsStreamFunc = func(pods corev1client.PodInterface, ctx context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
	return pods.GetLogs(podName, opts).Stream(ctx)
}

// containerLogsFetchTimeout is a variable so tests can shorten it.
var containerLogsFetchTimeout = config.ContainerLogsFetchTargetTimeout

// FetchContainerLogs aggregates logs from pods or workloads based on the provided request.
func (s *Service) FetchContainerLogs(ctx context.Context, req types.ContainerLogsFetchRequest) (types.ContainerLogsFetchResponse, error) {
	if s.deps.KubernetesClient == nil {
		return types.ContainerLogsFetchResponse{}, errors.New("kubernetes client not initialized")
	}

	if req.TailLines <= 0 {
		req.TailLines = 1000
	}
	if req.MatchNone {
		if _, err := containerlogs.ParseTargetScope(req.Scope, s.logTargets); err != nil {
			return types.ContainerLogsFetchResponse{}, errorstatus.BadRequest(err)
		}
		return types.ContainerLogsFetchResponse{}, nil
	}

	selection := containerlogs.ParseScopeSelection(req.SelectedFilters)
	pods, err := s.resolveTargetPods(ctx, req.Scope, selection)
	if err != nil {
		return types.ContainerLogsFetchResponse{}, err
	}
	limit := s.deps.ContainerLogsPerScopeTargetLimit
	if limit <= 0 {
		limit = containerlogs.DefaultPerScopeTargetLimit
	}
	targets, totalTargets := containerlogs.SelectTargets(pods, selection, limit)
	warnings := containerlogs.TargetLimitWarnings(containerlogs.LimitPerTab, len(targets), totalTargets, containerlogs.ClampPerScopeTargetLimit(limit))
	read := s.fetchSelectedContainerLogs(ctx, targets, req)
	response := types.ContainerLogsFetchResponse{Warnings: warnings, Issues: read.issues}
	if len(read.entries) == 0 {
		// Nothing could be read: a real failure fails the request, while
		// containers that simply have no log leave an empty result.
		if err := logFetchFailure(read.failures); err != nil {
			return types.ContainerLogsFetchResponse{}, err
		}
		return response, nil
	}
	containerlogs.SortByTimestamp(read.entries, func(entry types.ContainerLogsEntry) string { return entry.Timestamp })
	response.Entries = read.entries
	return response, nil
}

type targetLogs struct {
	entries []types.ContainerLogsEntry
	err     error
}

// containerLogsRead is what a fetch read from its targets.
type containerLogsRead struct {
	entries []types.ContainerLogsEntry
	issues  []containerlogs.TargetIssue
	// failures are the reads that failed for a reason other than the
	// container having no log to read.
	failures []error
}

// fetchSelectedContainerLogs reads the targets a few at a time, each within its
// own timeout, and returns what was read plus one issue per target that could
// not be read.
func (s *Service) fetchSelectedContainerLogs(
	ctx context.Context,
	targets []containerlogs.SelectedTarget,
	req types.ContainerLogsFetchRequest,
) containerLogsRead {
	results := make([]targetLogs, len(targets))
	var group errgroup.Group
	group.SetLimit(config.ContainerLogsFetchParallelism)
	for i, target := range targets {
		group.Go(func() error {
			results[i] = s.fetchTargetLogs(ctx, target, req)
			return nil
		})
	}
	_ = group.Wait()

	var read containerLogsRead
	for i, result := range results {
		if result.err == nil {
			read.entries = append(read.entries, result.entries...)
			continue
		}
		issue := containerlogs.NewTargetIssue(targets[i].PodName, targets[i].Container, result.err)
		if issue.State != containerlogs.IssueUnavailable {
			s.logWarn(fmt.Sprintf("Failed to fetch logs for container %s/%s: %v", issue.Pod, issue.Container, result.err))
			read.failures = append(read.failures, fmt.Errorf("failed to fetch logs: pod %s container %s: %w", issue.Pod, issue.Container, result.err))
		}
		read.issues = append(read.issues, issue)
	}
	return read
}

func (s *Service) fetchTargetLogs(ctx context.Context, target containerlogs.SelectedTarget, req types.ContainerLogsFetchRequest) targetLogs {
	targetCtx, cancel := context.WithTimeout(ctx, containerLogsFetchTimeout)
	defer cancel()
	entries, err := s.fetchContainerLogs(targetCtx, target, req)
	if err != nil && ctx.Err() == nil && errors.Is(targetCtx.Err(), context.DeadlineExceeded) {
		err = fmt.Errorf("no logs within %s", containerLogsFetchTimeout)
	}
	return targetLogs{entries: entries, err: err}
}

// PodContainers returns the pod's init, regular and ephemeral containers, in that order.
func (s *Service) PodContainers(ctx context.Context, namespace, podName string) ([]types.PodContainer, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	if strings.TrimSpace(namespace) == "" {
		return nil, fmt.Errorf("namespace is required")
	}
	if strings.TrimSpace(podName) == "" {
		return nil, fmt.Errorf("pod name is required")
	}

	pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	var containers []types.PodContainer
	for _, container := range containerlogs.EnumerateContainers(pod, containerlogs.ScopeSelection{}) {
		containers = append(containers, podContainer(container))
	}
	return containers, nil
}

func podContainer(ref containerlogs.ContainerRef) types.PodContainer {
	return types.PodContainer{Name: ref.Name, IsInit: ref.IsInit, IsEphemeral: ref.IsEphemeral}
}

// podContainerKindOrder lists init, then regular, then ephemeral containers.
func podContainerKindOrder(container types.PodContainer) int {
	switch {
	case container.IsInit:
		return 0
	case container.IsEphemeral:
		return 2
	default:
		return 1
	}
}

// ContainerLogsScopeContainers returns each container the scope's pods have,
// once per name and kind, sorted by name.
func (s *Service) ContainerLogsScopeContainers(ctx context.Context, scope string) ([]types.PodContainer, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pods, err := s.resolveTargetPods(ctx, scope, containerlogs.ScopeSelection{})
	if err != nil {
		return nil, err
	}

	seen := make(map[containerlogs.ContainerRef]struct{})
	containers := make([]types.PodContainer, 0)
	for _, pod := range pods {
		for _, container := range containerlogs.EnumerateContainers(pod, containerlogs.ScopeSelection{}) {
			if _, ok := seen[container]; ok {
				continue
			}
			seen[container] = struct{}{}
			containers = append(containers, podContainer(container))
		}
	}

	sort.Slice(containers, func(i, j int) bool {
		if containers[i].Name != containers[j].Name {
			return containers[i].Name < containers[j].Name
		}
		return podContainerKindOrder(containers[i]) < podContainerKindOrder(containers[j])
	})
	return containers, nil
}

// resolveTargetPods returns the scope's pods through the resolver shared with
// the live stream.
func (s *Service) resolveTargetPods(ctx context.Context, scope string, selection containerlogs.ScopeSelection) ([]*corev1.Pod, error) {
	target, err := containerlogs.ParseTargetScope(scope, s.logTargets)
	if err != nil {
		return nil, errorstatus.BadRequest(err)
	}
	resolution, err := containerlogs.Resolve(ctx, s.deps.KubernetesClient, s.logTargets, target, selection)
	if err != nil {
		return nil, err
	}
	return resolution.Pods, nil
}

func (s *Service) fetchContainerLogs(ctx context.Context, target containerlogs.SelectedTarget, req types.ContainerLogsFetchRequest) ([]types.ContainerLogsEntry, error) {
	logOptions := &corev1.PodLogOptions{
		Container:  target.Container.Name,
		Timestamps: true,
		Previous:   req.Previous,
	}

	if req.TailLines > 0 {
		tail := int64(req.TailLines)
		logOptions.TailLines = &tail
	}

	pods := s.deps.KubernetesClient.CoreV1().Pods(target.Namespace)
	stream, err := containerLogsStreamFunc(pods, ctx, target.PodName, logOptions)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	var entries []types.ContainerLogsEntry
	reader := containerlogs.NewLineReader(stream)
	for {
		line, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return entries, nil
		}
		if err != nil {
			return nil, fmt.Errorf("error reading logs: %w", err)
		}
		timestamp, logLine := containerlogs.SplitTimestamp(line)
		entries = append(entries, types.ContainerLogsEntry{
			Timestamp:   timestamp,
			Pod:         target.PodName,
			Container:   target.Container.Name,
			Line:        logLine,
			IsInit:      target.Container.IsInit,
			IsEphemeral: target.Container.IsEphemeral,
		})
	}
}

// logFetchFailure is the request's failure when nothing could be read: the
// first failed read, with its status, and how many more failed.
func logFetchFailure(failures []error) error {
	switch len(failures) {
	case 0:
		return nil
	case 1:
		return failures[0]
	}
	return fmt.Errorf("%w (and %d more)", failures[0], len(failures)-1)
}

func (s *Service) logWarn(msg string) {
	applog.Warn(s.deps.Logger, msg, logsources.ContainerLogs)
}
