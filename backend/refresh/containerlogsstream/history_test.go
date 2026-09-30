package containerlogsstream

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
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

// A busy container whose second read fails still delivers every line the
// buffer can hold: its follow request reads from the cut-off instead.
func TestFailedSecondReadFollowsFromTheCutOff(t *testing.T) {
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
	respond := kubeletLogs(logs)
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 8},
		objects: []runtime.Object{runningPod("web-0", "busy", "q0", "q1", "q2")},
		respond: func(opts *corev1.PodLogOptions) logResponse {
			if opts.Container == "busy" && !opts.Follow && opts.SinceTime != nil {
				return logResponse{status: http.StatusInternalServerError, body: "boom"}
			}
			return respond(opts)
		},
	})

	newest := []string{"busy-12", "busy-13", "busy-14", "busy-15", "busy-16", "busy-17", "busy-18", "busy-19"}
	require.Equal(t, newest, entryLines(session.snapshot(t)), "the snapshot holds the newest lines overall")
	require.Equal(t, newest, session.settledLines(t, 8), "each line arrives once")
	session.waitForFollow(t, "busy")
	busy := session.requestsFor("busy")
	require.Len(t, busy, 3)
	require.True(t, busy[2].follow)
	require.EqualValues(t, 8, busy[2].tail)
	require.NotNil(t, busy[2].since)
	require.True(t, busy[2].since.Equal(historyOrigin.Add(11*time.Second)), "follow from the cut-off, %v", busy[2].since)
}

// A history read holds no more of a container's history than its byte limit,
// however much the container returns: it keeps the newest lines that fit and
// says it left older ones out.
func TestHistoryReadKeepsOnlyTheNewestLinesThatFit(t *testing.T) {
	var body strings.Builder
	for i := range 10 {
		fmt.Fprintf(&body, "%s %d%s\n", historyOrigin.Add(time.Duration(i)*time.Second).Format(time.RFC3339Nano), i, strings.Repeat("x", 100_000))
	}
	baseClient := fake.NewClientset()
	pods := newLogPodsWithResponses(baseClient.CoreV1().Pods("default"), "default", []logResponse{{body: body.String()}})
	client := &stubClient{Clientset: baseClient, core: &logCore{CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{"default": pods}}}
	target := containerTarget{namespace: "default", pod: "web-0", container: "app"}

	read, leftOut, err := NewStreamer(client, applog.Noop, nil).readHistory(context.Background(), target, 100, 250_000, time.Time{})

	require.NoError(t, err)
	require.True(t, leftOut)
	require.Len(t, read, 2)
	require.True(t, strings.HasPrefix(read[0].Line, "8"), "the newest lines, oldest first")
	require.True(t, strings.HasPrefix(read[1].Line, "9"))
}

// A round of three or more splits twice the buffer across its members, in
// bytes as in lines, so together they hold about two buffers of history.
func TestHistoryRoundSharesTheBufferBytesAcrossItsMembers(t *testing.T) {
	rounds := newHistoryRounds(100, 300_000, newSentLines(100, 300_000), time.Hour, time.Hour)
	round := rounds.join("a")
	rounds.join("b")
	rounds.join("c")
	rounds.sealFirst()

	share, ok := round.shareFor(context.Background())

	require.True(t, ok)
	require.Equal(t, 67, share.lines)
	require.Equal(t, 200_000, share.bytes)
	for _, key := range []string{"a", "b", "c"} {
		round.withdraw(key)
	}
}

// A first read cut short by its share of the buffer's bytes may have left out
// lines the buffer can hold, so it reads again: the snapshot still holds the
// newest lines that fit.
func TestReadCutByItsByteShareReadsAgain(t *testing.T) {
	busy := make([]logLine, 10)
	for i := range busy {
		busy[i] = logLine{at: historyOrigin.Add(time.Duration(100+i) * time.Second), text: fmt.Sprintf("busy-%d-%s", i, strings.Repeat("x", 60_000))}
	}
	logs := map[string][]logLine{
		"busy": busy,
		"q0":   linesAt("q0", 0, 1),
		"q1":   linesAt("q1", 2, 3),
	}
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 100, MaxBytes: 262_144},
		objects: []runtime.Object{runningPod("web-0", "busy", "q0", "q1")},
		respond: kubeletLogs(logs),
	})

	var prefixes []string
	for _, line := range entryLines(session.snapshot(t)) {
		prefixes = append(prefixes, strings.SplitN(line, "-x", 2)[0])
	}
	require.Equal(t, []string{"q0-0", "q0-1", "q1-0", "q1-1", "busy-6", "busy-7", "busy-8", "busy-9"}, prefixes)
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

