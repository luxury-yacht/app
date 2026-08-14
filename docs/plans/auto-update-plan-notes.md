The key change is to publish two artifact classes:

1. Existing installer/package artifacts for first installation and manual recovery.
2. New updater payloads containing exactly what Wails can replace in place.

The current pipeline only publishes DMG, NSIS, DEB, and RPM packages ([release.yml](/Volumes/git/luxury-yacht/app/.github/workflows/release.yml:116)). Those packages should remain, but Wails should never receive them as update payloads.

| Platform | Keep for installation | Add for Wails updates | Installation changes |
|---|---|---|---|
| macOS | Signed/notarized DMG | ZIP containing one signed/notarized `.app` | Only update installed bundles with a writable parent |
| Windows | Signed NSIS installer | Signed raw `.exe` | Move eligible installs to per-user LocalAppData and add an installer-written identity marker |
| Linux | DEB/RPM | Raw binary or single-entry tar for a new portable distribution | DEB/RPM stay package-manager-owned; only the explicit portable distribution self-updates |

### macOS

This is the smallest change because the pipeline already produces and signs the correct `.app` before wrapping it in a DMG ([release.yml](/Volumes/git/luxury-yacht/app/.github/workflows/release.yml:116)).

For each architecture we would:

- Build, sign, and notarize `Luxury Yacht.app`.
- Keep producing the DMG.
- Before building the other architecture, archive that `.app` as something like `luxury-yacht-v2.0.0-darwin-arm64.zip`.
- Ensure the ZIP has exactly one top-level entry: `Luxury Yacht.app`.
- Extract the completed ZIP during CI and rerun `codesign`, Gatekeeper, and notarization-ticket validation against the extracted app.
- Sign the ZIP as an updater artifact and include it in the Wails manifest.

At runtime, we also need an eligibility check. Wails replaces the complete `.app` and creates its backup beside it, so both the bundle and its parent location must support the operation. Apps launched from a DMG, a translocated path, a build directory, or a read-only location would get **View Download Options**, not self-update.

So the existing DMG remains the installer; the new `.app.zip` is the updater payload. This follows Wails’ [macOS distribution guidance](https://v3.wails.io/guides/updater/#distribution-checklist).

### Windows

Windows needs the most packaging work.

Today the release produces an unsigned NSIS installer, and machine scope is the default ([Taskfile](/Volumes/git/luxury-yacht/app/build/windows/Taskfile.yml:58), [NSIS configuration](/Volumes/git/luxury-yacht/app/build/windows/nsis/project.nsi:68)). Wails cannot rerun that installer—it replaces the running executable.

We would change the pipeline to:

1. Build `luxury-yacht.exe`.
2. Authenticode-sign that executable.
3. Save a versioned copy as the updater artifact, such as `luxury-yacht-v2.0.0-windows-amd64.exe`.
4. Build the NSIS installer from those same signed bytes.
5. Sign the completed installer separately.
6. Publish both artifacts.

Eligible installations must become per-user installs under LocalAppData. The installer would also write an adjacent marker such as:

```json
{
  "schemaVersion": 1,
  "productIdentifier": "com.luxury-yacht.app",
  "distribution": "nsis",
  "scope": "user"
}
```

The application would only self-update when that marker is valid and adjacent to the running executable. Existing machine-wide Program Files installations would remain notification-only until migrated.

Because Wails updates only the executable, we would also need to reconcile the per-user Apps & Features `DisplayVersion`; otherwise Windows could show the original installer version after several self-updates.

### Linux

The existing DEB and RPM packages cannot safely participate in Wails self-update. They install package-manager-owned files under `/usr/local/bin` ([nfpm.yaml](/Volumes/git/luxury-yacht/app/build/linux/nfpm/nfpm.yaml:19)). Replacing those files behind dpkg or rpm would desynchronize the package database and can require elevation.

There are two reasonable policies:

- Keep DEB/RPM users notification-only and tell them to update through their package manager.
- Add a separately identified portable Linux distribution for self-update.

For full self-update coverage, we would add the second option:

- Publish a raw binary or a single-entry tar archive for each architecture.
- Provide a portable installer that places it in a user-owned location, likely under `~/.local` or `$XDG_DATA_HOME`.
- Write an installation marker explicitly identifying it as the portable, self-updatable distribution.
- Keep icons, desktop integration, and runtime dependency requirements defined separately.
- Only enable Wails replacement for that distribution.

AppImage is another possible distribution, but its replacement and relaunch behavior needs separate validation before adopting it.

Therefore, Linux would technically support self-update, but existing DEB/RPM installations would not. Making DEB/RPM update automatically would require package-repository integration rather than the Wails updater.

### Common release-pipeline changes

Across all platforms, we also need to:

- Generate one Ed25519 updater keypair, embed the public key, and protect the private key in CI.
- Generate manifests from an explicit allowlisted artifact list—never scan the release directory containing DMGs, installers, DEBs, and RPMs.
- Require exactly one updater artifact per enabled platform and architecture.
- Produce fixed `stable.json` and `beta.json` channel manifests.
- Publish immutable versioned artifacts first and the channel manifest last.
- Download the public manifest and artifacts afterward and verify their exact versions, channels, digests, and signatures.
- Preserve all current installation artifacts for new installations and recovery.

So the build itself is largely reusable. The main work is adding safe updater-specific wrappers around the binaries, platform signing, explicit installation identity, and a stricter publication pipeline. The significant policy question is whether “all platforms” means adding a portable self-updating Linux distribution or accepting that package-manager installations remain notification-only.
