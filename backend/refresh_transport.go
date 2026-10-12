package backend

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/refresh/api"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/streammux"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type refreshServiceHandler struct {
	handler http.Handler
}

const refreshSubsystemUnavailableMessage = "refresh subsystem not initialised"

// ServeHTTP is mounted by Wails at /api/v2. The framework strips that prefix
// before dispatch, so every route in the published mux is mount-relative.
func (c *RefreshCoordinator) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	published := c.refreshService.Load()
	if published == nil || published.handler == nil {
		api.WriteError(w, r, errorstatus.RefreshUnavailable(errors.New(refreshSubsystemUnavailableMessage)))
		return
	}
	published.handler.ServeHTTP(w, r)
}

func (c *RefreshCoordinator) publishRefreshService(handler http.Handler, subsystems map[string]*system.Subsystem) {
	c.replaceRefreshSubsystems(subsystems)

	var telemetryRecorder *telemetry.Recorder
	for _, subsystem := range subsystems {
		if subsystem == nil {
			continue
		}
		if telemetryRecorder == nil && subsystem.Telemetry != nil {
			telemetryRecorder = subsystem.Telemetry
		}
	}
	c.setTelemetryRecorder(telemetryRecorder)
	c.refreshService.Store(&refreshServiceHandler{handler: handler})
}

// HandleResourceStream serves the refresh-resource named stream registered by
// application composition.
func (c *RefreshCoordinator) HandleResourceStream(conn *application.StreamConn) {
	aggregates := c.refreshAggregates.Load()
	if aggregates == nil || aggregates.resources == nil {
		_ = conn.SendJSON(streammux.ErrorMessage("", errorstatus.RefreshUnavailable(errors.New(refreshSubsystemUnavailableMessage))))
		return
	}
	aggregates.resources.Handle(conn.Context(), conn)
}

// HandleContainerLogsStream serves the container-logs named stream registered
// by application composition.
func (c *RefreshCoordinator) HandleContainerLogsStream(conn *application.StreamConn) {
	c.serveContainerLogsStream(conn)
}

// containerLogsStreamConn is the part of a Wails stream connection the
// container-logs stream uses.
type containerLogsStreamConn interface {
	containerlogsstream.JSONSender
	ReceiveJSON(v any) error
	Context() context.Context
}

func (c *RefreshCoordinator) serveContainerLogsStream(conn containerLogsStreamConn) {
	var request containerlogsstream.Request
	if err := conn.ReceiveJSON(&request); err != nil {
		sendContainerLogsStreamError(conn, request.Scope, errorstatus.BadRequest(fmt.Errorf("invalid container logs stream request: %w", err)))
		return
	}
	// The refresh subsystem and its cluster handlers are republished during
	// recovery and cluster rebuilds, so a stream that arrives meanwhile retries.
	aggregates := c.refreshAggregates.Load()
	if aggregates == nil || aggregates.containerLogs == nil {
		sendContainerLogsStreamError(conn, request.Scope, errorstatus.RefreshUnavailable(errors.New(refreshSubsystemUnavailableMessage)))
		return
	}
	if err := aggregates.containerLogs.Handle(conn.Context(), conn, request); err != nil {
		sendContainerLogsStreamError(conn, request.Scope, err)
	}
}

func sendContainerLogsStreamError(conn containerlogsstream.JSONSender, scope string, err error) {
	_ = conn.SendJSON(containerlogsstream.ErrorPayload(scope, err))
}
