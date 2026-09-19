package backend

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
)

type portForwardLifecycle struct {
	coordinator *OperationsCoordinator
}

func (o *OperationsCoordinator) portForwardLifecycle() portForwardLifecycle {
	return portForwardLifecycle{coordinator: o}
}

func (l portForwardLifecycle) registerStarting(session *portForwardSessionInternal) bool {
	if l.coordinator == nil || session == nil {
		return false
	}
	l.coordinator.portForwardSessionsMu.Lock()
	if l.coordinator.portForwardSessions == nil {
		l.coordinator.portForwardSessions = make(map[string]*portForwardSessionInternal)
	}
	l.coordinator.portForwardSessions[session.ID] = session
	l.coordinator.portForwardSessionsMu.Unlock()
	if !l.registerRuntimeOperation(session) {
		l.remove(session.ID)
		return false
	}
	l.emitStatus(session)
	return true
}

func (l portForwardLifecycle) registerRuntimeOperation(session *portForwardSessionInternal) bool {
	if l.coordinator == nil || session == nil {
		return false
	}
	sessionID := session.ID
	return l.coordinator.registerRuntimeOperationAtEpoch(runtimeOperationFromPortForward(session), func(reason string) error {
		return l.stopForRuntime(sessionID, reason)
	}, session.operationEpoch)
}

func (l portForwardLifecycle) markActive(session *portForwardSessionInternal, localPort int) {
	if l.coordinator == nil || session == nil {
		return
	}
	if l.get(session.ID) != session {
		return
	}
	session.mu.Lock()
	session.LocalPort = localPort
	session.Status = PortForwardStatusActive
	session.StatusReason = ""
	session.reconnectAttempt = 0
	session.mu.Unlock()

	if !l.registerRuntimeOperation(session) {
		removed, _ := l.remove(session.ID)
		if removed != nil {
			removed.close()
		}
		return
	}
	l.emitStatus(session)
	l.emitList()
}

func (l portForwardLifecycle) remove(sessionID string) (*portForwardSessionInternal, bool) {
	if l.coordinator == nil {
		return nil, false
	}
	l.coordinator.portForwardSessionsMu.Lock()
	defer l.coordinator.portForwardSessionsMu.Unlock()

	session, ok := l.coordinator.portForwardSessions[sessionID]
	if ok {
		delete(l.coordinator.portForwardSessions, sessionID)
	}
	return session, ok
}

func (l portForwardLifecycle) get(sessionID string) *portForwardSessionInternal {
	if l.coordinator == nil {
		return nil
	}
	l.coordinator.portForwardSessionsMu.Lock()
	defer l.coordinator.portForwardSessionsMu.Unlock()
	return l.coordinator.portForwardSessions[sessionID]
}

func (l portForwardLifecycle) finishTerminal(sessionID string) bool {
	if l.coordinator == nil {
		return false
	}
	session, removed := l.remove(sessionID)
	if !removed {
		return false
	}
	session.close()
	l.coordinator.unregisterRuntimeOperation(sessionID)
	l.emitList()
	return true
}

// awaitStart publishes the result of the first connection attempt and owns its
// failure/timeout cleanup after registration and forwarder startup.
func (l portForwardLifecycle) awaitStart(session *portForwardSessionInternal) (string, error) {
	select {
	case err := <-session.readyChan:
		if err != nil {
			l.finishTerminal(session.ID)
			return "", fmt.Errorf("failed to start port forward: %w", err)
		}
	case <-time.After(config.PortForwardConnectTimeout):
		l.finishTerminal(session.ID)
		return "", fmt.Errorf("timeout waiting for port forward to connect")
	}
	return session.ID, nil
}

func (l portForwardLifecycle) stopByUser(sessionID string) error {
	if l.coordinator == nil {
		return nil
	}
	if !l.stop(sessionID, "user stopped") {
		return fmt.Errorf("port forward session %q not found", sessionID)
	}
	l.emitList()
	l.coordinator.unregisterRuntimeOperation(sessionID)
	return nil
}

func (l portForwardLifecycle) stopForRuntime(sessionID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "cluster disconnected"
	}
	l.stop(sessionID, reason)
	return nil
}

func (l portForwardLifecycle) stop(sessionID, reason string) bool {
	session, removed := l.remove(sessionID)
	if !removed {
		return false
	}
	session.close()
	session.setStatus(PortForwardStatusStopped, reason)
	l.emitStatus(session)
	return true
}

func (l portForwardLifecycle) list() []PortForwardSession {
	if l.coordinator == nil {
		return nil
	}
	l.coordinator.portForwardSessionsMu.Lock()
	defer l.coordinator.portForwardSessionsMu.Unlock()

	sessions := make([]PortForwardSession, 0, len(l.coordinator.portForwardSessions))
	for _, session := range l.coordinator.portForwardSessions {
		sessions = append(sessions, session.snapshot())
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt < sessions[j].StartedAt
	})

	return sessions
}

func (l portForwardLifecycle) countCluster(clusterID string) int {
	if l.coordinator == nil {
		return 0
	}
	l.coordinator.portForwardSessionsMu.Lock()
	defer l.coordinator.portForwardSessionsMu.Unlock()

	count := 0
	for _, session := range l.coordinator.portForwardSessions {
		if session.ClusterID == clusterID {
			count++
		}
	}
	return count
}

func (l portForwardLifecycle) emitStatus(session *portForwardSessionInternal) {
	if l.coordinator == nil || session == nil {
		return
	}

	snapshot := session.snapshot()
	event := PortForwardStatusEvent{
		SessionID:    snapshot.ID,
		ClusterID:    snapshot.ClusterID,
		Status:       snapshot.Status,
		StatusReason: snapshot.StatusReason,
		LocalPort:    snapshot.LocalPort,
		PodName:      snapshot.PodName,
	}

	l.coordinator.publishEvent(portForwardStatusEventName, event)
}

func (l portForwardLifecycle) emitList() {
	if l.coordinator == nil {
		return
	}
	l.coordinator.publishEvent(portForwardListEventName, l.list())
}
