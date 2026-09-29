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
func (s *Service) FetchContainerLogs(ctx context.Context, req types.ContainerLogsFetchRequest) types.ContainerLogsFetchResponse {
	if s.deps.KubernetesClient == nil {
		return types.ContainerLogsFetchResponse{Error: "kubernetes client not initialized"}
	}

	if req.TailLines <= 0 {
		req.TailLines = 1000
	}
	if req.MatchNone {
		if _, err := containerlogs.ParseTargetScope(req.Scope); err != nil {
			return types.ContainerLogsFetchResponse{Error: err.Error()}
		}
		return types.ContainerLogsFetchResponse{}
	}

	selection := containerlogs.ParseScopeSelection(req.SelectedFilters)
	pods, err := s.resolveTargetPods(ctx, req.Scope, selection)
	if err != nil {
		return types.ContainerLogsFetchResponse{Error: err.Error()}
	}
	limit := s.deps.ContainerLogsPerScopeTargetLimit
	if limit <= 0 {
		limit = containerlogs.DefaultPerScopeTargetLimit
	}
	targets, totalTargets := containerlogs.SelectTargets(pods, selection, limit)
	warnings := containerlogs.TargetLimitWarnings(containerlogs.LimitPerTab, len(targets), totalTargets, containerlogs.ClampPerScopeTargetLimit(limit))
	allEntries, issues := s.fetchSelectedContainerLogs(ctx, targets, req)
	response := types.ContainerLogsFetchResponse{Warnings: warnings, Issues: issues}
	if len(allEntries) == 0 {
		// Nothing could be read: a real failure fails the request, while
		// containers that simply have no log leave an empty result.
		response.Error = summarizeLogFetchFailures(issues)
		return response
	}
	containerlogs.SortByTimestamp(allEntries, func(entry types.ContainerLogsEntry) string { return entry.Timestamp })
	response.Entries = allEntries
	return response
}

type targetLogs struct {
	entries []types.ContainerLogsEntry
	err     error
}

// fetchSelectedContainerLogs reads the targets a few at a time, each within its
// own timeout, and returns what was read plus one issue per target that could
// not be read.
func (s *Service) fetchSelectedContainerLogs(
	ctx context.Context,
	targets []containerlogs.SelectedTarget,
	req types.ContainerLogsFetchRequest,
) ([]types.ContainerLogsEntry, []containerlogs.TargetIssue) {
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

	var entries []types.ContainerLogsEntry
	var issues []containerlogs.TargetIssue
	for i, result := range results {
		if result.err == nil {
			entries = append(entries, result.entries...)
			continue
		}
		issue := containerlogs.NewTargetIssue(targets[i].PodName, targets[i].Container, result.err)
		if issue.State != containerlogs.IssueUnavailable {
			s.logWarn(fmt.Sprintf("Failed to fetch logs for container %s/%s: %v", issue.Pod, issue.Container, result.err))
		}
		issues = append(issues, issue)
	}
	return entries, issues
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
	target, err := containerlogs.ParseTargetScope(scope)
	if err != nil {
		return nil, err
	}
	resolution, err := containerlogs.Resolve(ctx, s.deps.KubernetesClient, target, selection)
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

// summarizeLogFetchFailures describes the failed or forbidden targets, or
// returns "" when every issue is only an unavailable log.
func summarizeLogFetchFailures(issues []containerlogs.TargetIssue) string {
	var failures []containerlogs.TargetIssue
	for _, issue := range issues {
		if issue.State != containerlogs.IssueUnavailable {
			failures = append(failures, issue)
		}
	}
	if len(failures) == 0 {
		return ""
	}
	first := fmt.Sprintf("failed to fetch logs: pod %s container %s: %s", failures[0].Pod, failures[0].Container, failures[0].Reason)
	if len(failures) == 1 {
		return first
	}
	return fmt.Sprintf("%s (and %d more)", first, len(failures)-1)
}

func (s *Service) logWarn(msg string) {
	applog.Warn(s.deps.Logger, msg, logsources.ContainerLogs)
}
