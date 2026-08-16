package backend

import (
	"fmt"
	"sync"
)

// FavoritesService owns favorites.json and its independent I/O lock.
type FavoritesService struct {
	mu sync.Mutex
}

func NewFavoritesService() *FavoritesService { return &FavoritesService{} }

func (s *FavoritesService) exportSnapshot() ([]Favorite, error) {
	if s == nil {
		return nil, fmt.Errorf("favorites service is not available")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadFavoritesFile()
	if err != nil {
		return nil, err
	}
	return cloneFavorites(state.Favorites), nil
}

func (s *FavoritesService) importSnapshot(favorites []Favorite) error {
	if s == nil {
		return fmt.Errorf("favorites service is not available")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveFavoritesFile(&favoritesFile{Favorites: cloneFavorites(favorites)})
}

func (s *FavoritesService) Reset() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return removeResolvedFile(s.getFavoritesFilePath)
}
