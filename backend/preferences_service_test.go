package backend

import (
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type recordingPermissionPolicySink struct {
	mu     sync.Mutex
	values []int
}

func (s *recordingPermissionPolicySink) SetPermissionFetchConcurrency(value int) {
	s.mu.Lock()
	s.values = append(s.values, value)
	s.mu.Unlock()
}

type recordingContainerLogsPolicySink struct {
	mu     sync.Mutex
	values []int
}

func (s *recordingContainerLogsPolicySink) SetContainerLogsPerScopeLimit(value int) {
	s.mu.Lock()
	s.values = append(s.values, value)
	s.mu.Unlock()
}

type recordingRefreshSettingsSink struct {
	mu           sync.Mutex
	globalLimits []int
}

func (s *recordingRefreshSettingsSink) SetContainerLogsGlobalLimit(value int) {
	s.mu.Lock()
	s.globalLimits = append(s.globalLimits, value)
	s.mu.Unlock()
}

func (*recordingRefreshSettingsSink) SetMetricsRefreshInterval(int) {}

func TestEnsureLoadedCoalescesConcurrentStartupFallbackAndPublishesAfterDefaultPushes(t *testing.T) {
	permission := &recordingPermissionPolicySink{}
	containerLogs := &recordingContainerLogsPolicySink{}
	refresh := &recordingRefreshSettingsSink{}
	preferences := NewPreferencesService(nil, NewSettingsEffectDispatcher(
		nil, nil, permission, containerLogs, refresh, nil,
	), nil)
	loadStarted := make(chan struct{})
	releaseLoad := make(chan struct{})
	preferences.loadSnapshot = func() (*AppSettings, error) {
		close(loadStarted)
		<-releaseLoad
		return nil, errors.New("settings unavailable")
	}

	type result struct {
		snapshot PreferencesSnapshot
		err      error
	}
	normalDone := make(chan result, 1)
	go func() {
		snapshot, err := preferences.EnsureLoaded()
		normalDone <- result{snapshot: snapshot, err: err}
	}()
	<-loadStarted
	startupDone := make(chan result, 1)
	go func() {
		snapshot, err := preferences.EnsureLoadedForStartup()
		startupDone <- result{snapshot: snapshot, err: err}
	}()
	require.Eventually(t, func() bool {
		preferences.loadMu.Lock()
		defer preferences.loadMu.Unlock()
		return preferences.loadAttempt != nil && preferences.loadAttempt.startupFallbackRequested
	}, time.Second, time.Millisecond)
	close(releaseLoad)

	for _, done := range []chan result{normalDone, startupDone} {
		loaded := <-done
		require.NoError(t, loaded.err)
		require.Equal(t, PreferencesStartupDefault, loaded.snapshot.Provenance)
		require.NotNil(t, loaded.snapshot.Settings)
	}
	defaults := getDefaultAppSettings()
	require.Equal(t, []int{defaults.PermissionSSRRFetchConcurrency}, permission.values)
	require.Equal(t, []int{defaults.ObjPanelLogsTargetPerScopeLimit}, containerLogs.values)
	require.Equal(t, []int{defaults.ObjPanelLogsTargetGlobalLimit}, refresh.globalLimits)
}

func TestEnsureLoadedFailureInstallsNothingAndCanRetry(t *testing.T) {
	preferences := NewPreferencesService(nil, nil, nil)
	loadCalls := 0
	preferences.loadSnapshot = func() (*AppSettings, error) {
		loadCalls++
		if loadCalls == 1 {
			return nil, errors.New("settings unavailable")
		}
		return getDefaultAppSettings(), nil
	}

	first, err := preferences.EnsureLoaded()
	require.ErrorContains(t, err, "settings unavailable")
	require.Nil(t, first.Settings)
	require.Nil(t, preferences.appSettings)

	second, err := preferences.EnsureLoaded()
	require.NoError(t, err)
	require.Equal(t, PreferencesLoaded, second.Provenance)
	require.NotNil(t, second.Settings)
	require.Equal(t, 2, loadCalls)
}

func TestPreferencesResetExcludesNewLazyLoadUntilResetCompletes(t *testing.T) {
	setTestConfigEnv(t)
	preferences := NewPreferencesService(nil, nil, nil)
	preferences.appSettings = getDefaultAppSettings()

	var loadCalls atomic.Int32
	preferences.loadSnapshot = func() (*AppSettings, error) {
		loadCalls.Add(1)
		return getDefaultAppSettings(), nil
	}

	preferences.settingsMu.Lock()
	resetDone := make(chan error, 1)
	go func() {
		resetDone <- preferences.Reset()
	}()

	deadline := time.Now().Add(time.Second)
	for {
		preferences.loadMu.Lock()
		resetting := preferences.resetting
		preferences.loadMu.Unlock()
		if resetting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("reset did not enter its exclusion window")
		}
		runtime.Gosched()
	}

	loadDone := make(chan error, 1)
	go func() {
		_, err := preferences.EnsureLoaded()
		loadDone <- err
	}()
	select {
	case err := <-loadDone:
		t.Fatalf("lazy load completed while reset was blocked: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	require.Equal(t, int32(0), loadCalls.Load())

	preferences.settingsMu.Unlock()
	require.NoError(t, <-resetDone)
	require.NoError(t, <-loadDone)
	require.Equal(t, int32(1), loadCalls.Load())
}
