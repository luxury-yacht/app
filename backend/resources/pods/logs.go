/*
 * backend/resources/pods/logs.go
 *
 * Container log retrieval and follow helpers.
 * - Resolves workloads and streams logs.
 */

package pods

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/internal/linescanner"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
)

var containerLogsStreamFunc = func(pods corev1client.PodInterface, ctx context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
	return pods.GetLogs(podName, opts).Stream(ctx)
}

type containerLogFetchPlan struct {
	lineFilter     containerlogs.LineFilter
	podNameFilter  containerlogs.PodNameFilter
	selection      containerlogs.ScopeSelection
	containerState containerlogs.ContainerStateFilter
}

// FetchContainerLogs aggregates logs from pods or workloads based on the provided request.
func (s *Service) FetchContainerLogs(ctx context.Context, req types.ContainerLogsFetchRequest) types.ContainerLogsFetchResponse {
	if s.deps.KubernetesClient == nil {
		return types.ContainerLogsFetchResponse{Error: "kubernetes client not initialized"}
	}

	plan, err := prepareContainerLogFetch(&req)
	if err != nil {
		return types.ContainerLogsFetchResponse{Error: err.Error()}
	}
	if req.MatchNone {
		if _, err := s.resolveLogTarget(req); err != nil {
			return types.ContainerLogsFetchResponse{Error: err.Error()}
		}
		return types.ContainerLogsFetchResponse{}
	}

	pods, err := s.resolveTargetPodObjects(ctx, req, plan.podNameFilter, plan.selection)
	if err != nil {
		return types.ContainerLogsFetchResponse{Error: err.Error()}
	}
	targets, totalTargets := selectContainerLogTargets(pods, req, plan)
	warnings := containerlogs.BuildTargetLimitWarnings(len(targets), totalTargets)
	allEntries, podErrors := s.fetchSelectedContainerLogs(ctx, targets, req, plan.lineFilter)

	if len(allEntries) == 0 && len(podErrors) > 0 {
		return types.ContainerLogsFetchResponse{Error: summarizeLogFetchErrors("failed to fetch logs", podErrors)}
	}
	sortContainerLogEntries(allEntries)
	return types.ContainerLogsFetchResponse{Entries: allEntries, Warnings: warnings}
}

func prepareContainerLogFetch(req *types.ContainerLogsFetchRequest) (containerLogFetchPlan, error) {
	if req.TailLines <= 0 {
		req.TailLines = 1000
	}
	lineFilter, err := containerlogs.NewLineFilter(strings.TrimSpace(req.Include), strings.TrimSpace(req.Exclude))
	if err != nil {
		return containerLogFetchPlan{}, fmt.Errorf("invalid log filter: %w", err)
	}
	podNameFilter, err := containerlogs.NewPodNameFilter(strings.TrimSpace(req.PodInclude), strings.TrimSpace(req.PodExclude))
	if err != nil {
		return containerLogFetchPlan{}, fmt.Errorf("invalid pod filter: %w", err)
	}
	containerState, err := containerlogs.ParseContainerStateFilter(req.ContainerState)
	if err != nil {
		return containerLogFetchPlan{}, fmt.Errorf("invalid container state filter: %w", err)
	}
	return containerLogFetchPlan{
		lineFilter: lineFilter, podNameFilter: podNameFilter,
		selection: containerlogs.ParseScopeSelection(req.SelectedFilters), containerState: containerState,
	}, nil
}

func selectContainerLogTargets(pods []*corev1.Pod, req types.ContainerLogsFetchRequest, plan containerLogFetchPlan) ([]containerlogs.SelectedTarget, int) {
	return containerlogs.SelectTargets(pods, containerlogs.ContainerSelectionOptions{
		Filter: req.Container, IncludeInit: boolValueOrDefault(req.IncludeInit, true),
		IncludeEphemeral: boolValueOrDefault(req.IncludeEphemeral, true),
		StateFilter:      plan.containerState, Selection: plan.selection,
	}, containerlogs.GetPerScopeTargetLimit())
}