// webDeployment selects the runningPod pods (label app=web).
func webDeployment() *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"},
		Spec:       appsv1.DeploymentSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}}},
	}
}

func secondsFrom(start, count, step int) []int {
	seconds := make([]int, count)
	for i := range seconds {
		seconds[i] = start + i*step
	}
	return seconds
}

// startFullBufferSession opens a Deployment tab whose first pod fills the
// client's 8-line buffer with lines from 112 s to 119 s, and returns a function
// that adds pods to the workload.
func startFullBufferSession(t *testing.T, logs map[string][]logLine) (*logSession, func(pods ...*corev1.Pod)) {
	t.Helper()
	logs["a0"] = linesAt("a0", secondsFrom(100, 20, 1)...)
	var client *fake.Clientset
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:apps/v1:Deployment:web", MaxEntries: 8},
		objects: []runtime.Object{webDeployment(), runningPod("web-0", "a0")},
		respond: kubeletLogs(logs),
		prepare: func(c *fake.Clientset) { client = c },
	})
	frames := session.snapshot(t)
	require.Len(t, entryLines(frames), 8)
	addPods := func(pods ...*corev1.Pod) {
		for _, pod := range pods {
			require.NoError(t, client.Tracker().Add(pod))
		}
	}
	return session, addPods
}

// A pod that joins later reads only the lines the client's full buffer can
// still hold: nothing older than the oldest line it keeps.
func TestLatePodReadsOnlyLinesTheBufferCanHold(t *testing.T) {
	logs := map[string][]logLine{}
	logs["a1"] = append(linesAt("a1", secondsFrom(50, 10, 1)...), logLine{at: historyOrigin.Add(200 * time.Second), text: "a1-new"})
	session, addPods := startFullBufferSession(t, logs)

	addPods(runningPod("web-1", "a1"))
	session.waitForFollow(t, "a1")

	requests := session.requestsFor("a1")
	require.Len(t, requests, 1, "one pod alone follows directly")
	require.True(t, requests[0].follow)
	require.EqualValues(t, 8, requests[0].tail)
	require.NotNil(t, requests[0].since, "the read starts at the oldest line the buffer keeps")
	require.True(t, requests[0].since.Equal(historyOrigin.Add(112*time.Second)), "%v", requests[0].since)
	lines := session.settledLines(t, 9)
	require.Equal(t, "a1-new", lines[len(lines)-1])
	require.NotContains(t, lines, "a1-0", "lines older than the buffer holds are not read")
}

// Pods that join together share the buffer like a tab's first pods: each
// reads a share first, from the oldest line the buffer keeps.
func TestPodsJoiningTogetherReadAShareEach(t *testing.T) {
	logs := map[string][]logLine{}
	var pods []*corev1.Pod
	for i := 1; i <= 4; i++ {
		container := fmt.Sprintf("b%d", i)
		logs[container] = linesAt(container, secondsFrom(200+i, 6, 4)...)
		pods = append(pods, runningPod(fmt.Sprintf("web-%d", i), container))
	}
	session, addPods := startFullBufferSession(t, logs)

	addPods(pods...)
	session.waitForFollow(t, "b1", "b2", "b3", "b4")

	for i := 1; i <= 4; i++ {
		container := fmt.Sprintf("b%d", i)
		first := session.requestsFor(container)[0]
		require.False(t, first.follow, container)
		require.EqualValues(t, 4, first.tail, "%s reads a share: twice the buffer across four pods", container)
		require.NotNil(t, first.since)
		require.True(t, first.since.Equal(historyOrigin.Add(112*time.Second)), "%s: %v", container, first.since)
	}
}
