package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const persistenceSchemaVersion = 1

// persistenceFile captures the persisted UI state stored in persistence.json.
type persistenceFile struct {
	SchemaVersion int                    `json:"schemaVersion"`
	UpdatedAt     time.Time              `json:"updatedAt"`
	ClusterTabs   persistenceClusterTabs `json:"clusterTabs"`
	Tables        persistenceTables      `json:"tables"`
}

type persistenceClusterTabs struct {
	Order []string `json:"order"`
}

type persistenceTables struct {
	GridTable map[string]map[string]json.RawMessage `json:"gridtable"`
}

// defaultPersistenceFile provides a baseline persistence document with empty state.
func defaultPersistenceFile() *persistenceFile {
	return &persistenceFile{
		SchemaVersion: persistenceSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Tables: persistenceTables{
			GridTable: make(map[string]map[string]json.RawMessage),
		},
	}
}

// normalizePersistenceFile ensures required defaults are present after loading.
func normalizePersistenceFile(state *persistenceFile) *persistenceFile {
	if state == nil {
		return defaultPersistenceFile()
	}
	if state.SchemaVersion == 0 {
		state.SchemaVersion = persistenceSchemaVersion
	}
	if state.Tables.GridTable == nil {
		state.Tables.GridTable = make(map[string]map[string]json.RawMessage)
	}
	return state
}

// getPersistenceFilePath returns the path to the new persistence.json location.
func (a *App) getPersistenceFilePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("could not find config directory: %w", err)
	}

	configDir = filepath.Join(configDir, "luxury-yacht")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %w", err)
	}

	return filepath.Join(configDir, "persistence.json"), nil
}

// loadPersistenceFile reads persistence.json or returns defaults when missing.
func (a *App) loadPersistenceFile() (*persistenceFile, error) {
	configFile, err := a.getPersistenceFilePath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		return defaultPersistenceFile(), nil
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read persistence file: %w", err)
	}

	state := &persistenceFile{}
	if err := json.Unmarshal(data, state); err != nil {
		return nil, fmt.Errorf("failed to parse persistence file: %w", err)
	}

	return normalizePersistenceFile(state), nil
}

// savePersistenceFile writes persistence.json with an updated timestamp.
func (a *App) savePersistenceFile(state *persistenceFile) error {
	if state == nil {
		return fmt.Errorf("no persistence state to save")
	}

	configFile, err := a.getPersistenceFilePath()
	if err != nil {
		return err
	}

	state.SchemaVersion = persistenceSchemaVersion
	state.UpdatedAt = time.Now().UTC()

	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("failed to marshal persistence state: %w", err)
	}

	if err := writeFileAtomic(configFile, data, 0o644); err != nil {
		return fmt.Errorf("failed to write persistence file: %w", err)
	}
	return nil
}
