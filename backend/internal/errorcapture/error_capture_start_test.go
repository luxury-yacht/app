package errorcapture

import (
	"bytes"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCaptureStartAndEnhance(t *testing.T) {
	originalStderr := os.Stderr
	defer func() { os.Stderr = originalStderr }()

	c := &Capture{buffer: &bytes.Buffer{}}
	global = c

	var sinkLevels []string
	SetLogSink(func(level string, message string) {
		sinkLevels = append(sinkLevels, fmt.Sprintf("%s:%s", level, message))
	})
	defer SetLogSink(nil)

	c.start()
	require.True(t, c.capturing, "capture should start capturing stderr")

	_, err := c.pipeWriter.Write([]byte("E token expired\n"))
	require.NoError(t, err)

	Wait()

	enhanced := Enhance(fmt.Errorf("original error"))
	require.Error(t, enhanced)
	require.Contains(t, enhanced.Error(), "token expired")
	require.NotEmpty(t, sinkLevels, "log sink should record emitted chunk")

	// cleanup the pipe to stop the goroutine
	_ = c.pipeWriter.Close()
	_ = c.pipeReader.Close()
	global = nil

	time.Sleep(10 * time.Millisecond)
}
