package backend

import (
	"context"
	"sync"

	"github.com/luxury-yacht/app/backend/resources/types"
)

const (
	portForwardStatusEventName = "portforward:status"
	portForwardListEventName   = "portforward:list"
)

// PortForwardStatus is the lifecycle status of a port-forward session. It is a
// closed set so the compiler rejects an invalid or typo'd status at every
// assignment site, making an unrepresentable status impossible.
type PortForwardStatus string

const (
	PortForwardStatusConnecting   PortForwardStatus = "connecting"
	PortForwardStatusActive       PortForwardStatus = "active"
	PortForwardStatusReconnecting PortForwardStatus = "reconnecting"
	PortForwardStatusError        PortForwardStatus = "error"
	PortForwardStatusStopped      PortForwardStatus = "stopped"
)

// PortForwardSession represents an active port forwarding session.
type PortForwardSession struct {
	ID          string `json:"id"`
	ClusterID   string `json:"clusterId"`
	ClusterName string `json:"clusterName"`
	// Target is the complete identity of the object the user forwarded.
	Target types.ObjectRef `json:"target"`
	// PodName is the pod currently serving the forward. It changes when a
	// workload or Service forward reconnects to a replacement pod.
	PodName       string            `json:"podName"`
	ContainerPort int               `json:"containerPort"`
	LocalPort     int               `json:"localPort"`
	Status        PortForwardStatus `json:"status"`
	StatusReason  string            `json:"statusReason,omitempty"`
	StartedAt     string            `json:"startedAt"`
}

// portForwardSessionInternal holds runtime state not exposed to frontend.
type portForwardSessionInternal struct {
	PortForwardSession
	stopChan         chan struct{}
	readyChan        chan error // Signals when initial connection succeeds (nil) or fails (error)
	cancel           context.CancelFunc
	reconnectAttempt int
	operationEpoch   uint64
	mu               sync.Mutex
}

// Activation signals success after publishing active status; only a failed
// first attempt needs to report its error here.
func (s *portForwardSessionInternal) signalStartFailure(err error) {
	if err == nil {
		return
	}
	select {
	case s.readyChan <- err:
	default:
	}
}

func (s *portForwardSessionInternal) snapshot() PortForwardSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.PortForwardSession
}

func (s *portForwardSessionInternal) setStatus(status PortForwardStatus, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Status = status
	s.StatusReason = reason
}

func (s PortForwardSession) targetRef() portForwardTargetRef {
	return portForwardTargetRef{
		Namespace: s.Target.Namespace, Kind: s.Target.Kind, Group: s.Target.Group,
		Version: s.Target.Version, Name: s.Target.Name,
	}
}

func (s *portForwardSessionInternal) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopChan != nil {
		select {
		case <-s.stopChan:
		default:
			close(s.stopChan)
		}
	}
	if s.cancel != nil {
		s.cancel()
	}
}

// PortForwardStatusEvent is emitted on status changes.
type PortForwardStatusEvent struct {
	SessionID    string            `json:"sessionId"`
	ClusterID    string            `json:"clusterId"`
	Status       PortForwardStatus `json:"status"`
	StatusReason string            `json:"statusReason,omitempty"`
	LocalPort    int               `json:"localPort,omitempty"`
	PodName      string            `json:"podName,omitempty"`
}
