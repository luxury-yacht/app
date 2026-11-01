package backend

import (
	"fmt"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type shellSessionLifecycle struct {
	coordinator *OperationsCoordinator
}

// shellSessionEnd is how a session ended, as its final status reports it.
type shellSessionEnd struct {
	status  types.ShellSessionStatus
	reason  string
	failure *errorstatus.Status
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

// closeByUser ends a session for the user. A session whose debug pod could not
// be deleted stays listed and the error is returned; ending it again retries.
func (l shellSessionLifecycle) closeByUser(sessionID string) error {
	found, err := l.finishStream(sessionID, types.ShellSessionStatusEnded, "")
	if !found {
		return fmt.Errorf("shell session %q not found", sessionID)
	}
	return err
}

// closeForRuntime ends a session whose cluster is being removed or whose app is
// quitting: it makes a final attempt to delete the session's debug pod and
// returns that failure for the caller to log, since nothing can retry it.
func (l shellSessionLifecycle) closeForRuntime(sessionID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "cluster disconnected"
	}
	sess := l.get(sessionID)
	if sess == nil {
		return nil
	}
	sess.Close()
	err := sess.releaseOwned()
	l.close(sessionID, shellSessionEnd{status: types.ShellSessionStatusClosed, reason: reason})
	return err
}

// finishStream stops a session's stream and releases what the session created.
// When the release fails the session stays registered in the cleanup-failed
// state and the error is returned. It reports whether the session existed.
func (l shellSessionLifecycle) finishStream(sessionID string, status types.ShellSessionStatus, reason string) (bool, error) {
	return l.endStream(sessionID, shellSessionEnd{status: status, reason: reason})
}

// failStream ends a session whose stream failed. The session's writers never
// fail, so the failure is the remote shell's or its connection's outcome (an
// exit status, a container runtime refusal, a dropped connection): the shell
// tab shows it, and its status says it is not an application failure.
func (l shellSessionLifecycle) failStream(sessionID string, streamErr error) {
	failure := errorstatus.Classify(errorstatus.ClusterOutcome(streamErr))
	l.endStream(sessionID, shellSessionEnd{status: types.ShellSessionStatusError, reason: streamErr.Error(), failure: &failure})
}

func (l shellSessionLifecycle) endStream(sessionID string, end shellSessionEnd) (bool, error) {
	sess := l.get(sessionID)
	if sess == nil {
		return false, nil
	}
	sess.Close()
	if err := sess.releaseOwned(); err != nil {
		l.retainForCleanup(sess, err)
		return true, err
	}
	if l.close(sessionID, end) {
		l.emitList()
		l.coordinator.unregisterRuntimeOperation(sessionID)
	}
	return true, nil
}

// retainForCleanup keeps a session whose debug pod could not be deleted
// listed in an error state, so the user sees the pod and can retry.
func (l shellSessionLifecycle) retainForCleanup(sess *shellSession, err error) {
	reason := err.Error()
	sess.setCleanupFailure(reason)
	l.coordinator.setRuntimeOperationStatus(sess.id, "error", reason)
	l.emitStatus(sess.id, sess.clusterID, types.ShellSessionStatusCleanupFailed, reason)
	l.emitList()
}

func (l shellSessionLifecycle) close(sessionID string, end shellSessionEnd) bool {
	sess, removed := l.remove(sessionID)
	if !removed {
		return false
	}
	sess.Close()
	l.publishStatus(ShellStatusEvent{
		SessionID: sess.id, ClusterID: sess.clusterID, Status: end.status, Reason: end.reason, ErrorDetails: end.failure,
	})
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
		info := ShellSessionInfo{
			SessionID:   sess.id,
			ClusterID:   sess.clusterID,
			ClusterName: sess.clusterName,
			Target:      sess.target,
			DebugPod:    cloneRuntimeOperationTargetRef(sess.debugPod),
			Container:   sess.container,
			Command:     append([]string(nil), sess.command...),
			StartedAt:   metav1.NewTime(sess.startedAt),
		}
		if reason := sess.cleanupFailureReason(); reason != "" {
			info.Status = types.ShellSessionStatusCleanupFailed
			info.StatusReason = reason
		}
		sessions = append(sessions, info)
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

func (l shellSessionLifecycle) emitStatus(sessionID, clusterID string, status types.ShellSessionStatus, reason string) {
	l.publishStatus(ShellStatusEvent{SessionID: sessionID, ClusterID: clusterID, Status: status, Reason: reason})
}

func (l shellSessionLifecycle) publishStatus(event ShellStatusEvent) {
	if l.coordinator == nil || event.SessionID == "" || event.Status == "" {
		return
	}
	l.coordinator.publishEvent(shellStatusEventName, event)
}

func (l shellSessionLifecycle) emitList() {
	if l.coordinator == nil {
		return
	}
	l.coordinator.publishEvent(shellListEventName, l.list())
}
