package backend

import (
	"net"
	"sync"
)

func init() {
	defaultLoopbackListener = newTestLoopbackFactory()
}

func newTestLoopbackFactory() func() (net.Listener, error) {
	return func() (net.Listener, error) {
		return newTestLoopbackListener(), nil
	}
}

type testLoopbackListener struct {
	addr      net.Addr
	closeOnce sync.Once
	closed    chan struct{}
}

func newTestLoopbackListener() net.Listener {
	return &testLoopbackListener{
		addr: &net.TCPAddr{
			IP:   net.IPv4(127, 0, 0, 1),
			Port: 0,
		},
		closed: make(chan struct{}),
	}
}

func (l *testLoopbackListener) Accept() (net.Conn, error) {
	<-l.closed
	return nil, net.ErrClosed
}

func (l *testLoopbackListener) Close() error {
	l.closeOnce.Do(func() {
		close(l.closed)
	})
	return nil
}

func (l *testLoopbackListener) Addr() net.Addr {
	return l.addr
}
