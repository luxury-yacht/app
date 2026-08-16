import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const lintWithPlugin = (pluginName, source) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'luxury-yacht-biome-plugin-'));
  temporaryDirectories.push(directory);
  cpSync(
    path.join(process.cwd(), 'biome-plugins', `${pluginName}.grit`),
    path.join(directory, `${pluginName}.grit`)
  );
  writeFileSync(
    path.join(directory, 'biome.json'),
    JSON.stringify({
      linter: { enabled: true, rules: { preset: 'none' } },
      plugins: [{ path: `./${pluginName}.grit` }],
    })
  );
  const sourcePath = path.join(directory, 'adversarial.tsx');
  writeFileSync(sourcePath, source);

  return spawnSync(
    path.join(process.cwd(), 'node_modules', '.bin', 'biome'),
    ['lint', '--config-path', path.join(directory, 'biome.json'), sourcePath],
    { encoding: 'utf8' }
  );
};

const lintWithProjectConfig = (
  source,
  baseDirectory = path.join(process.cwd(), 'src'),
  fileName = 'adversarial.ts'
) => {
  const directory = mkdtempSync(path.join(baseDirectory, '.biome-boundary-'));
  temporaryDirectories.push(directory);
  const sourcePath = path.join(directory, fileName);
  writeFileSync(sourcePath, source);
  return spawnSync(
    path.join(process.cwd(), 'node_modules', '.bin', 'biome'),
    ['lint', sourcePath],
    { encoding: 'utf8' }
  );
};

describe('Biome architectural boundary plugins', () => {
  it.each([
    ['no-direct-fetch', 'fetch("/api/resources");', 'direct fetch calls'],
    ['no-direct-permission-read', 'runtime.QueryPermissions([]);', 'dataAccess'],
    ['no-direct-cluster-workspace', 'runtime.GetClusterWorkspaceState();', 'clusterWorkspaceStore'],
    ['no-direct-cluster-workspace', 'GetClusterWorkspaceState();', 'clusterWorkspaceStore'],
    [
      'no-direct-cluster-workspace',
      'runtime.onEvent("cluster:lifecycle", handler);',
      'clusterWorkspaceStore',
    ],
    [
      'no-direct-cluster-workspace',
      'onEvent("cluster:lifecycle", handler);',
      'clusterWorkspaceStore',
    ],
    [
      'no-direct-refresh-orchestrator',
      'orchestrator.fetchScopedDomain("cluster", {});',
      'fetchScopedDomain',
    ],
    [
      'no-direct-refresh-orchestrator',
      'orchestrator.triggerManualRefreshForContext({});',
      'triggerManualRefreshForContext',
    ],
    ['no-direct-console-error', 'console.error("load failed", error);', 'errorHandler'],
    [
      'no-inline-error-text',
      'const loadError = "failed"; const View = () => <div>{loadError}</div>;',
      'ErrorSurface',
    ],
    [
      'no-inline-error-text',
      'const error = new Error("failed"); const View = () => <div>{error}</div>;',
      'ErrorSurface',
    ],
    [
      'no-inline-error-text',
      'const result = { error: "failed" }; const View = () => <div>{result.error}</div>;',
      'ErrorSurface',
    ],
    [
      'no-inline-error-text',
      'const error = new Error("failed"); const View = () => <div>{error.message}</div>;',
      'ErrorSurface',
    ],
    [
      'no-inline-error-text',
      'const error = new Error("failed"); const View = () => <div>{String(error)}</div>;',
      'ErrorSurface',
    ],
    [
      'no-inline-error-text',
      'const error = new Error("failed"); const View = () => <div>{error.toString()}</div>;',
      'ErrorSurface',
    ],
    [
      'no-inline-error-text',
      'const message = "failed"; const View = () => <div className="inline-error">{message}</div>;',
      'ErrorSurface',
    ],
    [
      'no-inline-error-text',
      'const message = "failed"; const View = () => <div role="alert">{message}</div>;',
      'ErrorSurface',
    ],
  ])('rejects forbidden calls enforced by %s: %s', (pluginName, source, diagnostic) => {
    const result = lintWithPlugin(pluginName, source);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(diagnostic);
  });

  it.each([
    ['no-direct-fetch', 'dataAccess.readResources();'],
    ['no-direct-permission-read', 'dataAccess.readPermissions();'],
    ['no-direct-refresh-orchestrator', 'dataAccess.refreshContext();'],
  ])('accepts boundary calls outside %s', (pluginName, source) => {
    const result = lintWithPlugin(pluginName, source);

    expect(result.status).toBe(0);
  });

  it('allows error text passed as data to the shared presentation boundary', () => {
    const result = lintWithPlugin(
      'no-inline-error-text',
      'const validationError = "invalid"; const View = () => <ErrorSurface kind="validation" message={validationError} />;'
    );

    expect(result.status).toBe(0);
  });

  it.each([
    ['fetch("/api/resources");', 'direct fetch calls'],
    ['runtime.QueryPermissions([]);', 'dataAccess'],
    ['runtime.GetClusterWorkspaceState();', 'clusterWorkspaceStore'],
    ['GetClusterWorkspaceState();', 'clusterWorkspaceStore'],
    ['runtime.onEvent("cluster:auth:failed", handler);', 'clusterWorkspaceStore'],
    ['onEvent("cluster:auth:failed", handler);', 'clusterWorkspaceStore'],
    ['orchestrator.fetchScopedDomain("cluster", {});', 'fetchScopedDomain'],
    ['orchestrator.triggerManualRefreshForContext({});', 'triggerManualRefreshForContext'],
    ['console.error("load failed", error);', 'errorHandler'],
  ])('rejects forbidden calls through the real project config', (source, diagnostic) => {
    const result = lintWithProjectConfig(source);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(diagnostic);
  });

  it('rejects inline error text through the real project TSX configuration', () => {
    const result = lintWithProjectConfig(
      'const loadError = "failed"; const View = () => <div>{loadError}</div>;',
      path.join(process.cwd(), 'src'),
      'adversarial.tsx'
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('ErrorSurface');
  });

  it('rejects relative imports of the generated backend DesktopService binding', () => {
    const result = lintWithProjectConfig(
      'import { GetAppInfo } from "../../bindings/github.com/luxury-yacht/app/backend/desktopservice"; void GetAppInfo;'
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Import generated backend bindings only through @/core/backend-api.'
    );
  });

  it('rejects aliased imports of the generated backend DesktopService binding outside the facade', () => {
    const result = lintWithProjectConfig(
      'import { GetAppInfo } from "@bindings/github.com/luxury-yacht/app/backend/desktopservice"; void GetAppInfo;'
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Import generated backend bindings only through @/core/backend-api.'
    );
  });

  it('allows the generated backend DesktopService binding inside the approved facade', () => {
    const result = lintWithProjectConfig(
      'import { GetAppInfo } from "@bindings/github.com/luxury-yacht/app/backend/desktopservice"; void GetAppInfo;',
      path.join(process.cwd(), 'src', 'core', 'backend-api')
    );

    expect(result.status).toBe(0);
  });
});