func (s *Service) fetchSelectedContainerLogs(
	ctx context.Context,
	targets []containerlogs.SelectedTarget,
	req types.ContainerLogsFetchRequest,
	lineFilter containerlogs.LineFilter,
) ([]types.ContainerLogsEntry, []error) {
	var entries []types.ContainerLogsEntry
	var fetchErrors []error
	for _, target := range targets {
		fetched, err := s.fetchContainerLogs(
			ctx,
			target.Namespace, target.PodName, target.Container.Name,
			target.Container.IsInit, target.Container.IsEphemeral,
			req.TailLines, req.Previous, req.SinceSeconds, lineFilter,
		)
		if err != nil {
			s.logWarn(fmt.Sprintf("Failed to fetch logs for container %s/%s: %v", target.PodName, target.Container.Name, err))
			fetchErrors = append(fetchErrors, fmt.Errorf("pod %s container %s: %w", target.PodName, target.Container.Name, err))
			continue
		}
		entries = append(entries, fetched...)
	}
	return entries, fetchErrors
}

func sortContainerLogEntries(entries []types.ContainerLogsEntry) {
	sort.Slice(entries, func(i, j int) bool {
		ti, errI := time.Parse(time.RFC3339Nano, entries[i].Timestamp)
		tj, errJ := time.Parse(time.RFC3339Nano, entries[j].Timestamp)
		if errI == nil && errJ == nil {
			return ti.Before(tj)
		}
		if errI != nil && errJ == nil {
			return false
		}
		if errI == nil && errJ != nil {
			return true
		}
		return i < j
	})
}

// PodContainers returns container names (including init containers) for the specified pod.
func (s *Service) PodContainers(ctx context.Context, namespace, podName string) ([]string, error) {
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

	var containers []string
	for _, container := range containerlogs.EnumerateContainers(pod, "") {
		containers = append(containers, container.DisplayName())
	}
	return containers, nil
}

// ContainerLogsScopeContainers returns the unique display names for all containers addressed by the scope.
func (s *Service) ContainerLogsScopeContainers(ctx context.Context, scope string) ([]string, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pods, err := s.resolveTargetPodObjects(ctx, types.ContainerLogsFetchRequest{Scope: scope}, containerlogs.PodNameFilter{}, containerlogs.ScopeSelection{})
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	containers := make([]string, 0)
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		for _, container := range containerlogs.EnumerateContainers(pod, "") {
			displayName := container.DisplayName()
			if _, ok := seen[displayName]; ok {
				continue
			}
			seen[displayName] = struct{}{}
			containers = append(containers, displayName)
		}
	}

	sort.Strings(containers)
	return containers, nil
}

type resolvedLogTarget struct {
	Namespace string
	Kind      string
	Name      string
	PodName   string
}

func (s *Service) resolveLogTarget(req types.ContainerLogsFetchRequest) (resolvedLogTarget, error) {
	if strings.TrimSpace(req.Scope) == "" {
		return resolvedLogTarget{}, fmt.Errorf("container logs scope is required")
	}

	identity, err := refresh.ParseObjectScope(req.Scope)
	if err != nil {
		return resolvedLogTarget{}, err
	}
	if strings.TrimSpace(identity.GVK.Version) == "" {
		return resolvedLogTarget{}, fmt.Errorf("logs require object scopes to include apiVersion")
	}
	if identity.Namespace == "" {
		return resolvedLogTarget{}, fmt.Errorf("logs require a namespaced object scope")
	}
	kind := strings.ToLower(strings.TrimSpace(identity.GVK.Kind))
	if kind == "" {
		return resolvedLogTarget{}, fmt.Errorf("object kind missing in scope %q", req.Scope)
	}
	target := resolvedLogTarget{
		Namespace: identity.Namespace,
		Kind:      kind,
		Name:      strings.TrimSpace(identity.Name),
	}
	if target.Name == "" {
		return resolvedLogTarget{}, fmt.Errorf("object name missing in scope %q", req.Scope)
	}
	if target.Kind == "pod" {
		target.PodName = target.Name
	}
	return target, nil
}

