package updatetemp

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

type processTestEnvironment struct {
	values map[string]string
}

func (environment *processTestEnvironment) LookupEnv(name string) (string, bool) {
	value, ok := environment.values[name]
	return value, ok
}

func (environment *processTestEnvironment) Setenv(name, value string) error {
	environment.values[name] = value
	return nil
}

func (environment *processTestEnvironment) Unsetenv(name string) error {
	delete(environment.values, name)
	return nil
}

func TestConfigureProcessUsesPortableLinuxDataHomeForUpdaterStaging(t *testing.T) {
	dataHome := t.TempDir()
	installRoot := filepath.Join(dataHome, "luxury-yacht")
	require.NoError(t, os.Mkdir(installRoot, 0o755))
	executable := filepath.Join(installRoot, "luxury-yacht")
	require.NoError(t, os.WriteFile(executable, []byte("binary"), 0o755))
	require.NoError(t, os.WriteFile(
		filepath.Join(installRoot, updateidentity.InstallationMarkerName),
		[]byte(`{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"portable","scope":"user"}`),
		0o644,
	))
	systemTemp := t.TempDir()
	environment := &processTestEnvironment{values: make(map[string]string)}

	root, err := configureProcess(processConfig{
		Platform: "linux", Architecture: "amd64", SystemTempDir: systemTemp,
		ExecutablePath: executable, UserID: "1000", Environment: environment,
	})

	require.NoError(t, err)
	require.Equal(t, ExpectedRoot(dataHome, "1000"), root)
	require.Equal(t, root, environment.values["TMPDIR"])
}

func TestConfigureProcessKeepsSystemTempForUnverifiedLinuxTargets(t *testing.T) {
	installRoot := t.TempDir()
	executable := filepath.Join(installRoot, "luxury-yacht")
	require.NoError(t, os.WriteFile(executable, []byte("binary"), 0o755))
	systemTemp := t.TempDir()
	environment := &processTestEnvironment{values: make(map[string]string)}

	root, err := configureProcess(processConfig{
		Platform: "linux", Architecture: "amd64", SystemTempDir: systemTemp,
		ExecutablePath: executable, UserID: "1000", Environment: environment,
	})

	require.NoError(t, err)
	require.Equal(t, ExpectedRoot(systemTemp, "1000"), root)
}
