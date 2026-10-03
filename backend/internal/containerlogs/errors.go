package containerlogs

import (
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// IsUnavailable identifies a container state with no readable log stream yet.
// API not-found errors retain their separate policy in each transport.
func IsUnavailable(err error) bool {
	errText := err.Error()
	return strings.Contains(errText, "waiting to start") ||
		strings.Contains(errText, "container not found") ||
		(strings.Contains(errText, "previous terminated container") && strings.Contains(errText, "not found")) ||
		strings.Contains(errText, "is not valid for pod") ||
		strings.Contains(errText, "ContainerCreating") ||
		strings.Contains(errText, "PodInitializing")
}

// IssueState says why a container's logs could not be read.
type IssueState string

const (
	// IssueUnavailable means the container has no readable log: it has not
	// started, has no previous instance, or its pod is gone.
	IssueUnavailable IssueState = "unavailable"
	// IssueForbidden means the user may not read the container's log.
	IssueForbidden IssueState = "forbidden"
	// IssueFailed means reading the log failed.
	IssueFailed IssueState = "failed"
)

// TargetIssue describes one container whose logs could not be read.
type TargetIssue struct {
	Pod         string     `json:"pod"`
	Container   string     `json:"container"`
	IsInit      bool       `json:"isInit,omitempty"`
	IsEphemeral bool       `json:"isEphemeral,omitempty"`
	State       IssueState `json:"state"`
	Reason      string     `json:"reason"`
}

// NewTargetIssue classifies a failure to read one container's logs.
func NewTargetIssue(pod string, container ContainerRef, err error) TargetIssue {
	state := IssueFailed
	switch {
	case apierrors.IsForbidden(err):
		state = IssueForbidden
	case apierrors.IsNotFound(err) || IsUnavailable(err):
		state = IssueUnavailable
	}
	return TargetIssue{
		Pod: pod, Container: container.Name, IsInit: container.IsInit, IsEphemeral: container.IsEphemeral,
		State: state, Reason: err.Error(),
	}
}
