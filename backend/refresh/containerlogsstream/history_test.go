package containerlogsstream

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

type logLine struct {
	at   time.Time
	text string
}

var historyOrigin = time.Unix(10_000, 0)

// kubeletLogs answers log requests like the kubelet: the last TailLines lines,
// then only those from SinceTime's second on, kept open when following.
func kubeletLogs(logs map[string][]logLine) func(*corev1.PodLogOptions) logResponse {
	return func(opts *corev1.PodLogOptions) logResponse {
		lines := logs[opts.Container]
		if opts.TailLines != nil && int(*opts.TailLines) < len(lines) {
			lines = lines[len(lines)-int(*opts.TailLines):]
		}
		var body strings.Builder
		for _, line := range lines {
			if opts.SinceTime != nil && line.at.Before(opts.SinceTime.Truncate(time.Second)) {
				continue
			}
			fmt.Fprintf(&body, "%s %s\n", line.at.Format(time.RFC3339Nano), line.text)
		}
		return logResponse{body: body.String(), holdOpen: opts.Follow}
	}
}

// linesAt gives a container one line per offset, in seconds after the origin.
func linesAt(container string, seconds ...int) []logLine {
	lines := make([]logLine, len(seconds))
	for i, second := range seconds {
		lines[i] = logLine{at: historyOrigin.Add(time.Duration(second) * time.Second), text: fmt.Sprintf("%s-%d", container, i)}
	}
	return lines
}

type logRequest struct {
	follow bool
	tail   int64
	since  *time.Time
}

func (s *logSession) requestsFor(container string) []logRequest {
	s.logs.mu.Lock()
	defer s.logs.mu.Unlock()
	var requests []logRequest
	for i, requested := range s.logs.containers {
		if requested != container {
			continue
		}
		request := logRequest{follow: s.logs.follows[i]}
		if s.logs.tailLines[i] != nil {
			request.tail = *s.logs.tailLines[i]
		}
		if s.logs.sinceTimes[i] != nil {
			at := s.logs.sinceTimes[i].Time
			request.since = &at
		}
		requests = append(requests, request)
	}
	return requests
}

// waitForFollow waits until every container's follow request has been made.
func (s *logSession) waitForFollow(t *testing.T, containers ...string) {
	t.Helper()
	require.Eventually(t, func() bool {
		for _, container := range containers {
			requests := s.requestsFor(container)
			if len(requests) == 0 || !requests[len(requests)-1].follow {
				return false
			}
		}
		return true
	}, 3*time.Second, 10*time.Millisecond)
}

// With many containers, each first reads a share of the buffer; when their
// activity is even, that share already holds the newest lines overall and no
// container is read again.
func TestFirstSnapshotReadsAShareOfEachContainersHistory(t *testing.T) {
	logs := map[string][]logLine{}
	containers := []string{"c0", "c1", "c2", "c3"}
	for i, container := range containers {
		seconds := make([]int, 10)
		for j := range seconds {
			seconds[j] = j*4 + i
		}
		logs[container] = linesAt(container, seconds...)
	}
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 8},
		objects: []runtime.Object{runningPod("web-0", containers...)},
		respond: kubeletLogs(logs),
	})

	frames := session.snapshot(t)
	require.Equal(t, []string{"c0-8", "c1-8", "c2-8", "c3-8", "c0-9", "c1-9", "c2-9", "c3-9"}, entryLines(frames))
	session.waitForFollow(t, containers...)
	for _, container := range containers {
		requests := session.requestsFor(container)
		require.Len(t, requests, 2, container)
		require.Equal(t, logRequest{tail: 4}, requests[0], "%s reads a share: twice the buffer across four containers", container)
		require.True(t, requests[1].follow)
		require.NotNil(t, requests[1].since, "%s follows on from the newest line it read", container)
		require.EqualValues(t, 8, requests[1].tail)
	}
}

