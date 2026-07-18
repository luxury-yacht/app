package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Favorite represents a user-saved view bookmark.
type Favorite struct {
	ID               string                       `json:"id"`
	Name             string                       `json:"name"`
	ClusterSelection string                       `json:"clusterSelection"`
	ClusterID        string                       `json:"clusterId,omitempty"`
	ClusterName      string                       `json:"clusterName,omitempty"`
	ViewType         string                       `json:"viewType"`
	View             string                       `json:"view"`
	Namespace        string                       `json:"namespace"`
	Panes            map[string]FavoritePaneState `json:"panes"`
	Order            int                          `json:"order"`
}

// FavoritePaneState holds the complete GridTable state for one named pane.
type FavoritePaneState struct {
	Filters    FavoriteFilters    `json:"filters"`
	TableState FavoriteTableState `json:"tableState"`
}

// FavoriteFilters holds the search and filter state for a favorite.
type FavoriteFilters struct {
	Search          string                             `json:"search"`
	Kinds           FavoriteFilterSelection            `json:"kinds"`
	Namespaces      FavoriteFilterSelection            `json:"namespaces"`
	Clusters        FavoriteFilterSelection            `json:"clusters"`
	QueryFacets     map[string]FavoriteFilterSelection `json:"queryFacets,omitempty"`
	CaseSensitive   bool                               `json:"caseSensitive"`
	IncludeMetadata bool                               `json:"includeMetadata"`
}

// FavoriteFilterSelection preserves the semantic difference between every,
// no, and some selected dropdown values.
type FavoriteFilterSelection struct {
	Mode   string   `json:"mode"`
	Values []string `json:"values,omitempty"`
}

// FavoriteTableState holds the table display state for a favorite.
type FavoriteTableState struct {
	SortColumn       string          `json:"sortColumn"`
	SortDirection    string          `json:"sortDirection"`
	ColumnVisibility map[string]bool `json:"columnVisibility"`
}

