package pods

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
)

var logStreamFunc = func(pods corev1client.PodInterface, ctx context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
	return pods.GetLogs(podName, opts).Stream(ctx)
}

// LogFetcher aggregates logs from pods or workloads based on the provided request.
func (s *Service) LogFetcher(req restypes.LogFetchRequest) restypes.LogFetchResponse {
	if s.deps.Common.KubernetesClient == nil {
		return restypes.LogFetchResponse{Error: "kubernetes client not initialized"}
	}

	if req.Namespace == "" {
		return restypes.LogFetchResponse{Error: "namespace is required"}
	}

	if req.TailLines <= 0 {
		req.TailLines = 1000
	}

	pods, err := s.resolveTargetPods(req)
	if err != nil {
		return restypes.LogFetchResponse{Error: err.Error()}
	}

	var allEntries []restypes.PodLogEntry
	for _, podName := range pods {
		entries, err := s.fetchPodLogs(req.Namespace, podName, req.Container, req.TailLines, req.Previous, req.SinceSeconds)
		if err != nil {
			s.logWarn(fmt.Sprintf("Failed to fetch logs for pod %s: %v", podName, err))
			continue
		}
		allEntries = append(allEntries, entries...)
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

	return restypes.LogFetchResponse{Entries: allEntries}
}

// PodContainers returns container names (including init containers) for the specified pod.
func (s *Service) PodContainers(namespace, podName string) ([]string, error) {
	if s.deps.Common.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pod, err := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace).Get(s.ctx(), podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	var containers []string
	for _, c := range pod.Spec.InitContainers {
		containers = append(containers, c.Name+" (init)")
	}
	for _, c := range pod.Spec.Containers {
		containers = append(containers, c.Name)
	}
	return containers, nil
}

func (s *Service) resolveTargetPods(req restypes.LogFetchRequest) ([]string, error) {
	if req.WorkloadName != "" && req.WorkloadKind != "" {
		return s.workloadPods(req.Namespace, req.WorkloadName, req.WorkloadKind)
	}
	if req.PodName != "" {
		return []string{req.PodName}, nil
	}
	return nil, fmt.Errorf("either workload or pod must be specified")
}

func (s *Service) workloadPods(namespace, workloadName, workloadKind string) ([]string, error) {
	client := s.deps.Common.KubernetesClient
	switch strings.ToLower(workloadKind) {
	case "deployment":
		deployment, err := client.AppsV1().Deployments(namespace).Get(s.ctx(), workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get deployment: %w", err)
		}
		return s.podsBySelector(namespace, metav1.FormatLabelSelector(deployment.Spec.Selector))
	case "replicaset":
		rs, err := client.AppsV1().ReplicaSets(namespace).Get(s.ctx(), workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get replicaset: %w", err)
		}
		return s.podsBySelector(namespace, metav1.FormatLabelSelector(rs.Spec.Selector))
	case "daemonset":
		daemonSet, err := client.AppsV1().DaemonSets(namespace).Get(s.ctx(), workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get daemonset: %w", err)
		}
		return s.podsBySelector(namespace, metav1.FormatLabelSelector(daemonSet.Spec.Selector))
	case "statefulset":
		sts, err := client.AppsV1().StatefulSets(namespace).Get(s.ctx(), workloadName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get statefulset: %w", err)
		}
		return s.podsBySelector(namespace, metav1.FormatLabelSelector(sts.Spec.Selector))
	case "job":
		return s.podsBySelector(namespace, fmt.Sprintf("job-name=%s", workloadName))
	case "cronjob":
		return s.podsForCronJob(namespace, workloadName)
	default:
		return nil, fmt.Errorf("unsupported workload type: %s", workloadKind)
	}
}

func (s *Service) podsBySelector(namespace, selector string) ([]string, error) {
	pods, err := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace).List(s.ctx(), metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods with selector %s: %w", selector, err)
	}
	result := make([]string, 0, len(pods.Items))
	for _, pod := range pods.Items {
		result = append(result, pod.Name)
	}
	return result, nil
}

func (s *Service) podsForCronJob(namespace, cronJobName string) ([]string, error) {
	jobs, err := s.deps.Common.KubernetesClient.BatchV1().Jobs(namespace).List(s.ctx(), metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list jobs: %w", err)
	}

	var podNames []string
	for _, job := range jobs.Items {
		for _, owner := range job.OwnerReferences {
			if owner.Kind == "CronJob" && owner.Name == cronJobName {
				pods, err := s.podsBySelector(namespace, fmt.Sprintf("job-name=%s", job.Name))
				if err != nil {
					s.logWarn(fmt.Sprintf("Failed to list pods for job %s: %v", job.Name, err))
					continue
				}
				podNames = append(podNames, pods...)
			}
		}
	}
	return podNames, nil
}

func (s *Service) fetchPodLogs(namespace, podName, container string, tailLines int, previous bool, sinceSeconds int64) ([]restypes.PodLogEntry, error) {
	pod, err := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace).Get(s.ctx(), podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	var containersToFetch []struct {
		Name   string
		IsInit bool
	}

	if container == "" || container == "all" {
		for _, c := range pod.Spec.InitContainers {
			containersToFetch = append(containersToFetch, struct {
				Name   string
				IsInit bool
			}{Name: c.Name, IsInit: true})
		}
		for _, c := range pod.Spec.Containers {
			containersToFetch = append(containersToFetch, struct {
				Name   string
				IsInit bool
			}{Name: c.Name, IsInit: false})
		}
	} else {
		containersToFetch = append(containersToFetch, struct {
			Name   string
			IsInit bool
		}{Name: container, IsInit: false})
	}

	var entries []restypes.PodLogEntry
	for _, c := range containersToFetch {
		containerEntries, err := s.fetchContainerLogs(namespace, podName, c.Name, c.IsInit, tailLines, previous, sinceSeconds)
		if err != nil {
			s.logWarn(fmt.Sprintf("Failed to fetch logs for container %s/%s: %v", podName, c.Name, err))
			continue
		}
		entries = append(entries, containerEntries...)
	}

	return entries, nil
}

func (s *Service) fetchContainerLogs(namespace, podName, containerName string, isInit bool, tailLines int, previous bool, sinceSeconds int64) ([]restypes.PodLogEntry, error) {
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

	pods := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace)
	stream, err := logStreamFunc(pods, s.ctx(), podName, logOptions)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "waiting to start") ||
			strings.Contains(errStr, "container not found") ||
			(strings.Contains(errStr, "previous terminated container") && strings.Contains(errStr, "not found")) ||
			strings.Contains(errStr, "is not valid for pod") {
			return []restypes.PodLogEntry{}, nil
		}
		return nil, fmt.Errorf("failed to get log stream: %w", err)
	}
	defer stream.Close()

	var entries []restypes.PodLogEntry
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		line := scanner.Text()
		var timestamp, logLine string
		if spaceIndex := strings.Index(line, " "); spaceIndex > 0 && spaceIndex < 31 {
			timestamp = line[:spaceIndex]
			logLine = line[spaceIndex+1:]
		} else {
			logLine = line
		}

		entries = append(entries, restypes.PodLogEntry{
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

func (s *Service) ctx() context.Context {
	if s.deps.Common.Context != nil {
		return s.deps.Common.Context
	}
	return context.Background()
}

func (s *Service) logWarn(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Warn(msg, "PodLogs")
	}
}
