package backend

import (
	"sync"
	"testing"
)

func TestTerminalResizeAdmittedBeforeSessionClose(t *testing.T) {
	session := &shellSession{sizeQueue: newTerminalSizeQueue()}
	// ResizeShellSession can retain this reference while lifecycle cleanup removes
	// and closes the session. A late resize must not send to a closed channel.
	queue := session.sizeQueue
	queue.Set(80, 24)
	session.Close()
	queue.Set(120, 40)
	if size := queue.Next(); size == nil || size.Width != 80 || size.Height != 24 {
		t.Fatalf("close discarded an already queued resize: %+v", size)
	}
	if size := queue.Next(); size != nil {
		t.Fatalf("closed session accepted a late resize: %+v", size)
	}
}

func TestTerminalResizeConcurrentWithSessionClose(t *testing.T) {
	for range 100 {
		session := &shellSession{sizeQueue: newTerminalSizeQueue()}
		var workers sync.WaitGroup
		workers.Add(2)
		go func() {
			defer workers.Done()
			for range 20 {
				session.sizeQueue.Set(80, 24)
			}
		}()
		go func() {
			defer workers.Done()
			session.Close()
		}()
		workers.Wait()
		for session.sizeQueue.Next() != nil {
		}
	}
}
