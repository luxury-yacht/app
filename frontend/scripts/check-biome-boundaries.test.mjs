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
  const sourcePath = path.join(directory, 'adversarial.ts');
  writeFileSync(sourcePath, source);

  return spawnSync(
    path.join(process.cwd(), 'node_modules', '.bin', 'biome'),
    ['lint', '--config-path', path.join(directory, 'biome.json'), sourcePath],
    { encoding: 'utf8' }
  );
};

const lintWithProjectConfig = (source, baseDirectory = path.join(process.cwd(), 'src')) => {
  const directory = mkdtempSync(path.join(baseDirectory, '.biome-boundary-'));
  temporaryDirectories.push(directory);
  const sourcePath = path.join(directory, 'adversarial.ts');
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
    ['no-direct-lifecycle-read', 'runtime.GetAllClusterLifecycleStates();', 'appStateAccess'],
    ['no-direct-permission-read', 'runtime.QueryPermissions([]);', 'dataAccess'],
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
  ])('rejects forbidden calls enforced by %s', (pluginName, source, diagnostic) => {
    const result = lintWithPlugin(pluginName, source);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(diagnostic);
  });

  it.each([
    ['no-direct-fetch', 'dataAccess.readResources();'],
    ['no-direct-lifecycle-read', 'appStateAccess.readClusterLifecycleStates();'],
    ['no-direct-permission-read', 'dataAccess.readPermissions();'],
    ['no-direct-refresh-orchestrator', 'dataAccess.refreshContext();'],
  ])('accepts boundary calls outside %s', (pluginName, source) => {
    const result = lintWithPlugin(pluginName, source);

    expect(result.status).toBe(0);
  });

  it.each([
    ['fetch("/api/resources");', 'direct fetch calls'],
    ['runtime.GetAllClusterLifecycleStates();', 'appStateAccess'],
    ['runtime.QueryPermissions([]);', 'dataAccess'],
    ['orchestrator.fetchScopedDomain("cluster", {});', 'fetchScopedDomain'],
    ['orchestrator.triggerManualRefreshForContext({});', 'triggerManualRefreshForContext'],
  ])('rejects forbidden calls through the real project config', (source, diagnostic) => {
    const result = lintWithProjectConfig(source);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(diagnostic);
  });

  it('rejects relative imports of the generated backend App binding', () => {
    const result = lintWithProjectConfig(
      'import { GetAppInfo } from "../../wailsjs/go/backend/App"; void GetAppInfo;'
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Import generated backend bindings only through @/core/backend-api.'
    );
  });

  it('rejects aliased imports of the generated backend App binding outside the facade', () => {
    const result = lintWithProjectConfig(
      'import { GetAppInfo } from "@wailsjs/go/backend/App"; void GetAppInfo;'
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Import generated backend bindings only through @/core/backend-api.'
    );
  });

  it('allows the generated backend App binding inside the approved facade', () => {
    const result = lintWithProjectConfig(
      'import { GetAppInfo } from "@wailsjs/go/backend/App"; void GetAppInfo;',
      path.join(process.cwd(), 'src', 'core', 'backend-api')
    );

    expect(result.status).toBe(0);
  });
});
