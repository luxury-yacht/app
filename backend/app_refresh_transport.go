package backend

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/streammux"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type refreshServiceHandler struct {
	handler http.Handler
}

const refreshSubsystemUnavailableMessage = "refresh subsystem not initialised"

// ServeHTTP is mounted by Wails at /api/v2. The framework strips that prefix
// before dispatch, so every route in the published mux is mount-relative.
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	published := a.refreshService.Load()
	if published == nil || published.handler == nil {
		http.Error(w, refreshSubsystemUnavailableMessage, http.StatusServiceUnavailable)
		return
	}
	published.handler.ServeHTTP(w, r)
}

func (a *App) publishRefreshService(handler http.Handler, subsystems map[string]*system.Subsystem) {
	a.refreshManager = nil
	a.replaceRefreshSubsystems(subsystems)

	a.telemetryRecorder = nil
	a.sharedInformerFactory = nil
	a.apiExtensionsInformerFactory = nil
	for _, subsystem := range subsystems {
		if subsystem == nil {
			continue
		}
		if a.telemetryRecorder == nil && subsystem.Telemetry != nil {
			a.telemetryRecorder = subsystem.Telemetry
		}
		if a.sharedInformerFactory == nil && subsystem.InformerFactory != nil {
			a.sharedInformerFactory = subsystem.InformerFactory.SharedInformerFactory()
			a.apiExtensionsInformerFactory = subsystem.InformerFactory.APIExtensionsInformerFactory()
		}
	}
	a.refreshService.Store(&refreshServiceHandler{handler: handler})
}

// HandleResourceStream serves the refresh-resource named stream registered by
// application composition.
func (a *App) HandleResourceStream(conn *application.StreamConn) {
	aggregates := a.refreshAggregates.Load()
	if aggregates == nil || aggregates.resources == nil {
		_ = conn.SendJSON(streammux.ServerMessage{
			Type: streammux.MessageTypeError, Error: refreshSubsystemUnavailableMessage,
		})
		return
	}
	aggregates.resources.Handle(conn.Context(), conn)
}

// HandleContainerLogsStream serves the container-logs named stream registered
// by application composition.
func (a *App) HandleContainerLogsStream(conn *application.StreamConn) {
	var request containerlogsstream.Request
	if err := conn.ReceiveJSON(&request); err != nil {
		sendContainerLogsStreamError(conn, request.Scope, fmt.Sprintf("invalid container logs stream request: %v", err))
		return
	}
	aggregates := a.refreshAggregates.Load()
	if aggregates == nil || aggregates.containerLogs == nil {
		sendContainerLogsStreamError(conn, request.Scope, refreshSubsystemUnavailableMessage)
		return
	}
	if err := aggregates.containerLogs.Handle(conn.Context(), conn, request); err != nil {
		sendContainerLogsStreamError(conn, request.Scope, err.Error())
	}
}

func sendContainerLogsStreamError(conn *application.StreamConn, scope, message string) {
	_ = conn.SendJSON(containerlogsstream.EventPayload{
		Domain: "container-logs", Scope: strings.TrimSpace(scope), Sequence: 1,
		GeneratedAt: time.Now().UnixMilli(), Error: message,
	})
}
