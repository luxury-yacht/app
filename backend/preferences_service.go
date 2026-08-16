package backend

import (
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

type PreferencesLoadProvenance string

const (
	PreferencesLoaded         PreferencesLoadProvenance = "loaded"
	PreferencesStartupDefault PreferencesLoadProvenance = "startup-default"
)

type PreferencesSnapshot struct {
	Settings   *AppSettings
	Provenance PreferencesLoadProvenance
}

type preferencesLoadAttempt struct {
	done                     chan struct{}
	startupFallbackRequested bool
	snapshot                 PreferencesSnapshot
	err                      error
}

// PreferencesService is the sole owner of settings.json, its lock, lazy-load
// readiness, window state, and kubeconfig search-path repository.
type PreferencesService struct {
	loadMu                sync.Mutex
	settingsMu            sync.Mutex
	windowSettings        *WindowSettings
	appSettings           *AppSettings
	kubeconfigSearchPaths []string
	loadAttempt           *preferencesLoadAttempt
	resetting             bool
	resetDone             chan struct{}
	provenance            PreferencesLoadProvenance
	effects               *SettingsEffectDispatcher
	shell                 *DesktopShell
	logger                *Logger
	loadSnapshot          func() (*AppSettings, error)
}

func NewPreferencesService(shell *DesktopShell, effects *SettingsEffectDispatcher, logger *Logger) *PreferencesService {
	return &PreferencesService{shell: shell, effects: effects, logger: logger}
}

func (p *PreferencesService) EnsureLoaded() (PreferencesSnapshot, error) {
	return p.ensureLoaded(false)
}

func (p *PreferencesService) EnsureLoadedForStartup() (PreferencesSnapshot, error) {
	return p.ensureLoaded(true)
}

func (p *PreferencesService) ensureLoaded(startupFallback bool) (PreferencesSnapshot, error) {
	if p == nil {
		return PreferencesSnapshot{}, fmt.Errorf("preferences service is not available")
	}

	p.loadMu.Lock()
	for p.resetting {
		done := p.resetDone
		p.loadMu.Unlock()
		<-done
		p.loadMu.Lock()
	}
	if attempt := p.loadAttempt; attempt != nil {
		if startupFallback {
			attempt.startupFallbackRequested = true
		}
		done := attempt.done
		p.loadMu.Unlock()
		<-done
		return copyPreferencesSnapshot(attempt.snapshot), attempt.err
	}
	p.settingsMu.Lock()
	if p.appSettings != nil {
		snapshot := p.snapshotLocked()
		p.settingsMu.Unlock()
		p.loadMu.Unlock()
		return snapshot, nil
	}
	p.settingsMu.Unlock()

	attempt := &preferencesLoadAttempt{
		done:                     make(chan struct{}),
		startupFallbackRequested: startupFallback,
	}
	p.loadAttempt = attempt
	p.loadMu.Unlock()

	p.settingsMu.Lock()
	load := p.loadSnapshot
	if load == nil {
		load = p.loadAppSettingsSnapshot
	}
	settings, err := load()
	p.settingsMu.Unlock()

	provenance := PreferencesLoaded
	p.loadMu.Lock()
	useFallback := err != nil && attempt.startupFallbackRequested
	p.loadMu.Unlock()
	if useFallback {
		if p.logger != nil {
			p.logger.Warn(fmt.Sprintf("Could not load app settings at startup; using defaults: %v", err), logsources.Settings)
		}
		settings = getDefaultAppSettings()
		provenance = PreferencesStartupDefault
		err = nil
	}
	if err == nil && p.effects != nil {
		p.effects.Dispatch(settings, loadSettingsSideEffects())
	}

	p.settingsMu.Lock()
	if err == nil {
		p.appSettings = copyAppSettings(settings)
		p.provenance = provenance
		attempt.snapshot = p.snapshotLocked()
	}
	p.settingsMu.Unlock()
	p.loadMu.Lock()
	attempt.err = err
	p.loadAttempt = nil
	close(attempt.done)
	p.loadMu.Unlock()
	return copyPreferencesSnapshot(attempt.snapshot), err
}

func (p *PreferencesService) snapshotLocked() PreferencesSnapshot {
	return PreferencesSnapshot{Settings: copyAppSettings(p.appSettings), Provenance: p.provenance}
}

func copyPreferencesSnapshot(snapshot PreferencesSnapshot) PreferencesSnapshot {
	snapshot.Settings = copyAppSettings(snapshot.Settings)
	return snapshot
}

func (p *PreferencesService) Reset() error {
	if p == nil {
		return nil
	}
	for {
		p.loadMu.Lock()
		if p.resetting {
			done := p.resetDone
			p.loadMu.Unlock()
			<-done
			continue
		}
		attempt := p.loadAttempt
		if attempt == nil {
			p.resetting = true
			p.resetDone = make(chan struct{})
			p.loadMu.Unlock()
			p.settingsMu.Lock()
			var errs []error
			errs = appendPathRemovalError(errs, p.getSettingsFilePath, removeFileIfExists)
			errs = appendPathRemovalError(errs, p.cacheDirPath, os.RemoveAll)
			p.appSettings = nil
			p.windowSettings = nil
			p.kubeconfigSearchPaths = nil
			p.provenance = ""
			p.settingsMu.Unlock()
			p.loadMu.Lock()
			p.resetting = false
			close(p.resetDone)
			p.resetDone = nil
			p.loadMu.Unlock()
			return errors.Join(errs...)
		}
		done := attempt.done
		p.loadMu.Unlock()
		<-done
	}
}

func (p *PreferencesService) DispatchDefaults() {
	if p != nil && p.effects != nil {
		p.effects.Dispatch(getDefaultAppSettings(), allSettingsSideEffects())
	}
}

func removeResolvedFile(resolve func() (string, error)) error {
	if resolve == nil {
		return nil
	}
	path, err := resolve()
	if err != nil {
		return err
	}
	return removeFileIfExists(path)
}
