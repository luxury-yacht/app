package errorcapture

import (
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// recordingSink installs a log sink that records "level:message" entries and
// removes it when the test ends.
func recordingSink(t *testing.T) func() []string {
	t.Helper()
	var mu sync.Mutex
	var logs []string
	SetLogSink(func(level, message string) {
		mu.Lock()
		defer mu.Unlock()
		logs = append(logs, level+":"+message)
	})
	t.Cleanup(func() { SetLogSink(nil) })
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), logs...)
	}
}

// Client libraries repeat the same failure on every retry (for example an auth
// failure each probe); App Logs keeps the first occurrence per session.
func TestEmitToLogSinkLogsRepeatedWarningsAndErrorsOnce(t *testing.T) {
	c := &Capture{}
	logs := recordingSink(t)

	c.emitToLogSink([]byte("E1011 10:00:00.000001   12345 reflector.go:569] Failed to watch: token expired\n"))
	c.emitToLogSink([]byte("E1011 10:00:05.000002   12345 reflector.go:569] Failed to watch: token expired\n"))
	c.emitToLogSink([]byte("Error loading SSO Token: Token for dev does not exist\n"))
	c.emitToLogSink([]byte("Error loading SSO Token: Token for dev does not exist\n"))
	c.emitToLogSink([]byte("E1011 10:00:06.000003   12345 reflector.go:569] Failed to watch: connection refused\n"))
	c.emitToLogSink([]byte("I1011 10:00:07.000004   12345 shared_informer.go:1] informer started\n"))
	c.emitToLogSink([]byte("I1011 10:00:08.000005   12345 shared_informer.go:1] informer started\n"))

	require.Equal(t, []string{
		"error:E1011 10:00:00.000001   12345 reflector.go:569] Failed to watch: token expired",
		"error:Error loading SSO Token: Token for dev does not exist",
		"error:E1011 10:00:06.000003   12345 reflector.go:569] Failed to watch: connection refused",
		"info:I1011 10:00:07.000004   12345 shared_informer.go:1] informer started",
		"info:I1011 10:00:08.000005   12345 shared_informer.go:1] informer started",
	}, logs())
}

func TestInitIsIdempotent(t *testing.T) {
	Init()
	first := global
	Init() // second call should be harmless

	require.Same(t, first, global, "a second Init must not replace the capture")
}

func TestPermissionDeniedStderrIsInformational(t *testing.T) {
	const line = `E0805 reflector.go:200] "Failed to watch" err="applicationnetworkpolicies.networking.k8s.aws is forbidden: User cannot watch resource"`
	c := &Capture{}
	logs := recordingSink(t)

	c.emitToLogSink([]byte(line + "\n"))

	require.Equal(t, []string{"info:" + line}, logs(), "expected RBAC denial to be informational")
}

func TestExpectedConditionDoesNotMatchIncidental403Numbers(t *testing.T) {
	lines := []string{
		`E0805 10:15:30.123456 17 reflector.go:403] "Failed to watch" err="connection refused"`,
		`E0805 10:15:30.123456 403 shared_informer.go:314] unable to sync caches`,
		`E0805 10:15:30.123456 17 round_trippers.go:63] dial tcp 10.0.0.1:403: i/o timeout`,
		`E0805 10:15:30.123456 17 transport.go:301] request took 403 ms`,
	}

	for _, line := range lines {
		t.Run(line, func(t *testing.T) {
			require.False(t, isExpectedCondition(strings.ToLower(line)))
		})
	}
}

func TestExpectedConditionMatchesStructured403Status(t *testing.T) {
	lines := []string{
		`request failed with HTTP 403`,
		`request failed with status code 403`,
		`server responded with a status of 403`,
	}

	for _, line := range lines {
		t.Run(line, func(t *testing.T) {
			require.True(t, isExpectedCondition(strings.ToLower(line)))
		})
	}
}

