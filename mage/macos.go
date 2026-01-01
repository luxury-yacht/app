package mage

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/magefile/mage/sh"
)

const (
	binDir      = "build/bin"
	buildDir    = "build/darwin"
	iconsetName = "app.iconset"
	iconsetDir  = buildDir + "/" + iconsetName
	iconDest    = buildDir + "/iconfile.icns"
)

// Creates the iconset for macOS applications.
func createMacIconfile(cfg BuildConfig) error {
	fmt.Println("\n🎨 Creating macOS .icns file...")

	// If the iconset directory exists, remove it first.
	if _, err := os.Stat(iconsetDir); err == nil {
		err = os.RemoveAll(iconsetDir)
		if err != nil {
			return err
		}
	}

	// Create the iconset directory.
	err := os.MkdirAll(iconsetDir, 0755)
	if err != nil {
		return err
	}

	fmt.Println("Using icon source image at", cfg.IconSource)

	// Copy the source icon to build dir for `wails build`.
	err = sh.Copy("build/appicon.png", cfg.IconSource)
	if err != nil {
		return err
	}

	// Generate the iconset files.
	sizes := []int{16, 32, 64, 128, 256, 512}
	for _, size := range sizes {
		// Create the standard icon sizes.
		err = sh.Run("sips", "-Z", fmt.Sprint(size), cfg.IconSource,
			"--out", iconsetDir+"/icon_"+fmt.Sprint(size)+"x"+fmt.Sprint(size)+".png")
		if err != nil {
			return err
		}
		// Create the @2x icon sizes.
		err = sh.Run("sips", "-Z", fmt.Sprint(size*2), cfg.IconSource,
			"--out", iconsetDir+"/icon_"+fmt.Sprint(size)+"x"+fmt.Sprint(size)+"@2x.png")
		if err != nil {
			return err
		}
	}

	// Convert the iconset to an icns file.
	err = sh.RunV("iconutil", "-c", "icns", iconsetDir, "-o", iconDest)
	if err != nil {
		return err
	}

	// Clean up the iconset directory.
	err = os.RemoveAll(iconsetDir)
	if err != nil {
		return err
	}

	fmt.Println("✅ Icon file created at", iconDest)

	return nil
}

// Get env variables for macOS code signing and notarization.
func getMacOSSigningEnv() (string, string, string, string, string) {
	identity := os.Getenv("MACOS_SIGNING_IDENTITY")
	if identity == "" {
		fmt.Println("⚠️ MACOS_SIGNING_IDENTITY is not set; cannot continue.")
		os.Exit(1)
	}

	appleID := os.Getenv("MACOS_APPLE_ID")
	if appleID == "" {
		fmt.Println("⚠️ MACOS_APPLE_ID is not set; cannot continue.")
		os.Exit(1)
	}

	appleIDPassword := os.Getenv("MACOS_APPLE_APP_PASSWORD")
	if appleIDPassword == "" {
		fmt.Println("⚠️ MACOS_APPLE_APP_PASSWORD is not set; cannot continue.")
		os.Exit(1)
	}

	appleTeamId := os.Getenv("MACOS_APPLE_TEAM_ID")
	if appleTeamId == "" {
		fmt.Println("⚠️ MACOS_APPLE_TEAM_ID is not set; cannot continue.")
		os.Exit(1)
	}

	keychainPath := os.Getenv("MACOS_KEYCHAIN_PATH")
	if keychainPath == "" {
		fmt.Println("⚠️ MACOS_KEYCHAIN_PATH is not set; cannot continue.")
		os.Exit(1)
	}

	return identity, appleID, appleIDPassword, appleTeamId, keychainPath
}

// Code signs the application.
func signMacApp(identity string, keychainPath string, appPath string) error {
	fmt.Println("\n✍️ Signing", appPath)

	err := sh.RunV("codesign", "--deep", "--force", "--verify",
		"--verbose", "--timestamp", "--options", "runtime",
		"--keychain", keychainPath,
		"--sign", identity, appPath)
	if err != nil {
		return err
	}
	err = sh.RunV("codesign", "--verify", "--deep", "--strict", "--verbose=2", appPath)
	if err != nil {
		return err
	}
	return nil
}

// Notarizes the application with Apple.
func notarizeMacApp(appleID string, appleIDPassword string, appleTeamId string, appPath string) error {
	fmt.Println("\n📄 Notarizing", appPath)

	// Copy the app to a zip for notarization.
	zipPath := binDir + "/app-notarization.zip"
	err := sh.RunV("ditto", "-c", "-k", "--keepParent", appPath, zipPath)
	if err != nil {
		return err
	}
	defer os.Remove(zipPath)

	err = sh.RunV("xcrun", "notarytool", "submit", zipPath,
		"--apple-id", appleID,
		"--password", appleIDPassword,
		"--team-id", appleTeamId,
		"--wait")
	if err != nil {
		return err
	}

	err = sh.RunV("xcrun", "stapler", "staple", appPath)
	if err != nil {
		return err
	}

	return nil
}

// Stages the macOS application for packaging.
func stageMacApp(cfg BuildConfig) error {
	stagingDir := "build/staging/darwin-" + cfg.ArchType

	// If the staging directory exists, remove it first.
	if _, err := os.Stat(stagingDir); err == nil {
		err = os.RemoveAll(stagingDir)
		if err != nil {
			return err
		}
	}

	// Create the staging directory.
	err := os.MkdirAll(stagingDir, 0755)
	if err != nil {
		return err
	}

	// Copy the app to the staging directory.
	err = sh.Run("cp", "-R", binDir+"/"+cfg.AppLongName+".app", stagingDir+"/"+cfg.AppLongName+".app")
	if err != nil {
		return err
	}

	return nil
}

