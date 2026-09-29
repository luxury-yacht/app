package containerlogs

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type testLine struct {
	at   time.Time
	text string
}

var (
	resumeBase = time.Date(2026, 9, 28, 10, 0, 0, 500, time.UTC)
	tEarlier   = resumeBase.Add(-time.Millisecond)
	tGroup     = resumeBase
	tLater     = resumeBase.Add(time.Millisecond)
)

func at(ts time.Time, texts ...string) []testLine {
	lines := make([]testLine, 0, len(texts))
	for _, text := range texts {
		lines = append(lines, testLine{at: ts, text: text})
	}
	return lines
}

func joinLines(groups ...[]testLine) []testLine {
	var all []testLine
	for _, group := range groups {
		all = append(all, group...)
	}
	return all
}

// readStream offers every line to a tracker for one opened stream and returns
// what it delivered, including lines released when the stream ends.
func readStream(cursor *ResumeCursor, lines []testLine) []string {
	tracker := NewLineTracker[string](cursor)
	var delivered []string
	for _, line := range lines {
		delivered = append(delivered, tracker.Offer(line.at, line.text, line.text, resumeBase)...)
	}
	return append(delivered, tracker.Finish()...)
}

func TestLineTrackerDeliversIdenticalLinesAtOneTimestamp(t *testing.T) {
	var cursor ResumeCursor
	require.Equal(t, []string{"ping", "ping"}, readStream(&cursor, at(tGroup, "ping", "ping")))
}

func TestLineTrackerResumeSkipsExactlyTheDeliveredLines(t *testing.T) {
	var cursor ResumeCursor
	readStream(&cursor, joinLines(at(tEarlier, "x"), at(tGroup, "a", "b")))
	require.Equal(t, tGroup, cursor.Since())

	replay := joinLines(at(tEarlier, "x"), at(tGroup, "a", "b", "c"), at(tLater, "d"))
	require.Equal(t, []string{"c", "d"}, readStream(&cursor, replay))
}

// A tail read returns the end of the log, so it can start inside a
// same-timestamp group. The replay must still deliver only the unseen lines.
func TestLineTrackerHandlesATailThatStartedMidGroup(t *testing.T) {
	var cursor ResumeCursor
	// [A, B, C] share a timestamp; a tail-2 read returned [B, C].
	readStream(&cursor, at(tGroup, "B", "C"))

	replay := joinLines(at(tGroup, "A", "B", "C"), at(tLater, "D"))
	require.Equal(t, []string{"D"}, readStream(&cursor, replay))
}

func TestLineTrackerRecoversAnInterruptedTail(t *testing.T) {
	var cursor ResumeCursor
	// [A, B, C, D] share a timestamp; a tail-2 read delivered C, then dropped.
	readStream(&cursor, at(tGroup, "C"))

	require.Equal(t, []string{"D"}, readStream(&cursor, at(tGroup, "A", "B", "C", "D")))
}

func TestLineTrackerNeverLosesUnreadLinesWhenTheReplayIsAmbiguous(t *testing.T) {
	var cursor ResumeCursor
	// Four identical lines share a timestamp; a tail-2 read delivered the third,
	// then dropped. Its position cannot be told apart from the others.
	readStream(&cursor, at(tGroup, "X"))

	delivered := readStream(&cursor, at(tGroup, "X", "X", "X", "X"))
	// The earliest match is the first X, so the other three are released: the
	// unread fourth line is among them, at the cost of repeats.
	require.Equal(t, []string{"X", "X", "X"}, delivered)
}

func TestLineTrackerReleasesTheGroupWhenTheRunIsAbsent(t *testing.T) {
	var cursor ResumeCursor
	readStream(&cursor, at(tGroup, "a"))

	// The log rotated during the disconnect: the delivered line is gone.
	replay := joinLines(at(tGroup, "z"), at(tLater, "y"))
	require.Equal(t, []string{"z", "y"}, readStream(&cursor, replay))
}

func TestLineTrackerResumesByCountAfterACompleteGroup(t *testing.T) {
	var cursor ResumeCursor
	readStream(&cursor, joinLines(at(tEarlier, "x"), at(tGroup, "a", "b")))

	replay := joinLines(at(tEarlier, "x"), at(tGroup, "a", "b", "c"))
	require.Equal(t, []string{"c"}, readStream(&cursor, replay))
}

// On an open stream nothing may be held indefinitely: a quiet stream releases
// unmatched lines after one idle window.
func TestLineTrackerReleasesHeldLinesWhenTheStreamGoesQuiet(t *testing.T) {
	var cursor ResumeCursor
	readStream(&cursor, at(tGroup, "B", "C"))

	tracker := NewLineTracker[string](&cursor)
	start := time.Unix(100, 0)
	require.Empty(t, tracker.Offer(tGroup, "X", "X", start))
	require.Empty(t, tracker.Offer(tGroup, "Y", "Y", start))

	deadline, ok := tracker.Deadline()
	require.True(t, ok)
	require.Equal(t, start.Add(ReplayIdle), deadline)
	require.Empty(t, tracker.Expire(deadline.Add(-time.Nanosecond)))
	require.Equal(t, []string{"X", "Y"}, tracker.Expire(deadline))
	_, ok = tracker.Deadline()
	require.False(t, ok)
}

func TestLineTrackerCapsHowLongATrickleIsHeld(t *testing.T) {
	var cursor ResumeCursor
	readStream(&cursor, at(tGroup, "B", "C"))

	tracker := NewLineTracker[string](&cursor)
	start := time.Unix(100, 0)
	var released []string
	for i := range 6 {
		now := start.Add(time.Duration(i) * 200 * time.Millisecond)
		released = append(released, tracker.Expire(now)...)
		released = append(released, tracker.Offer(tGroup, "trickle", "trickle", now)...)
	}
	require.NotEmpty(t, released, "the one-second cap releases lines even though the stream never goes idle")
}

func TestLineTrackerReleasesAnOversizedGroupWithoutLoss(t *testing.T) {
	var cursor ResumeCursor
	readStream(&cursor, at(tGroup, "B", "C"))

	tracker := NewLineTracker[string](&cursor)
	chunk := strings.Repeat("x", 512*1024)
	var released []string
	for i := range 5 {
		released = append(released, tracker.Offer(tGroup, chunk, string(rune('a'+i)), resumeBase)...)
	}
	released = append(released, tracker.Finish()...)
	require.Equal(t, []string{"a", "b", "c", "d", "e"}, released)
}

func TestLineTrackerPassesLinesWithoutTimestamps(t *testing.T) {
	var cursor ResumeCursor
	readStream(&cursor, at(tGroup, "a"))

	tracker := NewLineTracker[string](&cursor)
	require.Equal(t, []string{"untimed"}, tracker.Offer(time.Time{}, "untimed", "untimed", resumeBase))
}

func TestResumeCursorCloneSharesNoState(t *testing.T) {
	var cursor ResumeCursor
	readStream(&cursor, at(tGroup, "a"))
	clone := cursor.Clone()
	readStream(&clone, joinLines(at(tGroup, "a", "b")))

	require.Equal(t, []string{"b", "c"}, readStream(&cursor, at(tGroup, "a", "b", "c")),
		"the original cursor still resumes after its own delivered line")
}