func (s *Service) resolveTargetPodObjects(
	ctx context.Context,
	req types.ContainerLogsFetchRequest,
	podNameFilter containerlogs.PodNameFilter,
	selection containerlogs.ScopeSelection,
) ([]*corev1.Pod, error) {
	target, err := s.resolveLogTarget(req)
	if err != nil {
		return nil, err
	}
	if target.PodName != "" {
		if !selection.MatchPod(target.PodName) {
			return nil, nil
		}
		pod, err := s.deps.KubernetesClient.CoreV1().Pods(target.Namespace).Get(ctx, target.PodName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get pod: %w", err)
		}
		return []*corev1.Pod{pod}, nil
	}
	pods, err := s.workloadPodObjects(ctx, target.Namespace, target.Name, target.Kind)
	if err != nil {
		return nil, err
	}
	return filterPodsByName(pods, req.PodFilter, podNameFilter, selection), nil
}

func filterPodsByName(
	pods []*corev1.Pod,
	exactFilter string,
	podNameFilter containerlogs.PodNameFilter,
	selection containerlogs.ScopeSelection,
) []*corev1.Pod {
	exactFilter = strings.TrimSpace(exactFilter)
	if exactFilter == "" && podNameFilter.IsZero() && selection.IsZero() {
		return pods
	}
	filtered := make([]*corev1.Pod, 0, len(pods))
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if exactFilter != "" && pod.Name != exactFilter {
			continue
		}
		if !podNameFilter.IsZero() && !podNameFilter.Match(pod.Name) {
			continue
		}
		if !selection.MatchPod(pod.Name) {
			continue
		}
		filtered = append(filtered, pod)
	}
	return filtered
}

func (s *Service) workloadPodObjects(ctx context.Context, namespace, workloadName, workloadKind string) ([]*corev1.Pod, error) {
	client := s.deps.KubernetesClient
	switch strings.ToLower(workloadKind) {
	case "deployment":
		deployment, err := client.AppsV1().Deployments(namespace).Get(ctx, workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get deployment: %w", err)
		}
		return s.podObjectsBySelector(ctx, namespace, metav1.FormatLabelSelector(deployment.Spec.Selector))
	case "replicaset":
		rs, err := client.AppsV1().ReplicaSets(namespace).Get(ctx, workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get replicaset: %w", err)
		}
		return s.podObjectsBySelector(ctx, namespace, metav1.FormatLabelSelector(rs.Spec.Selector))
	case "daemonset":
		daemonSet, err := client.AppsV1().DaemonSets(namespace).Get(ctx, workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get daemonset: %w", err)
		}
		return s.podObjectsBySelector(ctx, namespace, metav1.FormatLabelSelector(daemonSet.Spec.Selector))
	case "statefulset":
		sts, err := client.AppsV1().StatefulSets(namespace).Get(ctx, workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get statefulset: %w", err)
		}
		return s.podObjectsBySelector(ctx, namespace, metav1.FormatLabelSelector(sts.Spec.Selector))
	case "job":
		return s.podObjectsBySelector(ctx, namespace, fmt.Sprintf("job-name=%s", workloadName))
	case "cronjob":
		return s.podObjectsForCronJob(ctx, namespace, workloadName)
	default:
		return nil, fmt.Errorf("unsupported workload type: %s", workloadKind)
	}
}

func (s *Service) podObjectsBySelector(ctx context.Context, namespace, selector string) ([]*corev1.Pod, error) {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods with selector %s: %w", selector, err)
	}
	result := make([]*corev1.Pod, 0, len(pods.Items))
	for i := range pods.Items {
		pod := pods.Items[i]
		result = append(result, &pod)
	}
	return result, nil
}

