package backend

import (
	"fmt"
	"sort"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type shellSessionLifecycle struct {
	app *App
}

func (a *App) shellSessionLifecycle() shellSessionLifecycle {
	return shellSessionLifecycle{app: a}
}

func (l shellSessionLifecycle) register(sess *shellSession) {
	if l.app == nil || sess == nil {
		return
	}
	l.app.shellSessionsMu.Lock()
	if l.app.shellSessions == nil {
		l.app.shellSessions = make(map[string]*shellSession)
	}
	l.app.shellSessions[sess.id] = sess
	l.app.shellSessionsMu.Unlock()

	l.registerRuntimeOperation(sess)
	l.emitList()
}

func (l shellSessionLifecycle) registerRuntimeOperation(sess *shellSession) {
	if l.app == nil || sess == nil {
		return
	}
	sessionID := sess.id
	l.app.registerRuntimeOperation(runtimeOperationFromShellSession(sess), func(reason string) error {
		return l.closeForRuntime(sessionID, reason)
	})
}

func (l shellSessionLifecycle) closeByUser(sessionID string) error {
	if !l.close(sessionID, "closed", "terminated", true, true, true) {
		return fmt.Errorf("shell session %q not found", sessionID)
	}
	return nil
}

func (l shellSessionLifecycle) closeForRuntime(sessionID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "cluster disconnected"
	}
	l.close(sessionID, "closed", reason, false, true, false)
	return nil
}

func (l shellSessionLifecycle) terminate(sessionID, status, reason string) bool {
	return l.close(sessionID, status, reason, true, true, false)
}

func (l shellSessionLifecycle) finishStream(sessionID, status, reason string) bool {
	if l.app == nil {
		return false
	}
	sess, removed := l.remove(sessionID)
	if !removed {
		return false
	}
	l.closeRemoved(sess, status, reason, true, true)
	return true
}

func (l shellSessionLifecycle) stopCluster(clusterID string) int {
	if l.app == nil {
		return 0
	}
	l.app.shellSessionsMu.Lock()
	toStop := make([]*shellSession, 0)
	for _, sess := range l.app.shellSessions {
		if sess.clusterID == clusterID {
			toStop = append(toStop, sess)
			delete(l.app.shellSessions, sess.id)
		}
	}
	l.app.shellSessionsMu.Unlock()

	for _, sess := range toStop {
		l.closeRemoved(sess, "closed", "cluster disconnected", true, false)
	}
	if len(toStop) > 0 {
		l.emitList()
	}
	return len(toStop)
}

func (l shellSessionLifecycle) close(
	sessionID string,
	status string,
	reason string,
	unregisterRuntime bool,
	emitList bool,
	notFoundIsError bool,
) bool {
	if l.app == nil {
		return false
	}
	sess, removed := l.remove(sessionID)
	if !removed {
		return !notFoundIsError
	}
	l.closeRemoved(sess, status, reason, unregisterRuntime, emitList)
	return true
}

func (l shellSessionLifecycle) closeRemoved(
	sess *shellSession,
	status string,
	reason string,
	unregisterRuntime bool,
	emitList bool,
) {
	if l.app == nil || sess == nil {
		return
	}
	sess.Close()
	l.emitStatus(sess.id, sess.clusterID, status, reason)
	if emitList {
		l.emitList()
	}
	if unregisterRuntime {
		l.app.unregisterRuntimeOperation(sess.id)
	}
}

func (l shellSessionLifecycle) get(sessionID string) *shellSession {
	if l.app == nil {
		return nil
	}
	l.app.shellSessionsMu.Lock()
	defer l.app.shellSessionsMu.Unlock()
	return l.app.shellSessions[sessionID]
}

func (l shellSessionLifecycle) remove(sessionID string) (*shellSession, bool) {
	if l.app == nil {
		return nil, false
	}
	l.app.shellSessionsMu.Lock()
	defer l.app.shellSessionsMu.Unlock()
	sess, ok := l.app.shellSessions[sessionID]
	if ok {
		delete(l.app.shellSessions, sessionID)
	}
	return sess, ok
}

func (l shellSessionLifecycle) list() []ShellSessionInfo {
	if l.app == nil {
		return nil
	}
	l.app.shellSessionsMu.Lock()
	defer l.app.shellSessionsMu.Unlock()

	sessions := make([]ShellSessionInfo, 0, len(l.app.shellSessions))
	for _, sess := range l.app.shellSessions {
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
	if l.app == nil {
		return 0
	}
	l.app.shellSessionsMu.Lock()
	defer l.app.shellSessionsMu.Unlock()

	count := 0
	for _, sess := range l.app.shellSessions {
		if sess.clusterID == clusterID {
			count++
		}
	}
	return count
}

func (l shellSessionLifecycle) emitOutput(sessionID, clusterID, stream, data string) {
	if l.app == nil || sessionID == "" || data == "" {
		return
	}
	l.app.emitEvent(shellOutputEventName, ShellOutputEvent{
		SessionID: sessionID,
		ClusterID: clusterID,
		Stream:    stream,
		Data:      data,
	})
}

func (l shellSessionLifecycle) emitStatus(sessionID, clusterID, status, reason string) {
	if l.app == nil || sessionID == "" || status == "" {
		return
	}
	l.app.emitEvent(shellStatusEventName, ShellStatusEvent{
		SessionID: sessionID,
		ClusterID: clusterID,
		Status:    status,
		Reason:    reason,
	})
}

func (l shellSessionLifecycle) emitList() {
	if l.app == nil {
		return
	}
	l.app.emitEvent(shellListEventName, l.list())
}