func TestEmitToLogSinkClassifiesLevels(t *testing.T) {
	c := &Capture{}
	logs := recordingSink(t)

	c.emitToLogSink([]byte("E1010 10:00:00 error occurred\nW1010 warning issued\nI1010 info line\nExternal secrets cache ready\nrequest failed while listing pods\n"))

	require.Equal(t, []string{
		"error:E1010 10:00:00 error occurred",
		"warn:W1010 warning issued",
		"info:I1010 info line",
		"info:External secrets cache ready",
		"error:request failed while listing pods",
	}, logs())
}

func TestStartRoutesStderrWritesToLogSink(t *testing.T) {
	originalStderr := os.Stderr
	defer func() { os.Stderr = originalStderr }()

	c := &Capture{}
	logs := recordingSink(t)

	c.start()
	require.True(t, c.capturing, "capture should start capturing stderr")

	_, err := os.Stderr.Write([]byte("E1011 10:00:00.000001 1 client.go:1] token expired\n"))
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		entries := logs()
		return len(entries) == 1 && strings.Contains(entries[0], "token expired")
	}, time.Second, 5*time.Millisecond, "a stderr write must reach the log sink")

	_ = c.pipeWriter.Close()
	_ = c.pipeReader.Close()
}

// TestReadPipeReassemblesLineSplitAcrossReads: readPipe reads stderr in
// 4096-byte chunks, so a single Read can end mid-line. The line has to be
// reassembled across reads rather than logged per raw chunk.
func TestReadPipeReassemblesLineSplitAcrossReads(t *testing.T) {
	c := &Capture{}
	logs := recordingSink(t)
	r, w, err := os.Pipe()
	require.NoError(t, err)
	c.pipeReader = r

	// Pad so the keyword spans byte 4096: the first 4096-byte Read ends
	// mid-keyword, the next Read begins with the rest.
	line := strings.Repeat("x", 4089) + " unauthorized"
	_, err = w.WriteString(line + "\n")
	require.NoError(t, err)
	require.NoError(t, w.Close())

	c.readPipe() // drains the pipe then returns at EOF

	entries := logs()
	require.Len(t, entries, 1, "a line straddling the read boundary must be logged once, whole")
	require.True(t, strings.HasSuffix(entries[0], line))
}

// TestReadPipeFlushesUnterminatedFinalLine ensures reassembly never drops a final
// line that arrives without a trailing newline; it must be flushed at EOF.
func TestReadPipeFlushesUnterminatedFinalLine(t *testing.T) {
	c := &Capture{}
	logs := recordingSink(t)
	r, w, err := os.Pipe()
	require.NoError(t, err)
	c.pipeReader = r

	_, err = w.WriteString("token has expired") // no trailing newline
	require.NoError(t, err)
	require.NoError(t, w.Close())

	c.readPipe()

	require.Equal(t, []string{"info:token has expired"}, logs(),
		"a final line without a trailing newline must still be logged at EOF")
}

// TestReadPipeValveFlushesOverlongUnterminatedLine ensures an unterminated line
// exceeding maxPendingLineBytes is flushed mid-stream — before any newline or
// EOF — rather than buffered without bound. The pipe stays open during the
// assertion, so only the size valve (not EOF) can trigger the flush.
func TestReadPipeValveFlushesOverlongUnterminatedLine(t *testing.T) {
	old := maxPendingLineBytes
	maxPendingLineBytes = 32
	t.Cleanup(func() { maxPendingLineBytes = old })

	c := &Capture{}
	logs := recordingSink(t)
	r, w, err := os.Pipe()
	require.NoError(t, err)
	c.pipeReader = r
	t.Cleanup(func() { _ = r.Close() })

	done := make(chan struct{})
	go func() { c.readPipe(); close(done) }()

	_, err = w.WriteString("unauthorized access " + strings.Repeat("y", 64))
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		entries := logs()
		return len(entries) == 1 && strings.Contains(entries[0], "unauthorized access")
	}, time.Second, 5*time.Millisecond,
		"valve should flush an over-cap unterminated line before EOF")

	require.NoError(t, w.Close())
	<-done
}
