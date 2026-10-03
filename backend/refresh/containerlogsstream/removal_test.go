package containerlogsstream

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
)

// startRemovalSession opens a Deployment tab with pods web-0 and web-1 and a
// short grace for removed pods, and returns the fake API server.
func startRemovalSession(t *testing.T) (*logSession, *fake.Clientset) {
	t.Helper()
	logs := map[string][]logLine{"a0": linesAt("a0", 1), "a1": linesAt("a1", 2)}
	var client *fake.Clientset
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:apps/v1:Deployment:web", MaxEntries: 50},
		objects: []runtime.Object{webDeployment(), runningPod("web-0", "a0"), runningPod("web-1", "a1")},
		respond: kubeletLogs(logs),
		prepare: func(c *fake.Clientset) { client = c },
		tune:    func(s *Streamer) { s.removedPodGrace = 150 * time.Millisecond },
	})
	require.Len(t, entryLines(session.snapshot(t)), 2)
	return session, client
}

func (s *logSession) removedPods() []string {
	s.conn.mu.Lock()
	defer s.conn.mu.Unlock()
	var removed []string
	for _, payload := range s.conn.payloads {
		removed = append(removed, payload.RemovedPods...)
	}
	return removed
}

var podsResource = corev1.SchemeGroupVersion.WithResource("pods")

// A pod deleted during a live session is named once the grace has passed, so
// the client drops its lines instead of keeping them hidden.
func TestDeletedPodIsNamedAfterTheGrace(t *testing.T) {
	session, client := startRemovalSession(t)

	require.NoError(t, client.Tracker().Delete(podsResource, "default", "web-1"))

	require.Eventually(t, func() bool { return len(session.removedPods()) > 0 }, 3*time.Second, 10*time.Millisecond)
	require.Equal(t, []string{"web-1"}, session.removedPods())
}

// A pod recreated with the same name within the grace, like a StatefulSet pod,
// keeps its earlier lines.
func TestPodRecreatedWithTheSameNameIsNotNamed(t *testing.T) {
	session, client := startRemovalSession(t)

	require.NoError(t, client.Tracker().Delete(podsResource, "default", "web-1"))
	recreated := runningPod("web-1", "a1")
	recreated.Status.ContainerStatuses[0].ContainerID = "containerd://web-1-second"
	require.NoError(t, client.Tracker().Add(recreated))

	time.Sleep(600 * time.Millisecond)
	require.Empty(t, session.removedPods())
}

// The client drops a removed pod's lines and has room again, so reads must no
// longer stop at a floor those lines set.
func TestSentLinesForgetARemovedPod(t *testing.T) {
	sent := newSentLines(2, 1<<20)
	sent.add([]Entry{
		{Timestamp: resumeAt(1 * time.Second), Pod: "web-0", Line: "a"},
		{Timestamp: resumeAt(2 * time.Second), Pod: "web-1", Line: "b"},
		{Timestamp: resumeAt(3 * time.Second), Pod: "web-1", Line: "c"},
	})
	require.True(t, sent.floor().Equal(resumeOrigin.Add(2*time.Second)))

	sent.dropPod("web-1")
	require.True(t, sent.floor().IsZero(), "one line held in a two-line buffer leaves room")
}
