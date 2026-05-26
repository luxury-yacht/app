package backend

import (
	"fmt"
	"sort"
	"strings"
)

type portForwardLifecycle struct {
	app *App
}

func (a *App) portForwardLifecycle() portForwardLifecycle {
	return portForwardLifecycle{app: a}
}

func (l portForwardLifecycle) registerStarting(session *portForwardSessionInternal) {
	if l.app == nil || session == nil {
		return
	}
	l.app.portForwardSessionsMu.Lock()
	if l.app.portForwardSessions == nil {
		l.app.portForwardSessions = make(map[string]*portForwardSessionInternal)
	}
	l.app.portForwardSessions[session.ID] = session
	l.app.portForwardSessionsMu.Unlock()
	l.registerRuntimeOperation(session)
	l.emitStatus(session)
}

func (l portForwardLifecycle) registerRuntimeOperation(session *portForwardSessionInternal) {
	if l.app == nil || session == nil {
		return
	}
	sessionID := session.ID
	l.app.registerRuntimeOperation(runtimeOperationFromPortForward(session), func(reason string) error {
		return l.stopForRuntime(sessionID, reason)
	})
}

func (l portForwardLifecycle) markActive(session *portForwardSessionInternal, localPort int) {
	if l.app == nil || session == nil {
		return
	}
	session.mu.Lock()
	session.LocalPort = localPort
	session.Status = "active"
	session.StatusReason = ""
	session.reconnectAttempt = 0
	session.mu.Unlock()

	l.registerRuntimeOperation(session)
	l.emitStatus(session)
	l.emitList()
}

func (l portForwardLifecycle) remove(sessionID string) (*portForwardSessionInternal, bool) {
	if l.app == nil {
		return nil, false
	}
	l.app.portForwardSessionsMu.Lock()
	defer l.app.portForwardSessionsMu.Unlock()

	session, ok := l.app.portForwardSessions[sessionID]
	if ok {
		delete(l.app.portForwardSessions, sessionID)
	}
	return session, ok
}

func (l portForwardLifecycle) finishTerminal(sessionID string) bool {
	if l.app == nil {
		return false
	}
	_, removed := l.remove(sessionID)
	if !removed {
		return false
	}
	l.app.unregisterRuntimeOperation(sessionID)
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
	l.app.unregisterRuntimeOperation(sessionID)
	l.emitList()
	return true
}

func (l portForwardLifecycle) stopByUser(sessionID string) error {
	if err := l.stop(sessionID, "user stopped", true, true); err != nil {
		return err
	}
	return nil
}

func (l portForwardLifecycle) stopForRuntime(sessionID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "cluster disconnected"
	}
	return l.stop(sessionID, reason, false, false)
}

func (l portForwardLifecycle) stopCluster(clusterID string) int {
	if l.app == nil {
		return 0
	}
	l.app.portForwardSessionsMu.Lock()
	var toRemove []*portForwardSessionInternal
	for _, session := range l.app.portForwardSessions {
		if session.ClusterID == clusterID {
			toRemove = append(toRemove, session)
		}
	}
	for _, session := range toRemove {
		delete(l.app.portForwardSessions, session.ID)
	}
	l.app.portForwardSessionsMu.Unlock()

	for _, session := range toRemove {
		session.close()
		l.setStopped(session, "cluster disconnected")
		l.emitStatus(session)
		l.app.unregisterRuntimeOperation(session.ID)
	}

	if len(toRemove) > 0 {
		l.emitList()
	}
	return len(toRemove)
}

func (l portForwardLifecycle) stop(
	sessionID string,
	reason string,
	notFoundIsError bool,
	unregisterRuntime bool,
) error {
	if l.app == nil {
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
	l.emitList()
	if unregisterRuntime {
		l.app.unregisterRuntimeOperation(sessionID)
	}
	return nil
}

func (l portForwardLifecycle) setStopped(session *portForwardSessionInternal, reason string) {
	if session == nil {
		return
	}
	session.mu.Lock()
	session.Status = "stopped"
	session.StatusReason = reason
	session.mu.Unlock()
}

func (l portForwardLifecycle) list() []PortForwardSession {
	if l.app == nil {
		return nil
	}
	l.app.portForwardSessionsMu.Lock()
	defer l.app.portForwardSessionsMu.Unlock()

	sessions := make([]PortForwardSession, 0, len(l.app.portForwardSessions))
	for _, session := range l.app.portForwardSessions {
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
	if l.app == nil {
		return 0
	}
	l.app.portForwardSessionsMu.Lock()
	defer l.app.portForwardSessionsMu.Unlock()

	count := 0
	for _, session := range l.app.portForwardSessions {
		if session.ClusterID == clusterID {
			count++
		}
	}
	return count
}

func (l portForwardLifecycle) get(sessionID string) *portForwardSessionInternal {
	if l.app == nil {
		return nil
	}
	l.app.portForwardSessionsMu.Lock()
	defer l.app.portForwardSessionsMu.Unlock()
	return l.app.portForwardSessions[sessionID]
}

func (l portForwardLifecycle) emitStatus(session *portForwardSessionInternal) {
	if l.app == nil || session == nil {
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

	l.app.emitEvent(portForwardStatusEventName, event)
}

func (l portForwardLifecycle) emitList() {
	if l.app == nil {
		return
	}
	l.app.emitEvent(portForwardListEventName, l.list())
}
