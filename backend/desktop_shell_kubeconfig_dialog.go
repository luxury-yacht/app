package backend

import (
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
	"k8s.io/client-go/util/homedir"
)

// OpenKubeconfigSearchPathDialog opens a directory picker for kubeconfig search paths.
func (s *DesktopShell) OpenKubeconfigSearchPathDialog() (string, error) {
	if !s.runtimeAvailable() {
		return "", fmt.Errorf("application context is not available")
	}

	return s.promptForOpenFile(&application.OpenFileDialogOptions{
		CanChooseDirectories: true,
		CanChooseFiles:       false,
		Title:                "Select kubeconfig directory",
		Directory:            s.defaultKubeconfigSearchDirectory(),
	})
}

// defaultKubeconfigSearchDirectory selects a safe default folder for the directory picker.
func (s *DesktopShell) defaultKubeconfigSearchDirectory() string {
	var searchPaths []string
	var err error
	if s != nil && s.kubeconfigSearchPaths != nil {
		searchPaths, err = s.kubeconfigSearchPaths()
	}
	if err == nil {
		if directory := firstExistingKubeconfigDirectory(searchPaths); directory != "" {
			return directory
		}
	}

	home := homedir.HomeDir()
	if home != "" {
		return home
	}

	return ""
}