func (s *Service) podObjectsForCronJob(ctx context.Context, namespace, cronJobName string) ([]*corev1.Pod, error) {
	jobs, err := s.deps.KubernetesClient.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list jobs: %w", err)
	}

	var podObjects []*corev1.Pod
	for _, job := range jobs.Items {
		for _, owner := range job.OwnerReferences {
			if owner.Kind == "CronJob" && owner.Name == cronJobName {
				pods, err := s.podObjectsBySelector(ctx, namespace, fmt.Sprintf("job-name=%s", job.Name))
				if err != nil {
					s.logWarn(fmt.Sprintf("Failed to list pods for job %s: %v", job.Name, err))
					continue
				}
				podObjects = append(podObjects, pods...)
			}
		}
	}
	return podObjects, nil
}

func (s *Service) fetchContainerLogs(ctx context.Context, namespace, podName, containerName string, isInit bool, isEphemeral bool, tailLines int, previous bool, sinceSeconds int64, lineFilter containerlogs.LineFilter) ([]types.ContainerLogsEntry, error) {
	logOptions := &corev1.PodLogOptions{
		Container:  containerName,
		Timestamps: true,
		Previous:   previous,
	}

	if tailLines > 0 {
		tail := int64(tailLines)
		logOptions.TailLines = &tail
	}
	if sinceSeconds > 0 {
		logOptions.SinceSeconds = &sinceSeconds
	}

	pods := s.deps.KubernetesClient.CoreV1().Pods(namespace)
	stream, err := containerLogsStreamFunc(pods, ctx, podName, logOptions)
	if err != nil {
		if containerLogStreamUnavailable(err) {
			return []types.ContainerLogsEntry{}, nil
		}
		return nil, fmt.Errorf("failed to get container logs stream: %w", err)
	}
	defer stream.Close()

	var entries []types.ContainerLogsEntry
	scanner := linescanner.New(stream)
	for scanner.Scan() {
		timestamp, logLine := splitContainerLogLine(scanner.Text())
		if !lineFilter.Matches(logLine) {
			continue
		}

		entries = append(entries, types.ContainerLogsEntry{
			Timestamp:   timestamp,
			Pod:         podName,
			Container:   containerName,
			Line:        logLine,
			IsInit:      isInit,
			IsEphemeral: isEphemeral,
		})
	}

	if err := scanner.Err(); err != nil && err != io.EOF {
		return nil, fmt.Errorf("error reading logs: %w", err)
	}

	return entries, nil
}

func containerLogStreamUnavailable(err error) bool {
	errText := err.Error()
	return strings.Contains(errText, "waiting to start") ||
		strings.Contains(errText, "container not found") ||
		(strings.Contains(errText, "previous terminated container") && strings.Contains(errText, "not found")) ||
		strings.Contains(errText, "is not valid for pod") ||
		strings.Contains(errText, "ContainerCreating") ||
		strings.Contains(errText, "PodInitializing")
}

func splitContainerLogLine(line string) (string, string) {
	spaceIndex := strings.Index(line, " ")
	if spaceIndex <= 0 || spaceIndex >= 31 {
		return "", line
	}
	return line[:spaceIndex], line[spaceIndex+1:]
}

func summarizeLogFetchErrors(prefix string, errs []error) string {
	if len(errs) == 0 {
		return prefix
	}
	if len(errs) == 1 {
		return fmt.Sprintf("%s: %v", prefix, errs[0])
	}
	return fmt.Sprintf("%s: %v (and %d more)", prefix, errs[0], len(errs)-1)
}

func boolValueOrDefault(value *bool, defaultValue bool) bool {
	if value == nil {
		return defaultValue
	}
	return *value
}

func (s *Service) logWarn(msg string) {
	applog.Warn(s.deps.Logger, msg, logsources.ContainerLogs)
}
