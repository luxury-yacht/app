package containerlogsstream

import (
	"fmt"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/stretchr/testify/require"
)

func pendingEntryAt(ms int, line string) Entry {
	return Entry{Timestamp: time.Unix(1000, 0).Add(time.Duration(ms) * time.Millisecond).UTC().Format(time.RFC3339Nano), Line: line}
}

// History larger than the holding limits keeps the newest lines and reports
// the rest as trimmed. It is not "dropped": nothing fell behind.
func TestStartupHistoryOverflowIsTrimmedNotDropped(t *testing.T) {
	pending := newPendingEntries(4, 1<<20).collectHistory(3, 1<<20)
	// More history than the four entries the live buffer holds, with the
	// newest lines arriving last.
	for i := range 6 {
		pending.add(pendingEntryAt(i, fmt.Sprintf("old-%d", i)))
	}
	for i := range 3 {
		pending.add(pendingEntryAt(100+i, fmt.Sprintf("new-%d", i)))
	}

	kept, trimmed, dropped := pending.takeSnapshot()
	require.Equal(t, []string{"new-0", "new-1", "new-2"}, entryLines([]EventPayload{{Entries: kept}}))
	require.Equal(t, 6, trimmed)
	require.Zero(t, dropped)
}

// Once the first view is taken, a full buffer means the client fell behind.
func TestLiveOverflowAfterTheSnapshotIsDropped(t *testing.T) {
	pending := newPendingEntries(2, 1<<20).collectHistory(3, 1<<20)
	pending.add(pendingEntryAt(0, "history"))
	_, _, _ = pending.takeSnapshot()

	for i := range 3 {
		pending.add(pendingEntryAt(10+i, fmt.Sprintf("live-%d", i)))
	}
	entries, dropped := pending.take()
	require.Equal(t, []string{"live-0", "live-1"}, entryLines([]EventPayload{{Entries: entries}}))
	require.Equal(t, 1, dropped)
}

// A delivery loop that falls behind still sends the newest target-limit
// warning: a newer list replaces one it has not taken yet.
func TestWarningUpdatesKeepTheNewestWhileDeliveryIsBehind(t *testing.T) {
	updates := newWarningUpdates()
	var current []containerlogs.Warning
	for hidden := 1; hidden <= 9; hidden++ {
		emitWarningsIfChanged(updates, &current, []containerlogs.Warning{{Kind: containerlogs.WarningTargetLimit, Hidden: hidden}})
	}

	<-updates.notify
	require.Equal(t, 9, updates.take()[0].Hidden)
}