// A container busier than the rest may have more of the newest lines than its
// share; it alone is read again, from the cut-off time of the newest lines.
func TestFirstSnapshotReadsABusyContainerAgain(t *testing.T) {
	busySeconds := make([]int, 20)
	for i := range busySeconds {
		busySeconds[i] = 100 + i
	}
	logs := map[string][]logLine{
		"busy": linesAt("busy", busySeconds...),
		"q0":   linesAt("q0", 0, 1, 2, 3, 4),
		"q1":   linesAt("q1", 5, 6, 7, 8, 9),
		"q2":   linesAt("q2", 10, 11, 12, 13, 14),
	}
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 8},
		objects: []runtime.Object{runningPod("web-0", "busy", "q0", "q1", "q2")},
		respond: kubeletLogs(logs),
	})

	frames := session.snapshot(t)
	require.Equal(t, []string{
		"busy-12", "busy-13", "busy-14", "busy-15", "busy-16", "busy-17", "busy-18", "busy-19",
	}, entryLines(frames), "the snapshot holds the newest lines overall")
	session.waitForFollow(t, "busy", "q0", "q1", "q2")
	busy := session.requestsFor("busy")
	require.Len(t, busy, 3)
	require.Equal(t, logRequest{tail: 4}, busy[0])
	require.False(t, busy[1].follow)
	require.EqualValues(t, 8, busy[1].tail)
	require.NotNil(t, busy[1].since)
	require.True(t, busy[1].since.Equal(historyOrigin.Add(11*time.Second)), "read again from the cut-off, %v", busy[1].since)
	for _, quiet := range []string{"q0", "q1", "q2"} {
		require.Len(t, session.requestsFor(quiet), 2, "%s already read every line newer than the cut-off", quiet)
	}
}

// Lines written between a container's history read and its follow request
// arrive once.
func TestFollowAfterAHistoryReadDeliversEachLineOnce(t *testing.T) {
	logs := map[string][]logLine{
		"c0": linesAt("c0", 1, 2),
		"c1": linesAt("c1", 3, 4),
		"c2": linesAt("c2", 5, 6),
	}
	written := logs["c2"]
	respond := kubeletLogs(logs)
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 8},
		objects: []runtime.Object{runningPod("web-0", "c0", "c1", "c2")},
		respond: func(opts *corev1.PodLogOptions) logResponse {
			if opts.Container == "c2" && opts.Follow {
				// c2 wrote another line after its history was read.
				logs["c2"] = append(written, logLine{at: historyOrigin.Add(7 * time.Second), text: "c2-late"})
			}
			return respond(opts)
		},
	})

	session.snapshot(t)
	require.Equal(t, []string{"c0-0", "c0-1", "c1-0", "c1-1", "c2-0", "c2-1", "c2-late"}, session.settledLines(t, 7))
}

// settledLines waits for at least want lines, then for a quiet period so a
// repeated line would show, and returns every line sent.
func (s *logSession) settledLines(t *testing.T, want int) []string {
	t.Helper()
	sent := func() []string {
		s.conn.mu.Lock()
		defer s.conn.mu.Unlock()
		return entryLines(s.conn.payloads)
	}
	require.Eventually(t, func() bool { return len(sent()) >= want }, 3*time.Second, 10*time.Millisecond)
	time.Sleep(400 * time.Millisecond)
	return sent()
}

// A container whose history read hangs does not hold back the others' history.
func TestSlowHistoryReadDoesNotHoldBackTheOthers(t *testing.T) {
	stalled, writer := io.Pipe()
	t.Cleanup(func() { _ = writer.Close() })
	logs := map[string][]logLine{"c0": linesAt("c0", 1), "c1": linesAt("c1", 2)}
	respond := kubeletLogs(logs)
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 8},
		objects: []runtime.Object{runningPod("web-0", "c0", "c1", "slow")},
		respond: func(opts *corev1.PodLogOptions) logResponse {
			if opts.Container == "slow" {
				return logResponse{reader: stalled}
			}
			return respond(opts)
		},
	})

	require.Equal(t, []string{"c0-0", "c1-0"}, entryLines(session.snapshot(t)))
}

// A container whose history cannot be read that way is followed as before,
// reading its history in the follow request.
func TestFailedHistoryReadFallsBackToFollowing(t *testing.T) {
	logs := map[string][]logLine{"c0": linesAt("c0", 1), "c1": linesAt("c1", 2), "c2": linesAt("c2", 3)}
	respond := kubeletLogs(logs)
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 8},
		objects: []runtime.Object{runningPod("web-0", "c0", "c1", "c2")},
		respond: func(opts *corev1.PodLogOptions) logResponse {
			if opts.Container == "c2" && !opts.Follow {
				return logResponse{status: http.StatusInternalServerError, body: "boom"}
			}
			return respond(opts)
		},
	})

	require.Equal(t, []string{"c0-0", "c1-0", "c2-0"}, entryLines(session.snapshot(t)))
	requests := session.requestsFor("c2")
	require.Len(t, requests, 2)
	require.Equal(t, logRequest{follow: true, tail: 8}, requests[1])
}
