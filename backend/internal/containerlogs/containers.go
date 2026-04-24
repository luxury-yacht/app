package containerlogs

import (
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
)

type ContainerStateFilter string

const (
	ContainerStateAll        ContainerStateFilter = "all"
	ContainerStateRunning    ContainerStateFilter = "running"
	ContainerStateWaiting    ContainerStateFilter = "waiting"
	ContainerStateTerminated ContainerStateFilter = "terminated"
)

type ContainerSelectionOptions struct {
	Filter           string
	IncludeInit      bool
	IncludeEphemeral bool
	StateFilter      ContainerStateFilter
	Selection        ScopeSelection
}

type ContainerRef struct {
	Name        string
	IsInit      bool
	IsEphemeral bool
}

func (c ContainerRef) DisplayName() string {
	switch {
	case c.IsInit:
		return fmt.Sprintf("%s (init)", c.Name)
	case c.IsEphemeral:
		return fmt.Sprintf("%s (debug)", c.Name)
	default:
		return c.Name
	}
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

func MatchContainerFilter(container ContainerRef, filter string) bool {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return true
	}
	if container.IsInit {
		return filter == container.Name || filter == container.DisplayName()
	}
	if container.IsEphemeral {
		return filter == container.Name || filter == container.DisplayName()
	}
	return filter == container.Name
}

func ParseContainerStateFilter(raw string) (ContainerStateFilter, error) {
	switch normalized := strings.ToLower(strings.TrimSpace(raw)); normalized {
	case "", string(ContainerStateAll):
		return ContainerStateAll, nil
	case string(ContainerStateRunning):
		return ContainerStateRunning, nil
	case string(ContainerStateWaiting):
		return ContainerStateWaiting, nil
	case string(ContainerStateTerminated):
		return ContainerStateTerminated, nil
	default:
		return "", fmt.Errorf("unsupported container state %q", raw)
	}
}

func DefaultContainerSelection(filter string) ContainerSelectionOptions {
	return ContainerSelectionOptions{
		Filter:           filter,
		IncludeInit:      true,
		IncludeEphemeral: true,
		StateFilter:      ContainerStateAll,
	}
}

func EnumerateContainers(pod *corev1.Pod, filter string) []ContainerRef {
	return EnumerateContainersWithOptions(pod, DefaultContainerSelection(filter))
}

func EnumerateContainersWithOptions(pod *corev1.Pod, options ContainerSelectionOptions) []ContainerRef {
	if pod == nil {
		return nil
	}

	filter := strings.TrimSpace(options.Filter)
	isAll := filter == "" || strings.EqualFold(filter, "all")
	var containers []ContainerRef

	appendIfMatches := func(container ContainerRef) {
		if !options.Selection.MatchContainer(container) {
			return
		}
		if !isAll {
			if MatchContainerFilter(container, filter) {
				containers = append(containers, container)
			}
			return
		}
		switch {
		case container.IsInit && !options.IncludeInit:
			return
		case container.IsEphemeral && !options.IncludeEphemeral:
			return
		case !matchesContainerState(pod, container, options.StateFilter):
			return
		}
		containers = append(containers, container)
	}

	for _, container := range pod.Spec.InitContainers {
		appendIfMatches(ContainerRef{Name: container.Name, IsInit: true})
	}
	for _, container := range pod.Spec.Containers {
		appendIfMatches(ContainerRef{Name: container.Name})
	}
	for _, container := range pod.Spec.EphemeralContainers {
		appendIfMatches(ContainerRef{Name: container.Name, IsEphemeral: true})
	}

	return containers
}

func matchesContainerState(
	pod *corev1.Pod,
	container ContainerRef,
	stateFilter ContainerStateFilter,
) bool {
	if pod == nil || stateFilter == "" || stateFilter == ContainerStateAll {
		return true
	}

	status, ok := containerStatusForRef(pod, container)
	if !ok {
		return false
	}

	switch stateFilter {
	case ContainerStateRunning:
		return status.State.Running != nil
	case ContainerStateWaiting:
		return status.State.Waiting != nil
	case ContainerStateTerminated:
		return status.State.Terminated != nil
	default:
		return true
	}
}

func containerStatusForRef(pod *corev1.Pod, container ContainerRef) (corev1.ContainerStatus, bool) {
	if pod == nil {
		return corev1.ContainerStatus{}, false
	}

	var statuses []corev1.ContainerStatus
	switch {
	case container.IsInit:
		statuses = pod.Status.InitContainerStatuses
	case container.IsEphemeral:
		statuses = pod.Status.EphemeralContainerStatuses
	default:
		statuses = pod.Status.ContainerStatuses
	}

	for _, status := range statuses {
		if status.Name == container.Name {
			return status, true
		}
	}
	return corev1.ContainerStatus{}, false
}
