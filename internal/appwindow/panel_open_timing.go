package appwindow

import (
	"encoding/json"
	"os"
	"time"
)

type panelOpenTimingStage struct {
	Stage     string  `json:"stage"`
	ElapsedMS float64 `json:"elapsedMs"`
}

type panelOpenTiming struct {
	started                      time.Time
	now                          func() time.Time
	transferID, clusterID, phase string
	stages                       []panelOpenTimingStage
	log                          func(string, string)
}

// ConfigurePanelOpenTiming connects opt-in diagnostics to the existing app log.
// This is set by composition before windows are created, never during a transfer.
func (r *Registry) ConfigurePanelOpenTiming(log func(message, clusterID string)) {
	if os.Getenv("VITE_PANEL_OPEN_TIMING") == "1" {
		r.panelOpenTimingLog = log
	}
}

func newPanelOpenTiming(transferID, clusterID, phase string, log func(string, string)) *panelOpenTiming {
	if log == nil {
		return nil
	}
	return &panelOpenTiming{started: time.Now(), now: time.Now, transferID: transferID, clusterID: clusterID, phase: phase, log: log}
}

func (t *panelOpenTiming) mark(stage string) {
	if t != nil {
		t.stages = append(t.stages, panelOpenTimingStage{Stage: stage, ElapsedMS: float64(t.now().Sub(t.started)) / float64(time.Millisecond)})
	}
}

// Batch output after the operation returns so logging is outside transfer locks.
func (t *panelOpenTiming) report() {
	if t == nil {
		return
	}
	data, err := json.Marshal(struct {
		TransferID    string                 `json:"transferId"`
		Phase         string                 `json:"phase"`
		StartedUnixMS float64                `json:"startedUnixMs"`
		TotalMS       float64                `json:"totalMs"`
		Stages        []panelOpenTimingStage `json:"stages"`
	}{t.transferID, t.phase, float64(t.started.UnixMicro()) / 1000, float64(t.now().Sub(t.started)) / float64(time.Millisecond), t.stages})
	if err == nil {
		t.log("[DEBUG-panel-open] "+string(data), t.clusterID)
	}
}
