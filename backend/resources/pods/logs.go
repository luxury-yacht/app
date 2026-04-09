/*
 * backend/resources/pods/logs.go
 *
 * Pod log retrieval and follow helpers.
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

	"github.com/luxury-yacht/app/backend/internal/linescanner"
	"github.com/luxury-yacht/app/backend/internal/podlogs"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
)

var logStreamFunc = func(pods corev1client.PodInterface, ctx context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
	return pods.GetLogs(podName, opts).Stream(ctx)
}

// LogFetcher aggregates logs from pods or workloads based on the provided request.
func (s *Service) LogFetcher(req types.LogFetchRequest) types.LogFetchResponse {
	if s.deps.KubernetesClient == nil {
		return types.LogFetchResponse{Error: "kubernetes client not initialized"}
	}

	if req.TailLines <= 0 {
		req.TailLines = 1000
	}

	lineFilter, err := podlogs.NewLineFilter(strings.TrimSpace(req.Include), strings.TrimSpace(req.Exclude))
	if err != nil {
		return types.LogFetchResponse{Error: fmt.Sprintf("invalid log filter: %v", err)}
	}
	podNameFilter, err := podlogs.NewPodNameFilter(strings.TrimSpace(req.PodInclude), strings.TrimSpace(req.PodExclude))
	if err != nil {
		return types.LogFetchResponse{Error: fmt.Sprintf("invalid pod filter: %v", err)}
	}

	pods, err := s.resolveTargetPodObjects(req, podNameFilter)
	if err != nil {
		return types.LogFetchResponse{Error: err.Error()}
	}
	targets, totalTargets := podlogs.SelectTargets(pods, req.Container, podlogs.DefaultPerScopeTargetLimit)
	warnings := podlogs.BuildTargetLimitWarnings(len(targets), totalTargets)

	var allEntries []types.PodLogEntry
	var podErrors []error
	for _, target := range targets {
		entries, err := s.fetchContainerLogs(
			target.Namespace,
			target.PodName,
			target.Container.Name,
			target.Container.IsInit,
			req.TailLines,
			req.Previous,
			req.SinceSeconds,
			lineFilter,
		)
		if err != nil {
			s.logWarn(fmt.Sprintf("Failed to fetch logs for container %s/%s: %v", target.PodName, target.Container.Name, err))
			podErrors = append(podErrors, fmt.Errorf("pod %s container %s: %w", target.PodName, target.Container.Name, err))
			continue
		}
		allEntries = append(allEntries, entries...)
	}

	if len(allEntries) == 0 && len(podErrors) > 0 {
		return types.LogFetchResponse{Error: summarizeLogFetchErrors("failed to fetch logs", podErrors)}
	}

	sort.Slice(allEntries, func(i, j int) bool {
		ti, errI := time.Parse(time.RFC3339Nano, allEntries[i].Timestamp)
		tj, errJ := time.Parse(time.RFC3339Nano, allEntries[j].Timestamp)
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

	return types.LogFetchResponse{Entries: allEntries, Warnings: warnings}
}

// PodContainers returns container names (including init containers) for the specified pod.
func (s *Service) PodContainers(namespace, podName string) ([]string, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(s.ctx(), podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	var containers []string
	for _, container := range podlogs.EnumerateContainers(pod, "") {
		containers = append(containers, container.DisplayName())
	}
	return containers, nil
}

type resolvedLogTarget struct {
	Namespace string
	Kind      string
	Name      string
	PodName   string
}

func (s *Service) resolveLogTarget(req types.LogFetchRequest) (resolvedLogTarget, error) {
	if strings.TrimSpace(req.Scope) != "" {
		identity, err := refresh.ParseObjectScope(req.Scope)
		if err != nil {
			return resolvedLogTarget{}, err
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

	if req.Namespace == "" {
		return resolvedLogTarget{}, fmt.Errorf("namespace is required")
	}

	if req.WorkloadName != "" && req.WorkloadKind != "" {
		return resolvedLogTarget{
			Namespace: req.Namespace,
			Kind:      strings.ToLower(strings.TrimSpace(req.WorkloadKind)),
			Name:      strings.TrimSpace(req.WorkloadName),
		}, nil
	}
	if req.PodName != "" {
		podName := strings.TrimSpace(req.PodName)
		return resolvedLogTarget{
			Namespace: req.Namespace,
			Kind:      "pod",
			Name:      podName,
			PodName:   podName,
		}, nil
	}

	return resolvedLogTarget{}, fmt.Errorf("either workload or pod must be specified")
}

func (s *Service) resolveTargetPods(req types.LogFetchRequest) ([]string, error) {
	podNameFilter, err := podlogs.NewPodNameFilter(strings.TrimSpace(req.PodInclude), strings.TrimSpace(req.PodExclude))
	if err != nil {
		return nil, fmt.Errorf("invalid pod filter: %w", err)
	}
	pods, err := s.resolveTargetPodObjects(req, podNameFilter)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(pods))
	for _, pod := range pods {
		if pod != nil {
			names = append(names, pod.Name)
		}
	}
	return names, nil
}

func (s *Service) resolveTargetPodObjects(req types.LogFetchRequest, podNameFilter podlogs.PodNameFilter) ([]*corev1.Pod, error) {
	target, err := s.resolveLogTarget(req)
	if err != nil {
		return nil, err
	}
	if target.PodName != "" {
		pod, err := s.deps.KubernetesClient.CoreV1().Pods(target.Namespace).Get(s.ctx(), target.PodName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get pod: %w", err)
		}
		return []*corev1.Pod{pod}, nil
	}
	pods, err := s.workloadPodObjects(target.Namespace, target.Name, target.Kind)
	if err != nil {
		return nil, err
	}
	return filterPodsByName(pods, req.PodFilter, podNameFilter), nil
}

func filterPodsByName(pods []*corev1.Pod, exactFilter string, podNameFilter podlogs.PodNameFilter) []*corev1.Pod {
	exactFilter = strings.TrimSpace(exactFilter)
	if exactFilter == "" && podNameFilter.IsZero() {
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
		filtered = append(filtered, pod)
	}
	return filtered
}

func (s *Service) workloadPodObjects(namespace, workloadName, workloadKind string) ([]*corev1.Pod, error) {
	client := s.deps.KubernetesClient
	switch strings.ToLower(workloadKind) {
	case "deployment":
		deployment, err := client.AppsV1().Deployments(namespace).Get(s.ctx(), workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get deployment: %w", err)
		}
		return s.podObjectsBySelector(namespace, metav1.FormatLabelSelector(deployment.Spec.Selector))
	case "replicaset":
		rs, err := client.AppsV1().ReplicaSets(namespace).Get(s.ctx(), workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get replicaset: %w", err)
		}
		return s.podObjectsBySelector(namespace, metav1.FormatLabelSelector(rs.Spec.Selector))
	case "daemonset":
		daemonSet, err := client.AppsV1().DaemonSets(namespace).Get(s.ctx(), workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get daemonset: %w", err)
		}
		return s.podObjectsBySelector(namespace, metav1.FormatLabelSelector(daemonSet.Spec.Selector))
	case "statefulset":
		sts, err := client.AppsV1().StatefulSets(namespace).Get(s.ctx(), workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get statefulset: %w", err)
		}
		return s.podObjectsBySelector(namespace, metav1.FormatLabelSelector(sts.Spec.Selector))
	case "job":
		return s.podObjectsBySelector(namespace, fmt.Sprintf("job-name=%s", workloadName))
	case "cronjob":
		return s.podObjectsForCronJob(namespace, workloadName)
	default:
		return nil, fmt.Errorf("unsupported workload type: %s", workloadKind)
	}
}

func (s *Service) podsBySelector(namespace, selector string) ([]string, error) {
	pods, err := s.podObjectsBySelector(namespace, selector)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(pods))
	for _, pod := range pods {
		if pod != nil {
			result = append(result, pod.Name)
		}
	}
	return result, nil
}

func (s *Service) podObjectsBySelector(namespace, selector string) ([]*corev1.Pod, error) {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(s.ctx(), metav1.ListOptions{LabelSelector: selector})
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

func (s *Service) podsForCronJob(namespace, cronJobName string) ([]string, error) {
	pods, err := s.podObjectsForCronJob(namespace, cronJobName)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(pods))
	for _, pod := range pods {
		if pod != nil {
			names = append(names, pod.Name)
		}
	}
	return names, nil
}

func (s *Service) podObjectsForCronJob(namespace, cronJobName string) ([]*corev1.Pod, error) {
	jobs, err := s.deps.KubernetesClient.BatchV1().Jobs(namespace).List(s.ctx(), metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list jobs: %w", err)
	}

	var podObjects []*corev1.Pod
	for _, job := range jobs.Items {
		for _, owner := range job.OwnerReferences {
			if owner.Kind == "CronJob" && owner.Name == cronJobName {
				pods, err := s.podObjectsBySelector(namespace, fmt.Sprintf("job-name=%s", job.Name))
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

func (s *Service) fetchPodLogs(namespace, podName, container string, tailLines int, previous bool, sinceSeconds int64, lineFilter podlogs.LineFilter) ([]types.PodLogEntry, error) {
	pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(s.ctx(), podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	var entries []types.PodLogEntry
	var containerErrors []error
	for _, containerRef := range podlogs.EnumerateContainers(pod, container) {
		containerEntries, err := s.fetchContainerLogs(namespace, podName, containerRef.Name, containerRef.IsInit, tailLines, previous, sinceSeconds, lineFilter)
		if err != nil {
			s.logWarn(fmt.Sprintf("Failed to fetch logs for container %s/%s: %v", podName, containerRef.Name, err))
			containerErrors = append(containerErrors, fmt.Errorf("container %s: %w", containerRef.Name, err))
			continue
		}
		entries = append(entries, containerEntries...)
	}

	if len(entries) == 0 && len(containerErrors) > 0 {
		return nil, fmt.Errorf("failed to fetch any container logs for pod %s: %s", podName, summarizeLogFetchErrors("all containers failed", containerErrors))
	}

	return entries, nil
}

func (s *Service) fetchContainerLogs(namespace, podName, containerName string, isInit bool, tailLines int, previous bool, sinceSeconds int64, lineFilter podlogs.LineFilter) ([]types.PodLogEntry, error) {
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
	stream, err := logStreamFunc(pods, s.ctx(), podName, logOptions)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "waiting to start") ||
			strings.Contains(errStr, "container not found") ||
			(strings.Contains(errStr, "previous terminated container") && strings.Contains(errStr, "not found")) ||
			strings.Contains(errStr, "is not valid for pod") ||
			strings.Contains(errStr, "ContainerCreating") ||
			strings.Contains(errStr, "PodInitializing") {
			return []types.PodLogEntry{}, nil
		}
		return nil, fmt.Errorf("failed to get log stream: %w", err)
	}
	defer stream.Close()

	var entries []types.PodLogEntry
	scanner := linescanner.New(stream)
	for scanner.Scan() {
		line := scanner.Text()
		var timestamp, logLine string
		if spaceIndex := strings.Index(line, " "); spaceIndex > 0 && spaceIndex < 31 {
			timestamp = line[:spaceIndex]
			logLine = line[spaceIndex+1:]
		} else {
			logLine = line
		}
		if !lineFilter.Matches(logLine) {
			continue
		}

		entries = append(entries, types.PodLogEntry{
			Timestamp: timestamp,
			Pod:       podName,
			Container: containerName,
			Line:      logLine,
			IsInit:    isInit,
		})
	}

	if err := scanner.Err(); err != nil && err != io.EOF {
		return nil, fmt.Errorf("error reading logs: %w", err)
	}

	return entries, nil
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

func (s *Service) ctx() context.Context {
	if s.deps.Context != nil {
		return s.deps.Context
	}
	return context.Background()
}

func (s *Service) logWarn(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Warn(msg, "PodLogs")
	}
}
