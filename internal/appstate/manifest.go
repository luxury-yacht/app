// Package appstate resolves the application's static durable artifact roots.
// It inventories paths only; live deletion remains with the owning services.
package appstate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Manifest struct {
	ConfigRoot string
	CacheRoot  string
}

func Resolve(appName string) (Manifest, error) {
	appName = strings.TrimSpace(appName)
	if appName == "" {
		return Manifest{}, fmt.Errorf("resolve app state: empty app name")
	}
	configBase, err := os.UserConfigDir()
	if err != nil {
		return Manifest{}, fmt.Errorf("resolve user config dir: %w", err)
	}
	cacheBase, err := os.UserCacheDir()
	if err != nil {
		return Manifest{}, fmt.Errorf("resolve user cache dir: %w", err)
	}
	return Manifest{
		ConfigRoot: filepath.Join(configBase, appName),
		CacheRoot:  filepath.Join(cacheBase, appName),
	}, nil
}

func (m Manifest) StaticRoots() []string {
	return []string{m.ConfigRoot, m.CacheRoot}
}

func (m Manifest) SettingsPath() string  { return filepath.Join(m.ConfigRoot, "settings.json") }
func (m Manifest) FavoritesPath() string { return filepath.Join(m.ConfigRoot, "favorites.json") }
func (m Manifest) UIStatePath() string   { return filepath.Join(m.ConfigRoot, "persistence.json") }
func (m Manifest) UpdateStatePath() string {
	return filepath.Join(m.ConfigRoot, "application-update.json")
}
