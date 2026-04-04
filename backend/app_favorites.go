package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Favorite represents a user-saved view bookmark.
type Favorite struct {
	ID               string              `json:"id"`
	Name             string              `json:"name"`
	ClusterSelection string              `json:"clusterSelection"`
	ViewType         string              `json:"viewType"`
	View             string              `json:"view"`
	Namespace        string              `json:"namespace"`
	Filters          *FavoriteFilters    `json:"filters"`
	TableState       *FavoriteTableState `json:"tableState"`
	Order            int                 `json:"order"`
}

// FavoriteFilters holds the search and filter state for a favorite.
type FavoriteFilters struct {
	Search          string   `json:"search"`
	Kinds           []string `json:"kinds"`
	Namespaces      []string `json:"namespaces"`
	CaseSensitive   bool     `json:"caseSensitive"`
	IncludeMetadata bool     `json:"includeMetadata"`
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

const favoritesSchemaVersion = 1

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
	state := &favoritesFile{}
	if err := json.Unmarshal(data, state); err != nil {
		return nil, fmt.Errorf("failed to parse favorites file: %w", err)
	}
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
	fav.ID = uuid.New().String()

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
