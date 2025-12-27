package backend

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

func TestStopObjectCatalogCancelsAndResets(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)

	cancelCalled := 0
	done := make(chan struct{}, 1)
	done <- struct{}{}
	app.storeObjectCatalogEntry("primary", &objectCatalogEntry{
		service: &objectcatalog.Service{},
		cancel:  func() { cancelCalled++ },
		done:    done,
	}, true)
	app.telemetryRecorder = telemetry.NewRecorder()

	app.stopObjectCatalog()

	if cancelCalled != 1 {
		t.Fatalf("expected cancel to be invoked once, got %d", cancelCalled)
	}
	if app.objectCatalogServiceForCluster("") != nil {
		t.Fatalf("expected catalog references to be cleared")
	}

	summary := app.telemetryRecorder.SnapshotSummary()
	if summary.Catalog != nil && summary.Catalog.Enabled {
		t.Fatalf("expected catalog telemetry to be disabled")
	}
}

func TestGetCatalogDiagnosticsCombinesTelemetryAndServiceState(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.storeObjectCatalogEntry("primary", &objectCatalogEntry{
		service: &objectcatalog.Service{},
	}, true)
	app.telemetryRecorder = telemetry.NewRecorder()

	app.telemetryRecorder.RecordCatalog(true, 7, 3, 1500*time.Millisecond, nil)

	diag, err := app.GetCatalogDiagnostics()
	if err != nil {
		t.Fatalf("GetCatalogDiagnostics returned error: %v", err)
	}
	if !diag.Enabled {
		t.Fatalf("expected diagnostics to report enabled catalog")
	}
	if diag.ItemCount != 7 || diag.ResourceCount != 3 {
		t.Fatalf("unexpected counts: %#v", diag)
	}
	if diag.LastSyncMs == 0 || diag.LastSuccessMs == 0 {
		t.Fatalf("expected sync timings to be populated")
	}
	if diag.Status != "success" {
		t.Fatalf("expected status success, got %s", diag.Status)
	}
}
