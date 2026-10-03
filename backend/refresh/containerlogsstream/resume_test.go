package containerlogsstream

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
)

var resumeOrigin = time.Unix(1000, 0)

func resumeAt(offset time.Duration) string {
	return resumeOrigin.Add(offset).Format(time.RFC3339Nano)
}

// replayFrom answers like the kubelet: a request with a since time returns
// every line from that second on.
func replayFrom(offsets []time.Duration, lines []string) func(*corev1.PodLogOptions) logResponse {
	return func(opts *corev1.PodLogOptions) logResponse {
		var keptOffsets []time.Duration
		var keptLines []string
		for i, offset := range offsets {
			if opts.SinceTime == nil || !resumeOrigin.Add(offset).Before(opts.SinceTime.Truncate(time.Second)) {
				keptOffsets = append(keptOffsets, offset)
				keptLines = append(keptLines, lines[i])
			}
		}
		return logResponse{body: buildContainerLogsStream(resumeOrigin, keptOffsets, keptLines), holdOpen: true}
	}
}

func (s *logSession) requestFor(t *testing.T, container string) (since *time.Time, tail *int64) {
	t.Helper()
	s.logs.mu.Lock()
	defer s.logs.mu.Unlock()
	for i, requested := range s.logs.containers {
		if requested == container {
			if s.logs.sinceTimes[i] != nil {
				at := s.logs.sinceTimes[i].Time
				since = &at
			}
			return since, s.logs.tailLines[i]
		}
	}
	t.Fatalf("no log request for container %q", container)
	return nil, nil
}

// A restarted stream continues from where the client's buffer ends: a
// container the client already holds lines for sends only newer lines, and a
// container it has none for sends its history.
func TestSessionResumesFromTheClientsBuffer(t *testing.T) {
	app := replayFrom(
		[]time.Duration{time.Millisecond, 2 * time.Millisecond, 2 * time.Millisecond, 3 * time.Millisecond},
		[]string{"app-1", "app-2a", "app-2b", "app-3"},
	)
	sidecar := replayFrom([]time.Duration{time.Millisecond}, []string{"sidecar-1"})
	session := startLogSession(t, sessionSetup{
		request: Request{
			Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 50,
			Resume: []ResumePoint{{Pod: "web-0", Container: "app", Timestamp: resumeAt(2 * time.Millisecond), Lines: []string{"app-2a", "app-2b"}}},
		},
		objects: []runtime.Object{runningPod("web-0", "app", "sidecar")},
		respond: func(opts *corev1.PodLogOptions) logResponse {
			if opts.Container == "sidecar" {
				return sidecar(opts)
			}
			return app(opts)
		},
	})

	frames := session.snapshot(t)
	require.True(t, frames[0].Resumed, "the client must add this snapshot to its buffer, not replace it")
	require.Equal(t, []string{"sidecar-1", "app-3"}, entryLines(frames))

	since, tail := session.requestFor(t, "app")
	require.NotNil(t, since, "a held container resumes from its newest line")
	require.True(t, since.Equal(resumeOrigin.Add(2*time.Millisecond)))
	require.NotNil(t, tail, "a resume reads no more than the client can hold")
	require.EqualValues(t, 50, *tail)
	since, tail = session.requestFor(t, "sidecar")
	require.Nil(t, since)
	require.NotNil(t, tail)
	require.EqualValues(t, 50, *tail)
}

