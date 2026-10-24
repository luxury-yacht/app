package backend

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateContainerLogsStreamHandler routes container logs stream requests to the requested cluster.
type aggregateContainerLogsStreamHandler struct {
	handlers map[string]*containerlogsstream.Handler
	mu       sync.RWMutex
}

// newAggregateContainerLogsStreamHandler builds a container logs stream router for all active clusters.
func newAggregateContainerLogsStreamHandler(subsystems map[string]*system.Subsystem) *aggregateContainerLogsStreamHandler {
	handlers := make(map[string]*containerlogsstream.Handler)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.ContainerLogs == nil {
			continue
		}
		handlers[id] = subsystem.ContainerLogs
	}
	return &aggregateContainerLogsStreamHandler{handlers: handlers}
}

// Handle forwards the first client frame to the matching cluster handler.
func (h *aggregateContainerLogsStreamHandler) Handle(
	ctx context.Context,
	conn containerlogsstream.JSONSender,
	request containerlogsstream.Request,
) error {
	targetID, _ := refresh.SplitClusterScope(request.Scope)
	if targetID == "" {
		return errorstatus.BadRequest(errors.New("container logs stream requires a cluster scope"))
	}
	h.mu.RLock()
	handler := h.handlers[targetID]
	h.mu.RUnlock()
	if handler == nil {
		// Its refresh subsystem is being rebuilt; a reconnect can succeed.
		return errorstatus.ClusterNotReady(fmt.Errorf("cluster %s not active", targetID))
	}
	handler.Handle(ctx, conn, request)
	return nil
}

// Update refreshes the container logs stream handlers after selection changes.
func (h *aggregateContainerLogsStreamHandler) Update(subsystems map[string]*system.Subsystem) {
	if h == nil {
		return
	}
	next := newAggregateContainerLogsStreamHandler(subsystems)
	h.mu.Lock()
	h.handlers = next.handlers
	h.mu.Unlock()
}
