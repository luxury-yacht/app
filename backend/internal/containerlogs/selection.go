package containerlogs

import "strings"

const (
	SelectedPodPrefix       = "pod:"
	SelectedInitPrefix      = "init:"
	SelectedContainerPrefix = "container:"
	SelectedDebugPrefix     = "debug:"
)

// ScopeSelection captures explicit pod/container selections from the object-panel logs UI.
// When present, these selections narrow the backend target set before per-scope/global caps.
type ScopeSelection struct {
	selectedPods       map[string]struct{}
	selectedContainers map[ContainerRef]struct{}
}

func ParseScopeSelection(values []string) ScopeSelection {
	selection := ScopeSelection{}
	for _, rawValue := range values {
		value := strings.TrimSpace(rawValue)
		if value == "" {
			continue
		}
		switch {
		case strings.HasPrefix(value, SelectedPodPrefix):
			podName := strings.TrimSpace(strings.TrimPrefix(value, SelectedPodPrefix))
			if podName == "" {
				continue
			}
			if selection.selectedPods == nil {
				selection.selectedPods = make(map[string]struct{})
			}
			selection.selectedPods[podName] = struct{}{}
		case strings.HasPrefix(value, SelectedInitPrefix):
			name := strings.TrimSpace(strings.TrimPrefix(value, SelectedInitPrefix))
			if name == "" {
				continue
			}
			if selection.selectedContainers == nil {
				selection.selectedContainers = make(map[ContainerRef]struct{})
			}
			selection.selectedContainers[ContainerRef{Name: name, IsInit: true}] = struct{}{}
		case strings.HasPrefix(value, SelectedDebugPrefix):
			name := strings.TrimSpace(strings.TrimPrefix(value, SelectedDebugPrefix))
			if name == "" {
				continue
			}
			if selection.selectedContainers == nil {
				selection.selectedContainers = make(map[ContainerRef]struct{})
			}
			selection.selectedContainers[ContainerRef{Name: name, IsEphemeral: true}] = struct{}{}
		case strings.HasPrefix(value, SelectedContainerPrefix):
			name := strings.TrimSpace(strings.TrimPrefix(value, SelectedContainerPrefix))
			if name == "" {
				continue
			}
			if selection.selectedContainers == nil {
				selection.selectedContainers = make(map[ContainerRef]struct{})
			}
			selection.selectedContainers[ContainerRef{Name: name}] = struct{}{}
		}
	}
	return selection
}

func (s ScopeSelection) IsZero() bool {
	return len(s.selectedPods) == 0 && len(s.selectedContainers) == 0
}

func (s ScopeSelection) MatchPod(podName string) bool {
	if len(s.selectedPods) == 0 {
		return true
	}
	_, ok := s.selectedPods[podName]
	return ok
}

func (s ScopeSelection) MatchContainer(container ContainerRef) bool {
	if len(s.selectedContainers) == 0 {
		return true
	}
	_, ok := s.selectedContainers[container]
	return ok
}