// One unusable resume point makes the whole request a full replay: resuming
// the other containers while re-reading that one would duplicate its lines in
// the client's buffer.
func TestSessionWithAnUnusableResumePointReplaysFullHistory(t *testing.T) {
	for _, test := range []struct {
		name  string
		point ResumePoint
	}{
		{name: "unparseable timestamp", point: ResumePoint{Pod: "web-0", Container: "sidecar", Timestamp: "yesterday", Lines: []string{"x"}}},
		{name: "no lines", point: ResumePoint{Pod: "web-0", Container: "sidecar", Timestamp: resumeAt(time.Millisecond)}},
		{name: "no container", point: ResumePoint{Pod: "web-0", Timestamp: resumeAt(time.Millisecond), Lines: []string{"x"}}},
		{name: "no pod", point: ResumePoint{Container: "sidecar", Timestamp: resumeAt(time.Millisecond), Lines: []string{"x"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			session := startLogSession(t, sessionSetup{
				request: Request{
					Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 50,
					Resume: []ResumePoint{
						{Pod: "web-0", Container: "app", Timestamp: resumeAt(2 * time.Millisecond), Lines: []string{"app-2"}},
						test.point,
					},
				},
				objects: []runtime.Object{runningPod("web-0", "app")},
				respond: replayFrom([]time.Duration{time.Millisecond, 2 * time.Millisecond}, []string{"app-1", "app-2"}),
			})

			frames := session.snapshot(t)
			require.False(t, frames[0].Resumed)
			require.Equal(t, []string{"app-1", "app-2"}, entryLines(frames))
			since, _ := session.requestFor(t, "app")
			require.Nil(t, since)
		})
	}
}

// The client holds a line that was not valid UTF-8 in the form the JSON wire
// gave it; the resume must still recognise it and not send it again.
func TestSessionResumesAfterALineThatWasNotValidUTF8(t *testing.T) {
	session := startLogSession(t, sessionSetup{
		request: Request{
			Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 50,
			Resume: []ResumePoint{{Pod: "web-0", Container: "app", Timestamp: resumeAt(time.Millisecond), Lines: []string{"bad �� byte"}}},
		},
		objects: []runtime.Object{runningPod("web-0", "app")},
		respond: replayFrom([]time.Duration{time.Millisecond, 2 * time.Millisecond}, []string{"bad \xff\xfe byte", "next"}),
	})

	require.Equal(t, []string{"next"}, entryLines(session.snapshot(t)))
}

// Resume points apply to the pods the session starts with. A pod that appears
// later is new to the session even if an earlier pod had its name, so it reads
// its history like any new pod.
func TestResumePointsApplyOnlyToThePodsTheSessionStartsWith(t *testing.T) {
	var cursor containerlogs.ResumeCursor
	cursor.Observe(resumeOrigin, "old line")
	opts := jobScope
	opts.Resume = []containerTarget{
		{namespace: "default", pod: "migrate-a", container: "a", cursor: cursor},
		{namespace: "default", pod: "migrate-b", container: "b", cursor: cursor.Clone()},
	}
	harness := startRunWith(t, runSetup{
		opts: opts, initial: []*corev1.Pod{jobPod("migrate-a", "migrate", "a")}, respond: linesPerContainer,
		afterResolve: func(client *fake.Clientset) {
			require.NoError(t, client.Tracker().Add(jobPod("migrate-b", "migrate", "b")))
		},
	})

	harness.expectLine("b line")
	harness.logs.mu.Lock()
	defer harness.logs.mu.Unlock()
	for i, container := range harness.logs.containers {
		if container == "a" {
			require.NotNil(t, harness.logs.sinceTimes[i], "a pod the session started with resumes")
		} else {
			require.Nil(t, harness.logs.sinceTimes[i], "a pod that appeared later starts fresh")
		}
	}
}

// A resumed tab still holds lines of pods that ended while it was away; the
// session names them so the client can drop them. A pod recreated with the
// same name exists again and is not named.
func TestResumedSessionNamesPodsThatNoLongerExist(t *testing.T) {
	session := startLogSession(t, sessionSetup{
		request: Request{
			Scope: "cluster-a|default:apps/v1:Deployment:web", MaxEntries: 50,
			Resume: []ResumePoint{
				{Pod: "web-0", Container: "app", Timestamp: resumeAt(time.Millisecond), Lines: []string{"kept"}},
				{Pod: "web-gone", Container: "app", Timestamp: resumeAt(time.Millisecond), Lines: []string{"gone"}},
				{Pod: "web-gone", Container: "sidecar", Timestamp: resumeAt(time.Millisecond), Lines: []string{"gone too"}},
			},
		},
		objects: []runtime.Object{webDeployment(), runningPod("web-0", "app")},
		respond: replayFrom([]time.Duration{time.Millisecond}, []string{"kept"}),
	})

	frames := session.snapshot(t)
	require.True(t, frames[0].Resumed)
	require.Equal(t, []string{"web-gone"}, frames[0].RemovedPods)
}
