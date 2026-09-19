package containerlogsstream

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes/fake"
)

func TestLogStreamRejectsUnsupportedGVKBeforeConnecting(t *testing.T) {
	for _, scope := range []string{
		"cluster-a|default:example.io/v1:Pod:demo",
		"cluster-a|default:/v2:Pod:demo",
		"cluster-a|default:example.io/v1:Deployment:demo",
		"cluster-a|default:apps/v1beta1:Deployment:demo",
		"cluster-a|default:apps/v1:Job:demo",
		"cluster-a|default:batch/v1beta1:CronJob:demo",
	} {
		t.Run(scope, func(t *testing.T) {
			_, err := parseRequest(Request{Scope: scope})
			require.Error(t, err)
		})
	}
	client := fake.NewClientset()
	handler, err := NewHandler(client, nil, nil)
	require.NoError(t, err)
	conn := newNativeLogStreamConn()
	handler.Handle(context.Background(), conn, Request{Scope: "cluster-a|default:example.io/v1:Pod:demo"})
	payloads := conn.waitForPayloads(t, 1)
	require.Len(t, payloads, 1)
	require.NotEmpty(t, payloads[0].Error)
	require.False(t, payloads[0].Reset)
	require.Empty(t, client.Actions())
}

func TestGlobalLogLimitCanChangeWhileSelectionReadsWarnings(t *testing.T) {
	limiter := NewGlobalTargetLimiter(1)
	session := limiter.StartSession("cluster-a", "default:/v1:Pod:demo")
	defer session.Release()
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		for i := range 1000 {
			limiter.SetLimit(i%7 + 1)
		}
		limiter.SetLimit(7)
	}()
	go func() {
		defer workers.Done()
		for range 1000 {
			if targetSessionGlobalLimit(session) < 1 {
				t.Error("selection observed an invalid target budget")
			}
		}
	}()
	workers.Wait()
	require.Equal(t, 7, targetSessionGlobalLimit(session))
}
