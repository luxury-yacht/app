package backend

import (
	"context"
	"sync"
	"time"
)

const (
	portForwardStatusEventName = "portforward:status"
	portForwardListEventName   = "portforward:list"

	// Reconnect settings
	portForwardMaxReconnectAttempts = 5
	portForwardInitialBackoff       = 1 * time.Second
	portForwardMaxBackoff           = 30 * time.Second
)

// PortForwardSession represents an active port forwarding session.
type PortForwardSession struct {
	ID            string    `json:"id"`
	ClusterID     string    `json:"clusterId"`
	ClusterName   string    `json:"clusterName"`
	Namespace     string    `json:"namespace"`
	PodName       string    `json:"podName"`
	ContainerPort int       `json:"containerPort"`
	LocalPort     int       `json:"localPort"`
	TargetKind    string    `json:"targetKind"`
	TargetName    string    `json:"targetName"`
	Status        string    `json:"status"`
	StatusReason  string    `json:"statusReason,omitempty"`
	StartedAt     time.Time `json:"startedAt"`
}

// portForwardSessionInternal holds runtime state not exposed to frontend.
type portForwardSessionInternal struct {
	PortForwardSession
	stopChan         chan struct{}
	cancel           context.CancelFunc
	reconnectAttempt int
	mu               sync.Mutex
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
	SessionID    string `json:"sessionId"`
	ClusterID    string `json:"clusterId"`
	Status       string `json:"status"`
	StatusReason string `json:"statusReason,omitempty"`
	LocalPort    int    `json:"localPort,omitempty"`
	PodName      string `json:"podName,omitempty"`
}

// PortForwardRequest contains parameters for starting a port forward.
type PortForwardRequest struct {
	Namespace     string `json:"namespace"`
	TargetKind    string `json:"targetKind"`
	TargetName    string `json:"targetName"`
	ContainerPort int    `json:"containerPort"`
	LocalPort     int    `json:"localPort"`
}
