package podlogs

import (
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
)

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

func EnumerateContainers(pod *corev1.Pod, filter string) []ContainerRef {
	if pod == nil {
		return nil
	}

	filter = strings.TrimSpace(filter)
	isAll := filter == "" || strings.EqualFold(filter, "all")
	var containers []ContainerRef

	appendIfMatches := func(container ContainerRef) {
		if !isAll && !MatchContainerFilter(container, filter) {
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
