package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/luxury-yacht/app/internal/appstate"
)

const persistenceSchemaVersion = 1
const gridTablePersistenceVersionKey = "v1"

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
			GridTable: map[string]map[string]json.RawMessage{
				gridTablePersistenceVersionKey: make(map[string]json.RawMessage),
			},
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
	if state.Tables.GridTable[gridTablePersistenceVersionKey] == nil {
		state.Tables.GridTable[gridTablePersistenceVersionKey] = make(map[string]json.RawMessage)
	}
	return state
}

// getPersistenceFilePath returns the path to the new persistence.json location.
func (s *UIStateStore) getPersistenceFilePath() (string, error) {
	manifest, err := appstate.Resolve("luxury-yacht")
	if err != nil {
		return "", fmt.Errorf("could not find config directory: %w", err)
	}
	return manifest.UIStatePath(), nil
}

// loadPersistenceFile reads persistence.json or returns defaults when missing.
func (s *UIStateStore) loadPersistenceFile() (*persistenceFile, error) {
	configFile, err := s.getPersistenceFilePath()
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
func (s *UIStateStore) savePersistenceFile(state *persistenceFile) error {
	if state == nil {
		return fmt.Errorf("no persistence state to save")
	}

	configFile, err := s.getPersistenceFilePath()
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

// normalizeClusterTabOrder removes empty entries and duplicates while preserving order.
func normalizeClusterTabOrder(order []string) []string {
	normalized := make([]string, 0, len(order))
	seen := make(map[string]struct{}, len(order))
	for _, entry := range order {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
}

// persistenceFileExists reports whether persistence.json exists on disk.
func (s *UIStateStore) persistenceFileExists() (string, bool, error) {
	path, err := s.getPersistenceFilePath()
	if err != nil {
		return "", false, err
	}
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return path, false, nil
		}
		return path, false, err
	}
	return path, true, nil
}

// cloneRawMessageMap copies persisted payloads to avoid sharing buffers.
func cloneRawMessageMap(entries map[string]json.RawMessage) map[string]json.RawMessage {
	cloned := make(map[string]json.RawMessage, len(entries))
	for key, value := range entries {
		cloned[key] = append(json.RawMessage(nil), value...)
	}
	return cloned
}

// GetClusterTabOrder returns the persisted cluster tab order.
func (s *UIStateStore) GetClusterTabOrder() ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadPersistenceFile()
	if err != nil {
		return nil, err
	}
	return append([]string(nil), state.ClusterTabs.Order...), nil
}

// SetClusterTabOrder stores the persisted cluster tab order.
func (s *UIStateStore) SetClusterTabOrder(order []string) error {
	normalized := normalizeClusterTabOrder(order)

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadPersistenceFile()
	if err != nil {
		return err
	}
	state.ClusterTabs.Order = normalized
	return s.savePersistenceFile(state)
}

// GetGridTablePersistence returns all persisted GridTable entries for v1.
func (s *UIStateStore) GetGridTablePersistence() (map[string]json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadPersistenceFile()
	if err != nil {
		return nil, err
	}
	entries := state.Tables.GridTable[gridTablePersistenceVersionKey]
	if entries == nil {
		return map[string]json.RawMessage{}, nil
	}
	return cloneRawMessageMap(entries), nil
}

// SetGridTablePersistence stores a GridTable persistence payload by key.
func (s *UIStateStore) SetGridTablePersistence(key string, payload json.RawMessage) error {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return fmt.Errorf("grid table persistence key is required")
	}
	if len(payload) == 0 {
		return fmt.Errorf("grid table persistence payload is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadPersistenceFile()
	if err != nil {
		return err
	}
	entries := state.Tables.GridTable[gridTablePersistenceVersionKey]
	if entries == nil {
		entries = make(map[string]json.RawMessage)
		state.Tables.GridTable[gridTablePersistenceVersionKey] = entries
	}
	entries[trimmed] = payload
	return s.savePersistenceFile(state)
}

// DeleteGridTablePersistence removes a single GridTable persistence entry.
func (s *UIStateStore) DeleteGridTablePersistence(key string) error {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	_, exists, err := s.persistenceFileExists()
	if err != nil || !exists {
		return err
	}

	state, err := s.loadPersistenceFile()
	if err != nil {
		return err
	}
	entries := state.Tables.GridTable[gridTablePersistenceVersionKey]
	if entries == nil {
		return nil
	}
	delete(entries, trimmed)
	return s.savePersistenceFile(state)
}

// DeleteGridTablePersistenceEntries removes multiple GridTable persistence entries at once.
func (s *UIStateStore) DeleteGridTablePersistenceEntries(keys []string) error {
	if len(keys) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	_, exists, err := s.persistenceFileExists()
	if err != nil || !exists {
		return err
	}

	state, err := s.loadPersistenceFile()
	if err != nil {
		return err
	}
	entries := state.Tables.GridTable[gridTablePersistenceVersionKey]
	if entries == nil {
		return nil
	}

	for _, key := range keys {
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			continue
		}
		delete(entries, trimmed)
	}

	return s.savePersistenceFile(state)
}

// ClearGridTablePersistence removes all GridTable persistence entries for v1.
func (s *UIStateStore) ClearGridTablePersistence() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, exists, err := s.persistenceFileExists()
	if err != nil || !exists {
		return 0, err
	}

	state, err := s.loadPersistenceFile()
	if err != nil {
		return 0, err
	}
	entries := state.Tables.GridTable[gridTablePersistenceVersionKey]
	removed := len(entries)
	state.Tables.GridTable[gridTablePersistenceVersionKey] = make(map[string]json.RawMessage)
	if err := s.savePersistenceFile(state); err != nil {
		return 0, err
	}
	return removed, nil
}

// GetFavorites returns a copy of the persisted favorites list.
