package mage

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type wailsConfig struct {
	Info struct {
		ProductVersion string `json:"productVersion"`
		BetaExpiryDays int    `json:"betaExpiryDays"`
	} `json:"info"`
}

// Gets product version from wails.json
func getProductVersion() (string, error) {
	data, err := os.ReadFile("wails.json")
	if err != nil {
		return "", err
	}
	var wailsCfg wailsConfig
	if err := json.Unmarshal(data, &wailsCfg); err != nil {
		return "", err
	}
	return wailsCfg.Info.ProductVersion, nil
}

// If the version string contains "beta", consider it a beta version.
func isBeta(version string) bool {
	return strings.Contains(strings.ToLower(version), "beta")
}

// Gets beta expiry days from wails.json
func getBetaExpiryDays() (int, error) {
	data, err := os.ReadFile("wails.json")
	if err != nil {
		return 0, err
	}
	var wailsCfg wailsConfig
	if err := json.Unmarshal(data, &wailsCfg); err != nil {
		return 0, err
	}
	return wailsCfg.Info.BetaExpiryDays, nil
}

// GitRevParse returns the short git commit hash of the current HEAD.
func gitRevParse() string {
	cmd := exec.Command("git", "rev-parse", "--short=9", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// Credit to https://github.com/sfate
// https://gist.github.com/sfate/9d45f6c5405dc4c9bf63bf95fe6d1a7c
func PrettyPrint(args ...interface{}) {
	var caller string

	timeNow := time.Now().Format("01-02-2006 15:04:05")
	prefix := fmt.Sprintf("[%s] %s -- ", "PrettyPrint", timeNow)
	_, fileName, fileLine, ok := runtime.Caller(1)

	if ok {
		caller = fmt.Sprintf("%s:%d", fileName, fileLine)
	} else {
		caller = ""
	}

	fmt.Printf("\n%s%s\n", prefix, caller)

	if len(args) == 2 {
		label := args[0]
		value := args[1]

		s, _ := json.MarshalIndent(value, "", "\t")
		fmt.Printf("%s%s: %s\n", prefix, label, string(s))
	} else {
		s, _ := json.MarshalIndent(args, "", "\t")
		fmt.Printf("%s%s\n", prefix, string(s))
	}
}

// Creates a ZIP archive from the specified source directory.
func createZipFromDir(srcDir, destZip string) error {
	if err := os.MkdirAll(filepath.Dir(destZip), 0o755); err != nil {
		return fmt.Errorf("failed to prepare zip destination: %w", err)
	}
	outFile, err := os.Create(destZip)
	if err != nil {
		return fmt.Errorf("failed to create zip file: %w", err)
	}
	defer outFile.Close()

	zipWriter := zip.NewWriter(outFile)
	walkErr := filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		if info.IsDir() {
			if relPath == "." {
				return nil
			}
			_, err = zipWriter.Create(strings.ReplaceAll(relPath+"/", "\\", "/"))
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			file.Close()
			return err
		}
		header.Name = strings.ReplaceAll(relPath, "\\", "/")
		header.Method = zip.Deflate
		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			return err
		}
		if _, err := io.Copy(writer, file); err != nil {
			file.Close()
			return err
		}
		file.Close()
		return nil
	})
	if walkErr != nil {
		return fmt.Errorf("failed to build zip: %w", walkErr)
	}
	if err := zipWriter.Close(); err != nil {
		return fmt.Errorf("failed to finalize zip: %w", err)
	}
	fmt.Printf("✅ Created Windows package: %s\n", destZip)
	return nil
}
