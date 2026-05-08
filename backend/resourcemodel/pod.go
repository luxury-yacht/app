package resourcemodel

import (
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
)

func BuildPodResourceModel(clusterID string, pod *corev1.Pod) ResourceModel {
	facts := BuildPodFacts(pod)
	status := BuildPodStatusPresentation(pod)

	return ResourceModel{
		Ref: ResourceRef{
			ClusterID: clusterID,
			Group:     "",
			Version:   "v1",
			Kind:      "Pod",
			Resource:  "pods",
			Namespace: pod.Namespace,
			Name:      pod.Name,
			UID:       string(pod.UID),
		},
		Source: ResourceSourceKubernetes,
		Scope:  ResourceScopeNamespaced,
		Metadata: ResourceMetadata{
			Labels:            copyStringMap(pod.Labels),
			Annotations:       copyStringMap(pod.Annotations),
			CreationTimestamp: pod.CreationTimestamp,
			ResourceVersion:   pod.ResourceVersion,
			Finalizers:        append([]string(nil), pod.Finalizers...),
		},
		Status: status,
		Facts: ResourceFacts{
			Pod: &facts,
		},
	}
}

func BuildPodStatusPresentation(pod *corev1.Pod) ResourceStatusPresentation {
	facts := BuildPodFacts(pod)
	lifecycle := ResourceLifecycle{
		Deleting:         pod.DeletionTimestamp != nil,
		FinalizerBlocked: pod.DeletionTimestamp != nil && len(pod.Finalizers) > 0,
	}

	state := podPhaseState(pod)
	signals := podStatusSignals(pod, facts)
	if pod.DeletionTimestamp != nil {
		deletionTimestamp := pod.DeletionTimestamp.Time.Format(time.RFC3339)
		return ResourceStatusPresentation{
			Label:        "Terminating",
			State:        state,
			Presentation: "terminating",
			Reason:       "DeletionTimestamp",
			Signals: append(signals, ResourceStatusSignal{
				Type:   StatusSignalDeletion,
				Name:   "metadata.deletionTimestamp",
				Status: deletionTimestamp,
			}),
			Lifecycle: lifecycle,
		}
	}

	if pod.Status.Phase == corev1.PodFailed && pod.Status.Reason == "Evicted" {
		return ResourceStatusPresentation{
			Label:        "Evicted",
			State:        state,
			Presentation: "error",
			Reason:       "Evicted",
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}

	if label, reason, presentation, ok := initContainerStatusPresentation(pod); ok {
		return ResourceStatusPresentation{
			Label:        label,
			State:        state,
			Presentation: presentation,
			Reason:       reason,
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}

	if label, reason, presentation, ok := containerStatusPresentation(pod); ok {
		return ResourceStatusPresentation{
			Label:        label,
			State:        state,
			Presentation: presentation,
			Reason:       reason,
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}

	return ResourceStatusPresentation{
		Label:        podPhaseLabel(pod),
		State:        state,
		Presentation: podPhasePresentation(pod.Status.Phase, facts),
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

// BuildPodFacts derives shared pod facts that table, detail, and map
// projections can reuse without re-counting container readiness differently.
func BuildPodFacts(pod *corev1.Pod) PodFacts {
	ready, total, restarts := podReadinessFacts(pod)
	conditions := make([]ConditionFacts, 0, len(pod.Status.Conditions))
	for _, condition := range pod.Status.Conditions {
		conditions = append(conditions, ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return PodFacts{
		Phase:           string(pod.Status.Phase),
		NodeName:        pod.Spec.NodeName,
		PodIP:           pod.Status.PodIP,
		ReadyContainers: ready,
		TotalContainers: total,
		RestartCount:    restarts,
		Conditions:      conditions,
	}
}

func podReadinessFacts(pod *corev1.Pod) (ready int32, total int32, restarts int32) {
	expectedContainers := make(map[string]struct{}, len(pod.Spec.Containers))
	for _, container := range pod.Spec.Containers {
		expectedContainers[container.Name] = struct{}{}
		total++
	}
	countFromSpec := total > 0

	for _, status := range pod.Status.ContainerStatuses {
		if !countFromSpec {
			total++
		}
		_, expected := expectedContainers[status.Name]
		if status.Ready && (!countFromSpec || expected) {
			ready++
		}
		restarts += status.RestartCount
	}
	for _, status := range pod.Status.InitContainerStatuses {
		restarts += status.RestartCount
	}
	for _, status := range pod.Status.EphemeralContainerStatuses {
		restarts += status.RestartCount
	}
	return ready, total, restarts
}

func podStatusSignals(pod *corev1.Pod, facts PodFacts) []ResourceStatusSignal {
	signals := make([]ResourceStatusSignal, 0, len(pod.Status.Conditions)+2)
	if pod.Status.Phase != "" {
		signals = append(signals, ResourceStatusSignal{
			Type:   StatusSignalPhase,
			Name:   "status.phase",
			Status: string(pod.Status.Phase),
			Reason: pod.Status.Reason,
		})
	}
	signals = append(signals, ResourceStatusSignal{
		Type:   StatusSignalReadiness,
		Name:   "containers",
		Status: fmt.Sprintf("%d/%d", facts.ReadyContainers, facts.TotalContainers),
	})
	for _, condition := range pod.Status.Conditions {
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return signals
}

func initContainerStatusPresentation(pod *corev1.Pod) (label, reason, presentation string, ok bool) {
	for _, status := range pod.Status.InitContainerStatuses {
		if status.State.Terminated != nil && status.State.Terminated.ExitCode != 0 {
			reason := status.State.Terminated.Reason
			if reason == "" {
				reason = "Error"
			}
			return "Init:" + reason, reason, podReasonPresentation(reason), true
		}
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" && status.State.Waiting.Reason != "PodInitializing" {
			reason := status.State.Waiting.Reason
			return "Init:" + reason, reason, podReasonPresentation(reason), true
		}
	}
	return "", "", "", false
}

func containerStatusPresentation(pod *corev1.Pod) (label, reason, presentation string, ok bool) {
	for _, status := range pod.Status.ContainerStatuses {
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" {
			reason := status.State.Waiting.Reason
			return reason, reason, podReasonPresentation(reason), true
		}
		if status.State.Terminated != nil && status.State.Terminated.Reason != "" {
			reason := status.State.Terminated.Reason
			return reason, reason, podReasonPresentation(reason), true
		}
	}
	return "", "", "", false
}

func podPhaseState(pod *corev1.Pod) string {
	if pod.Status.Phase != "" {
		return string(pod.Status.Phase)
	}
	return string(corev1.PodUnknown)
}

func podPhaseLabel(pod *corev1.Pod) string {
	if pod.Status.Phase != "" {
		return string(pod.Status.Phase)
	}
	return "Unknown"
}

func podPhasePresentation(phase corev1.PodPhase, facts PodFacts) string {
	switch phase {
	case corev1.PodRunning:
		if facts.TotalContainers == 0 || facts.ReadyContainers < facts.TotalContainers {
			return "warning"
		}
		return "ready"
	case corev1.PodSucceeded:
		return "ready"
	case corev1.PodPending:
		return "warning"
	case corev1.PodFailed:
		return "error"
	case corev1.PodUnknown:
		return "unknown"
	default:
		return "unknown"
	}
}

func podReasonPresentation(reason string) string {
	normalized := strings.ToLower(reason)
	switch normalized {
	case "completed":
		return "ready"
	case "containercreating", "podinitializing":
		return "warning"
	}
	if strings.Contains(normalized, "crashloop") ||
		strings.Contains(normalized, "imagepull") ||
		strings.Contains(normalized, "errimagepull") ||
		strings.Contains(normalized, "error") ||
		strings.Contains(normalized, "evicted") ||
		strings.Contains(normalized, "failed") {
		return "error"
	}
	return "warning"
}
