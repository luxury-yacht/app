package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/internal/appstate"
)

// Favorite represents a user-saved view bookmark.
type Favorite struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	ClusterSelection string             `json:"clusterSelection"`
	ClusterID        string             `json:"clusterId,omitempty"`
	ClusterName      string             `json:"clusterName,omitempty"`
	ViewType         string             `json:"viewType"`
	View             string             `json:"view"`
	Namespace        string             `json:"namespace"`
	Filters          FavoriteFilters    `json:"filters"`
	TableState       FavoriteTableState `json:"tableState"`
	Order            int                `json:"order"`
}

// FavoriteFilters holds the search and filter state for a favorite.
type FavoriteFilters struct {
	Search          string                             `json:"search"`
	Kinds           FavoriteFilterSelection            `json:"kinds"`
	Namespaces      FavoriteFilterSelection            `json:"namespaces"`
	Clusters        FavoriteFilterSelection            `json:"clusters"`
	QueryFacets     map[string]FavoriteFilterSelection `json:"queryFacets,omitempty"`
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
	ColumnOrder      []string        `json:"columnOrder,omitempty"`
}

// favoritesFile is the on-disk format for favorites.json.
type favoritesFile struct {
	SchemaVersion int        `json:"schemaVersion"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	Favorites     []Favorite `json:"favorites"`
}

const favoritesSchemaVersion = 4

// favoriteV3 stored one table state per pane of a split view (Workloads/Pods,
// Nodes/Pods). Keep the decoder private: it exists only at the migration and
// import boundaries.
type favoriteV3 struct {
	ID               string                         `json:"id"`
	Name             string                         `json:"name"`
	ClusterSelection string                         `json:"clusterSelection"`
	ClusterID        string                         `json:"clusterId,omitempty"`
	ClusterName      string                         `json:"clusterName,omitempty"`
	ViewType         string                         `json:"viewType"`
	View             string                         `json:"view"`
	Namespace        string                         `json:"namespace"`
	Panes            map[string]favoritePaneStateV3 `json:"panes"`
	Order            int                            `json:"order"`
}

type favoritePaneStateV3 struct {
	Filters    FavoriteFilters    `json:"filters"`
	TableState FavoriteTableState `json:"tableState"`
}

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

func migrateFlatFavorite(legacy favoriteV2) (Favorite, error) {
	if strings.TrimSpace(legacy.ID) == "" || strings.TrimSpace(legacy.Name) == "" ||
		strings.TrimSpace(legacy.ViewType) == "" || strings.TrimSpace(legacy.View) == "" {
		return Favorite{}, fmt.Errorf("favorite is missing required identity or route fields")
	}
	if legacy.Filters == nil || legacy.TableState == nil {
		return Favorite{}, fmt.Errorf("favorite is missing filters or table state")
	}

	migrated := Favorite{
		ID:               legacy.ID,
		Name:             legacy.Name,
		ClusterSelection: legacy.ClusterSelection,
		ClusterID:        legacy.ClusterID,
		ClusterName:      legacy.ClusterName,
		ViewType:         legacy.ViewType,
		View:             legacy.View,
		Namespace:        legacy.Namespace,
		Filters:          *legacy.Filters,
		TableState:       *legacy.TableState,
		Order:            legacy.Order,
	}
	normalizeFavoriteFilters(&migrated.Filters)
	return migrated, nil
}

// migrateFavoriteV3 keeps the favorite's own view table and drops the panes a
// split view stored beside it. Split panes were named after their view
// (workloads, nodes, pods); single tables used main.
func migrateFavoriteV3(raw json.RawMessage) (Favorite, error) {
	legacy := favoriteV3{}
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return Favorite{}, err
	}
	pane, ok := favoriteV3ViewPane(legacy)
	if !ok {
		return Favorite{}, fmt.Errorf("favorite %q has no table state for its view", legacy.ID)
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
		Filters:          &pane.Filters,
		TableState:       &pane.TableState,
		Order:            legacy.Order,
	})
}

func favoriteV3ViewPane(legacy favoriteV3) (favoritePaneStateV3, bool) {
	for _, name := range []string{legacy.View, "main"} {
		if pane, ok := legacy.Panes[name]; ok {
			return pane, true
		}
	}
	if len(legacy.Panes) == 1 {
		for _, pane := range legacy.Panes {
			return pane, true
		}
	}
	return favoritePaneStateV3{}, false
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
	return FavoriteFilterSelection{Mode: "some", Values: values}
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

type favoriteFilterComparison uint8

const (
	favoriteFilterCaseInsensitive favoriteFilterComparison = iota
	favoriteFilterExact
)

func favoriteFilterValueKey(value string, comparison favoriteFilterComparison) string {
	if comparison == favoriteFilterExact {
		return value
	}
	return strings.ToLower(value)
}

func normalizeFavoriteFilterSelection(selection FavoriteFilterSelection, comparison favoriteFilterComparison) FavoriteFilterSelection {
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
		key := favoriteFilterValueKey(value, comparison)
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
	filters.Kinds = normalizeFavoriteFilterSelection(filters.Kinds, favoriteFilterCaseInsensitive)
	filters.Namespaces = normalizeFavoriteFilterSelection(filters.Namespaces, favoriteFilterCaseInsensitive)
	filters.Clusters = normalizeFavoriteFilterSelection(filters.Clusters, favoriteFilterExact)
	for key, selection := range filters.QueryFacets {
		filters.QueryFacets[key] = normalizeFavoriteFilterSelection(selection, favoriteFilterCaseInsensitive)
	}
}

func normalizeFavoriteName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("favorite name must not be empty")
	}
	return name, nil
}

func validateUniqueFavoriteName(favorites []Favorite, name string, excludedID string) error {
	for _, existing := range favorites {
		if existing.ID != excludedID && strings.TrimSpace(existing.Name) == name {
			return fmt.Errorf("favorite name %q already exists", name)
		}
	}
	return nil
}

func (s *FavoritesService) getFavoritesFilePath() (string, error) {
	manifest, err := appstate.Resolve("luxury-yacht")
	if err != nil {
		return "", fmt.Errorf("could not find config directory: %w", err)
	}
	return manifest.FavoritesPath(), nil
}

func (s *FavoritesService) loadFavoritesFile() (*favoritesFile, error) {
	path, err := s.getFavoritesFilePath()
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
	case 3:
		migrate = migrateFavoriteV3
	}
	if migrate != nil {
		state := migrateFlatFavoritesFile(data, migrate)
		if err := s.saveFavoritesFile(state); err != nil {
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
		normalizeFavoriteFilters(&state.Favorites[index].Filters)
	}
	state.SchemaVersion = favoritesSchemaVersion
	return state, nil
}

func (s *FavoritesService) saveFavoritesFile(state *favoritesFile) error {
	if state == nil {
		return fmt.Errorf("no favorites state to save")
	}
	path, err := s.getFavoritesFilePath()
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
func (s *FavoritesService) GetFavorites() ([]Favorite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadFavoritesFile()
	if err != nil {
		return nil, err
	}
	result := make([]Favorite, len(state.Favorites))
	copy(result, state.Favorites)
	return result, nil
}

// AddFavorite generates an ID, assigns Order, appends the favorite, and persists.
func (s *FavoritesService) AddFavorite(fav Favorite) (Favorite, error) {
	name, err := normalizeFavoriteName(fav.Name)
	if err != nil {
		return Favorite{}, err
	}
	fav.Name = name
	fav.ID = uuid.New().String()
	normalizeFavoriteFilters(&fav.Filters)

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadFavoritesFile()
	if err != nil {
		return Favorite{}, err
	}
	if err := validateUniqueFavoriteName(state.Favorites, fav.Name, ""); err != nil {
		return Favorite{}, err
	}
	fav.Order = len(state.Favorites)
	state.Favorites = append(state.Favorites, fav)
	if err := s.saveFavoritesFile(state); err != nil {
		return Favorite{}, err
	}
	return fav, nil
}

// UpdateFavorite replaces a favorite by ID, preserving its Order. Returns an error if not found.
func (s *FavoritesService) UpdateFavorite(fav Favorite) error {
	name, err := normalizeFavoriteName(fav.Name)
	if err != nil {
		return err
	}
	fav.Name = name
	normalizeFavoriteFilters(&fav.Filters)
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadFavoritesFile()
	if err != nil {
		return err
	}
	for i, existing := range state.Favorites {
		if existing.ID == fav.ID {
			if err := validateUniqueFavoriteName(state.Favorites, fav.Name, fav.ID); err != nil {
				return err
			}
			fav.Order = existing.Order
			state.Favorites[i] = fav
			return s.saveFavoritesFile(state)
		}
	}
	return fmt.Errorf("favorite %q not found", fav.ID)
}

// DeleteFavorite removes a favorite by ID and re-indexes Order. Returns an error if not found.
func (s *FavoritesService) DeleteFavorite(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadFavoritesFile()
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
	return s.saveFavoritesFile(state)
}

// SetFavoriteOrder reorders favorites according to the given ID list.
// Any favorites not in the list are appended in their existing relative order.
func (s *FavoritesService) SetFavoriteOrder(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadFavoritesFile()
	if err != nil {
		return err
	}

	lookup := make(map[string]Favorite, len(state.Favorites))
	for _, fav := range state.Favorites {
		lookup[fav.ID] = fav
	}

	reordered := make([]Favorite, 0, len(state.Favorites))
	for _, id := range ids {
		if fav, ok := lookup[id]; ok {
			reordered = append(reordered, fav)
			delete(lookup, id)
		}
	}
	for _, fav := range state.Favorites {
		if _, ok := lookup[fav.ID]; ok {
			reordered = append(reordered, fav)
			delete(lookup, fav.ID)
		}
	}
	for i := range reordered {
		reordered[i].Order = i
	}
	state.Favorites = reordered
	return s.saveFavoritesFile(state)
}
