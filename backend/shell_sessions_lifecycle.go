package backend

import (
	"fmt"
	"sort"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type shellSessionLifecycle struct {
	coordinator *OperationsCoordinator
}

func (o *OperationsCoordinator) shellSessionLifecycle() shellSessionLifecycle {
	return shellSessionLifecycle{coordinator: o}
}

func (l shellSessionLifecycle) register(sess *shellSession) bool {
	if l.coordinator == nil || sess == nil {
		return false
	}
	l.coordinator.shellSessionsMu.Lock()
	if l.coordinator.shellSessions == nil {
		l.coordinator.shellSessions = make(map[string]*shellSession)
	}
	l.coordinator.shellSessions[sess.id] = sess
	l.coordinator.shellSessionsMu.Unlock()

	if !l.registerRuntimeOperation(sess) {
		l.remove(sess.id)
		return false
	}
	l.emitList()
	return true
}

func (l shellSessionLifecycle) registerRuntimeOperation(sess *shellSession) bool {
	if l.coordinator == nil || sess == nil {
		return false
	}
	sessionID := sess.id
	return l.coordinator.registerRuntimeOperationAtEpoch(runtimeOperationFromShellSession(sess), func(reason string) error {
		return l.closeForRuntime(sessionID, reason)
	}, sess.operationEpoch)
}

func (l shellSessionLifecycle) closeByUser(sessionID string) error {
	if !l.finishStream(sessionID, "closed", "terminated") {
		return fmt.Errorf("shell session %q not found", sessionID)
	}
	return nil
}

func (l shellSessionLifecycle) closeForRuntime(sessionID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "cluster disconnected"
	}
	l.close(sessionID, "closed", reason)
	return nil
}

func (l shellSessionLifecycle) finishStream(sessionID, status, reason string) bool {
	if !l.close(sessionID, status, reason) {
		return false
	}
	l.emitList()
	l.coordinator.unregisterRuntimeOperation(sessionID)
	return true
}

func (l shellSessionLifecycle) close(sessionID, status, reason string) bool {
	sess, removed := l.remove(sessionID)
	if !removed {
		return false
	}
	sess.Close()
	l.emitStatus(sess.id, sess.clusterID, status, reason)
	return true
}

func (l shellSessionLifecycle) get(sessionID string) *shellSession {
	if l.coordinator == nil {
		return nil
	}
	l.coordinator.shellSessionsMu.Lock()
	defer l.coordinator.shellSessionsMu.Unlock()
	return l.coordinator.shellSessions[sessionID]
}

func (l shellSessionLifecycle) remove(sessionID string) (*shellSession, bool) {
	if l.coordinator == nil {
		return nil, false
	}
	l.coordinator.shellSessionsMu.Lock()
	defer l.coordinator.shellSessionsMu.Unlock()
	sess, ok := l.coordinator.shellSessions[sessionID]
	if ok {
		delete(l.coordinator.shellSessions, sessionID)
	}
	return sess, ok
}

func (l shellSessionLifecycle) list() []ShellSessionInfo {
	if l.coordinator == nil {
		return nil
	}
	l.coordinator.shellSessionsMu.Lock()
	defer l.coordinator.shellSessionsMu.Unlock()

	sessions := make([]ShellSessionInfo, 0, len(l.coordinator.shellSessions))
	for _, sess := range l.coordinator.shellSessions {
		sessions = append(sessions, ShellSessionInfo{
			SessionID:   sess.id,
			ClusterID:   sess.clusterID,
			ClusterName: sess.clusterName,
			Namespace:   sess.namespace,
			PodName:     sess.podName,
			Container:   sess.container,
			Command:     append([]string(nil), sess.command...),
			StartedAt:   metav1.NewTime(sess.startedAt),
		})
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt.Before(&sessions[j].StartedAt)
	})
	return sessions
}

func (l shellSessionLifecycle) countCluster(clusterID string) int {
	if l.coordinator == nil {
		return 0
	}
	l.coordinator.shellSessionsMu.Lock()
	defer l.coordinator.shellSessionsMu.Unlock()

	count := 0
	for _, sess := range l.coordinator.shellSessions {
		if sess.clusterID == clusterID {
			count++
		}
	}
	return count
}

func (l shellSessionLifecycle) emitOutput(sessionID, clusterID, stream, data string) {
	if l.coordinator == nil || sessionID == "" || data == "" {
		return
	}
	l.coordinator.publishEvent(shellOutputEventName, ShellOutputEvent{
		SessionID: sessionID,
		ClusterID: clusterID,
		Stream:    stream,
		Data:      data,
	})
}

func (l shellSessionLifecycle) emitStatus(sessionID, clusterID, status, reason string) {
	if l.coordinator == nil || sessionID == "" || status == "" {
		return
	}
	l.coordinator.publishEvent(shellStatusEventName, ShellStatusEvent{
		SessionID: sessionID,
		ClusterID: clusterID,
		Status:    status,
		Reason:    reason,
	})
}

func (l shellSessionLifecycle) emitList() {
	if l.coordinator == nil {
		return
	}
	l.coordinator.publishEvent(shellListEventName, l.list())
}
