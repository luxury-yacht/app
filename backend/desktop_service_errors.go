package backend

import (
	"encoding/json"
	"errors"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/internal/panelwindow"
)

// MarshalBindingError is the DesktopService error marshaler: every error a
// bound method returns reaches the frontend as a typed status in the rejected
// call's cause. Wails framework failures (a panic, a wrong argument count, an
// unknown method) never reach it and carry no cause.
func MarshalBindingError(err error) []byte {
	var conflict panelwindow.WorkspaceConflict
	if errors.As(err, &conflict) {
		err = errorstatus.Conflict(err)
	}
	data, marshalErr := json.Marshal(errorstatus.Classify(err))
	if marshalErr != nil {
		// Returning nil makes Wails fall back to its default marshaler.
		return nil
	}
	return data
}
