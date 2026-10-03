package containerlogs

import (
	corev1 "k8s.io/api/core/v1"
)

type ContainerRef struct {
	Name        string
	IsInit      bool
	IsEphemeral bool
}

func (c ContainerRef) SelectionValue() string {
	switch {
	case c.IsInit:
		return SelectedInitPrefix + c.Name
	case c.IsEphemeral:
		return SelectedDebugPrefix + c.Name
	default:
		return SelectedContainerPrefix + c.Name
	}
}

// EnumerateContainers lists the pod's init, regular and ephemeral containers,
// in that order, keeping only those the selection allows.
func EnumerateContainers(pod *corev1.Pod, selection ScopeSelection) []ContainerRef {
	if pod == nil {
		return nil
	}

	var containers []ContainerRef
	add := func(candidate ContainerRef) {
		if selection.MatchContainer(candidate) {
			containers = append(containers, candidate)
		}
	}
	for _, container := range pod.Spec.InitContainers {
		add(ContainerRef{Name: container.Name, IsInit: true})
	}
	for _, container := range pod.Spec.Containers {
		add(ContainerRef{Name: container.Name})
	}
	for _, container := range pod.Spec.EphemeralContainers {
		add(ContainerRef{Name: container.Name, IsEphemeral: true})
	}
	return containers
}

// ContainerStatus returns the pod's status for the referenced container.
func ContainerStatus(pod *corev1.Pod, ref ContainerRef) (corev1.ContainerStatus, bool) {
	if pod == nil {
		return corev1.ContainerStatus{}, false
	}
	statuses := pod.Status.ContainerStatuses
	switch {
	case ref.IsInit:
		statuses = pod.Status.InitContainerStatuses
	case ref.IsEphemeral:
		statuses = pod.Status.EphemeralContainerStatuses
	}
	for _, status := range statuses {
		if status.Name == ref.Name {
			return status, true
		}
	}
	return corev1.ContainerStatus{}, false
}
