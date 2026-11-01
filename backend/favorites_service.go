package backend

import (
	"fmt"
	"slices"
	"sync"
)

// FavoritesService owns favorites.json and its independent I/O lock.
type FavoritesService struct {
	mu sync.Mutex
}

func NewFavoritesService() *FavoritesService { return &FavoritesService{} }

// exportSnapshot returns the view favorites and favorite clusters.
func (s *FavoritesService) exportSnapshot() ([]Favorite, []string, error) {
	if s == nil {
		return nil, nil, fmt.Errorf("favorites service is not available")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadFavoritesFile()
	if err != nil {
		return nil, nil, err
	}
	return cloneFavorites(state.Favorites), slices.Clone(state.Clusters), nil
}

// importSnapshot replaces the view favorites and favorite clusters.
func (s *FavoritesService) importSnapshot(favorites []Favorite, clusters []string) error {
	if s == nil {
		return fmt.Errorf("favorites service is not available")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveFavoritesFile(&favoritesFile{
		Favorites: cloneFavorites(favorites),
		Clusters:  normalizeKubeconfigSelections(clusters),
	})
}

func (s *FavoritesService) Reset() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return removeResolvedFile(s.getFavoritesFilePath)
}
