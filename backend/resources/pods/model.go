/*
 * backend/resources/pods/model.go
 *
 * Pod resource model: the single definition of a Pod's intrinsic fields + status
 * presentation (phase, container readiness, init/container waiting+terminated
 * reasons, eviction, termination). Table/detail/object-map projections derive from
 * it. Shared model primitives come from resourcemodel.
 */

package pods

import (
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the Pod resource model. Facts are owned by this package
// (pods.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, pod *corev1.Pod) resourcemodel.ResourceModel {
	status := statusPresentation(pod)
	return resourcemodel.ResourceModel{
		Ref: resourcemodel.ResourceRef{
			ClusterID: clusterID,
			Group:     "",
			Version:   "v1",
			Kind:      "Pod",
			Resource:  "pods",
			Namespace: pod.Namespace,
			Name:      pod.Name,
			UID:       string(pod.UID),
		},
		Source: resourcemodel.ResourceSourceKubernetes,
		Scope:  resourcemodel.ResourceScopeNamespaced,
		Metadata: resourcemodel.ResourceMetadata{
			Labels:            resourcemodel.CopyStringMap(pod.Labels),
			Annotations:       resourcemodel.CopyStringMap(pod.Annotations),
			CreationTimestamp: pod.CreationTimestamp,
			ResourceVersion:   pod.ResourceVersion,
			Finalizers:        append([]string(nil), pod.Finalizers...),
		},
		Status: status,
		Facts:  resourcemodel.ResourceFacts{},
	}
}

// BuildFacts derives shared pod facts that table, detail, and map projections can
// reuse without re-counting container readiness differently.
func BuildFacts(pod *corev1.Pod) Facts {
	ready, total, restarts := readinessFacts(pod)
	conditions := make([]resourcemodel.ConditionFacts, 0, len(pod.Status.Conditions))
	for _, condition := range pod.Status.Conditions {
		conditions = append(conditions, resourcemodel.ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return Facts{
		Phase:           string(pod.Status.Phase),
		NodeName:        pod.Spec.NodeName,
		PodIP:           pod.Status.PodIP,
		ReadyContainers: ready,
		TotalContainers: total,
		RestartCount:    restarts,
		Conditions:      conditions,
	}
}

func statusPresentation(pod *corev1.Pod) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(pod)
	lifecycle := resourcemodel.ResourceLifecycle{
		Deleting:         pod.DeletionTimestamp != nil,
		FinalizerBlocked: pod.DeletionTimestamp != nil && len(pod.Finalizers) > 0,
	}

	state := phaseState(pod)
	signals := statusSignals(pod, facts)
	if pod.DeletionTimestamp != nil {
		deletionTimestamp := pod.DeletionTimestamp.Time.Format(time.RFC3339)
		return resourcemodel.ResourceStatusPresentation{
			Label:        "Terminating",
			State:        state,
			Presentation: "terminating",
			Reason:       "DeletionTimestamp",
			Signals: append(signals, resourcemodel.ResourceStatusSignal{
				Type:   resourcemodel.StatusSignalDeletion,
				Name:   "metadata.deletionTimestamp",
				Status: deletionTimestamp,
			}),
			Lifecycle: lifecycle,
		}
	}

	if pod.Status.Phase == corev1.PodFailed && pod.Status.Reason == "Evicted" {
		return resourcemodel.ResourceStatusPresentation{
			Label:        "Evicted",
			State:        state,
			Presentation: "error",
			Reason:       "Evicted",
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}

	if label, reason, presentation, ok := initContainerStatusPresentation(pod); ok {
		return resourcemodel.ResourceStatusPresentation{
			Label:        label,
			State:        state,
			Presentation: presentation,
			Reason:       reason,
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}

	if label, reason, presentation, ok := containerStatusPresentation(pod); ok {
		return resourcemodel.ResourceStatusPresentation{
			Label:        label,
			State:        state,
			Presentation: presentation,
			Reason:       reason,
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}

	return resourcemodel.ResourceStatusPresentation{
		Label:        phaseLabel(pod),
		State:        state,
		Presentation: phasePresentation(pod.Status.Phase, facts),
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

func readinessFacts(pod *corev1.Pod) (ready int32, total int32, restarts int32) {
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

func statusSignals(pod *corev1.Pod, facts Facts) []resourcemodel.ResourceStatusSignal {
	signals := make([]resourcemodel.ResourceStatusSignal, 0, len(pod.Status.Conditions)+2)
	if pod.Status.Phase != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:   resourcemodel.StatusSignalPhase,
			Name:   "status.phase",
			Status: string(pod.Status.Phase),
			Reason: pod.Status.Reason,
		})
	}
	signals = append(signals, resourcemodel.ResourceStatusSignal{
		Type:   resourcemodel.StatusSignalReadiness,
		Name:   "containers",
		Status: fmt.Sprintf("%d/%d", facts.ReadyContainers, facts.TotalContainers),
	})
	for _, condition := range pod.Status.Conditions {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:    resourcemodel.StatusSignalCondition,
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
			return "Init:" + reason, reason, reasonPresentation(reason), true
		}
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" && status.State.Waiting.Reason != "PodInitializing" {
			reason := status.State.Waiting.Reason
			return "Init:" + reason, reason, reasonPresentation(reason), true
		}
	}
	return "", "", "", false
}

func containerStatusPresentation(pod *corev1.Pod) (label, reason, presentation string, ok bool) {
	for _, status := range pod.Status.ContainerStatuses {
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" {
			reason := status.State.Waiting.Reason
			return reason, reason, reasonPresentation(reason), true
		}
		if status.State.Terminated != nil && status.State.Terminated.Reason != "" {
			reason := status.State.Terminated.Reason
			return reason, reason, reasonPresentation(reason), true
		}
	}
	return "", "", "", false
}

func phaseState(pod *corev1.Pod) string {
	if pod.Status.Phase != "" {
		return string(pod.Status.Phase)
	}
	return string(corev1.PodUnknown)
}

func phaseLabel(pod *corev1.Pod) string {
	if pod.Status.Phase != "" {
		return string(pod.Status.Phase)
	}
	return "Unknown"
}

func phasePresentation(phase corev1.PodPhase, facts Facts) string {
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

func reasonPresentation(reason string) string {
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