// Creates a DMG package for the application.
func createDMG(archType string, version string) error {
	stagingDir := "build/staging/darwin-" + archType
	artifactsDir := "build/artifacts"
	dmgName := fmt.Sprintf("luxury-yacht-%s-macos-%s.dmg", version, archType)
	volumeIcon := stagingDir + "/.VolumeIcon.icns"

	fmt.Println("\n💿 Creating DMG...")

	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return fmt.Errorf("failed to prepare staging directory: %w", err)
	}
	if err := os.MkdirAll(artifactsDir, 0o755); err != nil {
		return fmt.Errorf("failed to prepare artifacts directory: %w", err)
	}

	// Copy the app icon into the DMG contents so the mounted volume shows it.
	if _, err := os.Stat(iconDest); err == nil {
		if err := sh.Run("cp", iconDest, volumeIcon); err != nil {
			return err
		}
		if setFilePath, err := exec.LookPath("SetFile"); err == nil {
			// Mark the folder as having a custom icon; best-effort if SetFile exists.
			_ = sh.Run(setFilePath, "-a", "C", stagingDir)
		} else {
			fmt.Println("⚠️ SetFile not found; DMG volume icon may not be applied.")
		}
	} else {
		fmt.Printf("⚠️ Icon file not found at %s; DMG volume icon will be default.\n", iconDest)
	}

	// Symlink Applications folder.
	err := sh.Run("ln", "-s", "/Applications", stagingDir+"/Applications")
	if err != nil {
		return err
	}

	// Remove the DMG if it already exists.
	if _, err := os.Stat(artifactsDir + "/" + dmgName); err == nil {
		err = os.Remove(artifactsDir + "/" + dmgName)
		if err != nil {
			return err
		}
	}

	// Create the DMG.
	err = sh.Run("hdiutil", "create",
		"-volname", "Luxury Yacht",
		"-srcfolder", stagingDir,
		"-ov", "-format", "UDZO",
		artifactsDir+"/"+dmgName)
	if err != nil {
		return err
	}

	fmt.Printf("✅ DMG created at %s/%s\n", artifactsDir, dmgName)

	return nil
}

// Builds the macOS app for a specific architecture so we can package per-arch artifacts.
func buildMacOSForArch(cfg BuildConfig, archType string) error {
	generateBuildManifest(cfg)

	buildArgs := append([]string{}, cfg.BuildArgs...)
	buildArgs = append(buildArgs, "--platform", fmt.Sprintf("darwin/%s", archType))

	fmt.Printf("\n🛠️ Wails build args: %v\n\n", buildArgs)

	return sh.RunV("wails", buildArgs...)
}

// Build the application for macOS.
func BuildMacOS(cfg BuildConfig) error {
	err := createMacIconfile(cfg)
	if err != nil {
		return err
	}

	generateBuildManifest(cfg)
	fmt.Printf("\n🛠️ Wails build args: %v\n\n", cfg.BuildArgs)

	return sh.RunV("wails", cfg.BuildArgs...)
}

// Install the app locally, with optional signing and notarization.
func InstallMacOS(cfg BuildConfig, signed bool) error {
	// Create the iconfile.
	err := createMacIconfile(cfg)
	if err != nil {
		return err
	}

	installSrc := binDir + "/" + cfg.AppLongName + ".app"
	installDest := "/Applications/" + cfg.AppLongName + ".app"

	if signed {
		identity, appleID, appleIDPassword, appleTeamId, keychainPath := getMacOSSigningEnv()

		err = signMacApp(identity, keychainPath, binDir+"/"+cfg.AppLongName+".app")
		if err != nil {
			return err
		}

		err = notarizeMacApp(appleID, appleIDPassword, appleTeamId, binDir+"/"+cfg.AppLongName+".app")
		if err != nil {
			return err
		}
	}

	// If the app already exists in /Applications, remove it.
	if _, err := os.Stat(installDest); err == nil {
		err = sh.RunV("sudo", "rm", "-rf", installDest)
		if err != nil {
			return err
		}
	}

	// Copy the built app to /Applications.
	err = sh.RunV("sudo", "cp", "-R", installSrc, installDest)
	if err != nil {
		return err
	}

	fmt.Println("\n✅ Successfully installed to", installDest)

	return nil
}

// Packages the macOS application with optional signing and notarization.
func PackageMacOS(cfg BuildConfig, signed bool) error {
	err := createMacIconfile(cfg)
	if err != nil {
		return err
	}

	archs := []string{"arm64", "amd64"}

	if signed {
		identity, appleID, appleIDPassword, appleTeamId, keychainPath := getMacOSSigningEnv()

		for _, archType := range archs {
			archCfg := cfg
			archCfg.ArchType = archType

			// Build, sign, and package each macOS architecture separately.
			err = buildMacOSForArch(archCfg, archType)
			if err != nil {
				return err
			}

			err = signMacApp(identity, keychainPath, binDir+"/"+archCfg.AppLongName+".app")
			if err != nil {
				return err
			}

			err = notarizeMacApp(appleID, appleIDPassword, appleTeamId, binDir+"/"+archCfg.AppLongName+".app")
			if err != nil {
				return err
			}

			err = stageMacApp(archCfg)
			if err != nil {
				return err
			}

			err = createDMG(archCfg.ArchType, archCfg.Version)
			if err != nil {
				return err
			}
		}

		return nil
	}

	for _, archType := range archs {
		archCfg := cfg
		archCfg.ArchType = archType

		// Build and package each macOS architecture separately.
		err = buildMacOSForArch(archCfg, archType)
		if err != nil {
			return err
		}

		err = stageMacApp(archCfg)
		if err != nil {
			return err
		}

		err = createDMG(archCfg.ArchType, archCfg.Version)
		if err != nil {
			return err
		}
	}

	return nil
}
