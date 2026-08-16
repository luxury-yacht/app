package backend

import (
	"fmt"
	"sort"
	"strings"
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
	_, removed := l.remove(sessionID)
	if !removed {
		return false
	}
	l.coordinator.unregisterRuntimeOperation(sessionID)
	l.emitList()
	return true
}

func (l portForwardLifecycle) finishStartFailure(sessionID string) bool {
	return l.finishTerminal(sessionID)
}

func (l portForwardLifecycle) finishStartTimeout(sessionID string) bool {
	session, removed := l.remove(sessionID)
	if !removed {
		return false
	}
	session.close()
	l.coordinator.unregisterRuntimeOperation(sessionID)
	l.emitList()
	return true
}

func (l portForwardLifecycle) stopByUser(sessionID string) error {
	if err := l.stop(sessionID, "user stopped", true, true, true); err != nil {
		return err
	}
	return nil
}

func (l portForwardLifecycle) stopForRuntime(sessionID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "cluster disconnected"
	}
	return l.stop(sessionID, reason, false, false, false)
}

func (l portForwardLifecycle) stop(
	sessionID string,
	reason string,
	notFoundIsError bool,
	unregisterRuntime bool,
	emitList bool,
) error {
	if l.coordinator == nil {
		return nil
	}
	session, removed := l.remove(sessionID)
	if !removed {
		if notFoundIsError {
			return fmt.Errorf("port forward session %q not found", sessionID)
		}
		return nil
	}
	session.close()
	l.setStopped(session, reason)
	l.emitStatus(session)
	if emitList {
		l.emitList()
	}
	if unregisterRuntime {
		l.coordinator.unregisterRuntimeOperation(sessionID)
	}
	return nil
}

func (l portForwardLifecycle) setStopped(session *portForwardSessionInternal, reason string) {
	if session == nil {
		return
	}
	session.mu.Lock()
	session.Status = PortForwardStatusStopped
	session.StatusReason = reason
	session.mu.Unlock()
}

func (l portForwardLifecycle) list() []PortForwardSession {
	if l.coordinator == nil {
		return nil
	}
	l.coordinator.portForwardSessionsMu.Lock()
	defer l.coordinator.portForwardSessionsMu.Unlock()

	sessions := make([]PortForwardSession, 0, len(l.coordinator.portForwardSessions))
	for _, session := range l.coordinator.portForwardSessions {
		session.mu.Lock()
		sessions = append(sessions, session.PortForwardSession)
		session.mu.Unlock()
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

	session.mu.Lock()
	event := PortForwardStatusEvent{
		SessionID:    session.ID,
		ClusterID:    session.ClusterID,
		Status:       session.Status,
		StatusReason: session.StatusReason,
		LocalPort:    session.LocalPort,
		PodName:      session.PodName,
	}
	session.mu.Unlock()

	l.coordinator.publishEvent(portForwardStatusEventName, event)
}

func (l portForwardLifecycle) emitList() {
	if l.coordinator == nil {
		return
	}
	l.coordinator.publishEvent(portForwardListEventName, l.list())
}