// favoritesFile is the on-disk format for favorites.json.
type favoritesFile struct {
	SchemaVersion int        `json:"schemaVersion"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	Favorites     []Favorite `json:"favorites"`
}

const favoritesSchemaVersion = 3

// favoriteV2 is the flat, single-table favorite written by schema v2. Keep the
// decoder private: it exists only at the on-disk migration boundary.
type favoriteV2 struct {
	ID               string              `json:"id"`
	Name             string              `json:"name"`
	ClusterSelection string              `json:"clusterSelection"`
	ClusterID        string              `json:"clusterId,omitempty"`
	ClusterName      string              `json:"clusterName,omitempty"`
	ViewType         string              `json:"viewType"`
	View             string              `json:"view"`
	Namespace        string              `json:"namespace"`
	Filters          *FavoriteFilters    `json:"filters"`
	TableState       *FavoriteTableState `json:"tableState"`
	Order            int                 `json:"order"`
}

type favoriteFiltersV1 struct {
	Search          string              `json:"search"`
	Kinds           []string            `json:"kinds"`
	Namespaces      []string            `json:"namespaces"`
	Clusters        []string            `json:"clusters,omitempty"`
	QueryFacets     map[string][]string `json:"queryFacets,omitempty"`
	CaseSensitive   bool                `json:"caseSensitive"`
	IncludeMetadata bool                `json:"includeMetadata"`
}

type favoriteV1 struct {
	ID               string              `json:"id"`
	Name             string              `json:"name"`
	ClusterSelection string              `json:"clusterSelection"`
	ClusterID        string              `json:"clusterId,omitempty"`
	ClusterName      string              `json:"clusterName,omitempty"`
	ViewType         string              `json:"viewType"`
	View             string              `json:"view"`
	Namespace        string              `json:"namespace"`
	Filters          *favoriteFiltersV1  `json:"filters"`
	TableState       *FavoriteTableState `json:"tableState"`
	Order            int                 `json:"order"`
}

type flatFavoritesFile struct {
	SchemaVersion int               `json:"schemaVersion"`
	Favorites     []json.RawMessage `json:"favorites"`
}

func defaultFavoritePaneState() FavoritePaneState {
	return FavoritePaneState{
		Filters: FavoriteFilters{
			Kinds:      FavoriteFilterSelection{Mode: "all"},
			Namespaces: FavoriteFilterSelection{Mode: "all"},
			Clusters:   FavoriteFilterSelection{Mode: "all"},
		},
		TableState: FavoriteTableState{
			SortColumn:       "name",
			SortDirection:    "asc",
			ColumnVisibility: map[string]bool{},
		},
	}
}

func migrateFlatFavorite(legacy favoriteV2) (Favorite, error) {
	if strings.TrimSpace(legacy.ID) == "" || strings.TrimSpace(legacy.Name) == "" ||
		strings.TrimSpace(legacy.ViewType) == "" || strings.TrimSpace(legacy.View) == "" {
		return Favorite{}, fmt.Errorf("favorite is missing required identity or route fields")
	}
	if legacy.Filters == nil || legacy.TableState == nil {
		return Favorite{}, fmt.Errorf("favorite is missing filters or table state")
	}

	pane := FavoritePaneState{Filters: *legacy.Filters, TableState: *legacy.TableState}
	normalizeFavoriteFilters(&pane.Filters)
	migrated := Favorite{
		ID:               legacy.ID,
		Name:             legacy.Name,
		ClusterSelection: legacy.ClusterSelection,
		ClusterID:        legacy.ClusterID,
		ClusterName:      legacy.ClusterName,
		ViewType:         legacy.ViewType,
		View:             legacy.View,
		Namespace:        legacy.Namespace,
		Panes:            map[string]FavoritePaneState{"main": pane},
		Order:            legacy.Order,
	}
	if legacy.ViewType == "namespace" {
		switch legacy.View {
		case "pods":
			migrated.View = "workloads"
			migrated.Panes = map[string]FavoritePaneState{
				"workloads": defaultFavoritePaneState(),
				"pods":      pane,
			}
		case "workloads":
			migrated.Panes = map[string]FavoritePaneState{
				"workloads": pane,
				"pods":      defaultFavoritePaneState(),
			}
		}
	}

	return migrated, nil
}

func migrateFavoriteV2(raw json.RawMessage) (Favorite, error) {
	legacy := favoriteV2{}
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return Favorite{}, err
	}
	return migrateFlatFavorite(legacy)
}

func migrateFavoriteFilterSelectionV1(values []string) FavoriteFilterSelection {
	if len(values) == 0 {
		return FavoriteFilterSelection{Mode: "all"}
	}
	return normalizeFavoriteFilterSelection(FavoriteFilterSelection{Mode: "some", Values: values})
}

func migrateFavoriteV1(raw json.RawMessage) (Favorite, error) {
	legacy := favoriteV1{}
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return Favorite{}, err
	}
	var filters *FavoriteFilters
	if legacy.Filters != nil {
		queryFacets := make(map[string]FavoriteFilterSelection, len(legacy.Filters.QueryFacets))
		for key, values := range legacy.Filters.QueryFacets {
			queryFacets[key] = migrateFavoriteFilterSelectionV1(values)
		}
		filters = &FavoriteFilters{
			Search:          legacy.Filters.Search,
			Kinds:           migrateFavoriteFilterSelectionV1(legacy.Filters.Kinds),
			Namespaces:      migrateFavoriteFilterSelectionV1(legacy.Filters.Namespaces),
			Clusters:        migrateFavoriteFilterSelectionV1(legacy.Filters.Clusters),
			QueryFacets:     queryFacets,
			CaseSensitive:   legacy.Filters.CaseSensitive,
			IncludeMetadata: legacy.Filters.IncludeMetadata,
		}
	}
	return migrateFlatFavorite(favoriteV2{
		ID:               legacy.ID,
		Name:             legacy.Name,
		ClusterSelection: legacy.ClusterSelection,
		ClusterID:        legacy.ClusterID,
		ClusterName:      legacy.ClusterName,
		ViewType:         legacy.ViewType,
		View:             legacy.View,
		Namespace:        legacy.Namespace,
		Filters:          filters,
		TableState:       legacy.TableState,
		Order:            legacy.Order,
	})
}

func migrateFlatFavoritesFile(data []byte, migrate func(json.RawMessage) (Favorite, error)) *favoritesFile {
	legacy := flatFavoritesFile{}
	if err := json.Unmarshal(data, &legacy); err != nil {
		return &favoritesFile{SchemaVersion: favoritesSchemaVersion, Favorites: []Favorite{}}
	}

	migrated := &favoritesFile{
		SchemaVersion: favoritesSchemaVersion,
		Favorites:     make([]Favorite, 0, len(legacy.Favorites)),
	}
	for _, raw := range legacy.Favorites {
		favorite, err := migrate(raw)
		if err != nil {
			continue
		}
		favorite.Order = len(migrated.Favorites)
		migrated.Favorites = append(migrated.Favorites, favorite)
	}
	return migrated
}

func normalizeFavoriteFilterSelection(selection FavoriteFilterSelection) FavoriteFilterSelection {
	if selection.Mode == "none" {
		return FavoriteFilterSelection{Mode: "none"}
	}
	if selection.Mode != "some" {
		return FavoriteFilterSelection{Mode: "all"}
	}
	seen := make(map[string]struct{}, len(selection.Values))
	values := make([]string, 0, len(selection.Values))
	for _, raw := range selection.Values {
		value := strings.TrimSpace(raw)
		key := "__empty__"
		if value != "" {
			key = strings.ToLower(value)
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		values = append(values, value)
	}
	if len(values) == 0 {
		return FavoriteFilterSelection{Mode: "none"}
	}
	return FavoriteFilterSelection{Mode: "some", Values: values}
}

func normalizeFavoriteFilters(filters *FavoriteFilters) {
	filters.Kinds = normalizeFavoriteFilterSelection(filters.Kinds)
	filters.Namespaces = normalizeFavoriteFilterSelection(filters.Namespaces)
	filters.Clusters = normalizeFavoriteFilterSelection(filters.Clusters)
	for key, selection := range filters.QueryFacets {
		filters.QueryFacets[key] = normalizeFavoriteFilterSelection(selection)
	}
}

func normalizeFavoritePanes(panes map[string]FavoritePaneState) {
	for key, pane := range panes {
		normalizeFavoriteFilters(&pane.Filters)
		panes[key] = pane
	}
}

func validateFavoritePanes(panes map[string]FavoritePaneState) error {
	if len(panes) == 0 {
		return fmt.Errorf("favorite must contain at least one named pane")
	}
	for key := range panes {
		if strings.TrimSpace(key) == "" {
			return fmt.Errorf("favorite pane name must not be empty")
		}
	}
	return nil
}

// favoritesMu guards favorites.json read/write operations.
// Separate from persistenceMu so favorites IO doesn't block grid table persistence.
var favoritesMu sync.Mutex

func (a *App) getFavoritesFilePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("could not find config directory: %w", err)
	}
	configDir = filepath.Join(configDir, "luxury-yacht")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %w", err)
	}
	return filepath.Join(configDir, "favorites.json"), nil
}

func (a *App) loadFavoritesFile() (*favoritesFile, error) {
	path, err := a.getFavoritesFilePath()
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return &favoritesFile{SchemaVersion: favoritesSchemaVersion}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read favorites file: %w", err)
	}
	header := struct {
		SchemaVersion int `json:"schemaVersion"`
	}{}
	if err := json.Unmarshal(data, &header); err != nil {
		return nil, fmt.Errorf("failed to parse favorites file: %w", err)
	}
	var migrate func(json.RawMessage) (Favorite, error)
	switch header.SchemaVersion {
	case 1:
		migrate = migrateFavoriteV1
	case 2:
		migrate = migrateFavoriteV2
	}
	if migrate != nil {
		state := migrateFlatFavoritesFile(data, migrate)
		if err := a.saveFavoritesFile(state); err != nil {
			return nil, fmt.Errorf("failed to save migrated favorites file: %w", err)
		}
		return state, nil
	}
	if header.SchemaVersion < favoritesSchemaVersion {
		return &favoritesFile{SchemaVersion: favoritesSchemaVersion, Favorites: []Favorite{}}, nil
	}
	if header.SchemaVersion > favoritesSchemaVersion {
		return nil, fmt.Errorf("favorites schema version %d is newer than supported version %d", header.SchemaVersion, favoritesSchemaVersion)
	}
	state := &favoritesFile{}
	if err := json.Unmarshal(data, state); err != nil {
		return nil, fmt.Errorf("failed to parse favorites file: %w", err)
	}
	for index := range state.Favorites {
		normalizeFavoritePanes(state.Favorites[index].Panes)
	}
	state.SchemaVersion = favoritesSchemaVersion
	return state, nil
}

func (a *App) saveFavoritesFile(state *favoritesFile) error {
	if state == nil {
		return fmt.Errorf("no favorites state to save")
	}
	path, err := a.getFavoritesFilePath()
	if err != nil {
		return err
	}
	state.SchemaVersion = favoritesSchemaVersion
	state.UpdatedAt = time.Now().UTC()
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("failed to marshal favorites: %w", err)
	}
	if err := writeFileAtomic(path, data, 0o644); err != nil {
		return fmt.Errorf("failed to write favorites file: %w", err)
	}
	return nil
}

// GetFavorites returns all saved favorites.
func (a *App) GetFavorites() ([]Favorite, error) {
	favoritesMu.Lock()
	defer favoritesMu.Unlock()

	state, err := a.loadFavoritesFile()
	if err != nil {
		return nil, err
	}
	result := make([]Favorite, len(state.Favorites))
	copy(result, state.Favorites)
	return result, nil
}

// AddFavorite generates an ID, assigns Order, appends the favorite, and persists.
func (a *App) AddFavorite(fav Favorite) (Favorite, error) {
	if err := validateFavoritePanes(fav.Panes); err != nil {
		return Favorite{}, err
	}
	fav.ID = uuid.New().String()
	normalizeFavoritePanes(fav.Panes)

	favoritesMu.Lock()
	defer favoritesMu.Unlock()

	state, err := a.loadFavoritesFile()
	if err != nil {
		return Favorite{}, err
	}
	fav.Order = len(state.Favorites)
	state.Favorites = append(state.Favorites, fav)
	if err := a.saveFavoritesFile(state); err != nil {
		return Favorite{}, err
	}
	return fav, nil
}

// UpdateFavorite replaces a favorite by ID, preserving its Order. Returns an error if not found.
func (a *App) UpdateFavorite(fav Favorite) error {
	if err := validateFavoritePanes(fav.Panes); err != nil {
		return err
	}
	normalizeFavoritePanes(fav.Panes)
	favoritesMu.Lock()
	defer favoritesMu.Unlock()

	state, err := a.loadFavoritesFile()
	if err != nil {
		return err
	}
	for i, existing := range state.Favorites {
		if existing.ID == fav.ID {
			fav.Order = existing.Order
			state.Favorites[i] = fav
			return a.saveFavoritesFile(state)
		}
	}
	return fmt.Errorf("favorite %q not found", fav.ID)
}

// DeleteFavorite removes a favorite by ID and re-indexes Order. Returns an error if not found.
func (a *App) DeleteFavorite(id string) error {
	favoritesMu.Lock()
	defer favoritesMu.Unlock()

	state, err := a.loadFavoritesFile()
	if err != nil {
		return err
	}
	idx := -1
	for i, fav := range state.Favorites {
		if fav.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("favorite %q not found", id)
	}
	state.Favorites = append(state.Favorites[:idx], state.Favorites[idx+1:]...)
	for i := range state.Favorites {
		state.Favorites[i].Order = i
	}
	return a.saveFavoritesFile(state)
}

// SetFavoriteOrder reorders favorites according to the given ID list.
// Any favorites not in the list are appended in their existing relative order.
func (a *App) SetFavoriteOrder(ids []string) error {
	favoritesMu.Lock()
	defer favoritesMu.Unlock()

	state, err := a.loadFavoritesFile()
	if err != nil {
		return err
	}

	lookup := make(map[string]Favorite, len(state.Favorites))
	for _, fav := range state.Favorites {
		lookup[fav.ID] = fav
	}

	reordered := make([]Favorite, 0, len(state.Favorites))
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if fav, ok := lookup[id]; ok {
			seen[id] = struct{}{}
			reordered = append(reordered, fav)
		}
	}
	for _, fav := range state.Favorites {
		if _, ok := seen[fav.ID]; !ok {
			reordered = append(reordered, fav)
		}
	}
	for i := range reordered {
		reordered[i].Order = i
	}
	state.Favorites = reordered
	return a.saveFavoritesFile(state)
}
