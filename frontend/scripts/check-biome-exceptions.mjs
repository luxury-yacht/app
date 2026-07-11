import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const overrideKey = ({ includes, rules }) =>
  `${[...includes].sort().join(',')}::${[...rules].sort().join(',')}`;
const suppressionKey = ({ file, rule, count }) => `${file}::${rule}::${count}`;
const lifetimeHookNames = [
  'useEffectWithInvalidation',
  'useLayoutEffectWithInvalidation',
  'useMemoWithInvalidation',
  'useMountEffect',
];

export const collectSuppressions = (sources) => {
  const errors = [];
  const counts = new Map();
  for (const { file, content } of sources) {
    content.split('\n').forEach((line, index) => {
      const markerMatch = line.match(/biome-ignore(?:-all|-start|-end)?\s/);
      if (!markerMatch || markerMatch.index === undefined) return;
      const suppressionForm = markerMatch[0].trim();
      if (suppressionForm !== 'biome-ignore') {
        errors.push(
          `${file}:${index + 1} Biome suppression form ${suppressionForm} is prohibited; use an exact inline biome-ignore directive`
        );
        return;
      }
      const directive = line.slice(markerMatch.index + markerMatch[0].length);
      const rationaleSeparator = directive.indexOf(':');
      const ruleText =
        rationaleSeparator < 0 ? directive.trim() : directive.slice(0, rationaleSeparator).trim();
      const rationale =
        rationaleSeparator < 0 ? '' : directive.slice(rationaleSeparator + 1).trim();
      const rules = ruleText.split(/\s+/).filter(Boolean);
      rules.forEach((rule) => {
        if (rule.split('/').length < 3) {
          errors.push(`${file}:${index + 1} Biome suppression must name an exact rule: ${rule}`);
        }
        if (!rationale) {
          errors.push(`${file}:${index + 1} Biome suppression requires a rationale: ${rule}`);
        }
        const key = `${file}::${rule}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    });
  }
  const suppressions = [...counts.entries()].map(([key, count]) => {
    const separator = key.indexOf('::');
    return {
      file: key.slice(0, separator),
      rule: key.slice(separator + 2),
      count,
    };
  });
  return { errors, suppressions };
};

const collectOffRulePaths = (value, prefix = []) => {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = [...prefix, key];
    if (child === 'off') return [path.join('.')];
    return collectOffRulePaths(child, path);
  });
};

export const collectDisabledOverrides = (config) =>
  (config.overrides ?? []).flatMap((override) => {
    const rules = collectOffRulePaths(override.linter?.rules).sort();
    return rules.length > 0
      ? [
          {
            includes: [...override.includes],
            rules,
          },
        ]
      : [];
  });

const configuredRuleLevel = (rules, rulePath) => {
  const configured = rulePath.split('.').reduce((value, key) => value?.[key], rules);
  return typeof configured === 'object' && configured !== null ? configured.level : configured;
};

export const collectConfigPolicyErrors = (config, policy) => {
  const errors = [];
  if (config.formatter?.enabled !== true) {
    errors.push('Biome formatter must remain enabled.');
  }
  if (config.assist?.enabled !== true) {
    errors.push('Biome assist must remain enabled.');
  }
  if (config.linter?.enabled !== true) {
    errors.push('Biome linter must remain enabled.');
  }

  const rules = config.linter?.rules ?? {};
  if (rules.preset !== policy.rulePreset) {
    errors.push(`Biome rule preset must remain ${policy.rulePreset}.`);
  }
  collectOffRulePaths(rules)
    .filter((rule) => rule !== 'preset')
    .forEach((rule) => {
      errors.push(`Biome global rule disabling is prohibited: ${rule}`);
    });

  for (const rule of policy.requiredRules ?? []) {
    if (configuredRuleLevel(rules, rule) !== 'error') {
      errors.push(`Biome strict rule must remain at error: ${rule}`);
    }
  }

  const exhaustiveOptions = rules.correctness?.useExhaustiveDependencies?.options;
  if (exhaustiveOptions?.reportUnnecessaryDependencies !== true) {
    errors.push('Biome unnecessary hook dependency reporting must remain enabled.');
  }
  const configuredHooks = new Set((exhaustiveOptions?.hooks ?? []).map(({ name }) => name));
  for (const hook of policy.requiredHooks ?? []) {
    if (!configuredHooks.has(hook)) {
      errors.push(`Biome exhaustive-dependency hook is missing: ${hook}`);
    }
  }

  const fileIncludes = config.files?.includes ?? [];
  const includesExtension = (pattern, extension) => {
    if (pattern.startsWith('!')) return false;
    if (pattern.endsWith(`.${extension}`)) return true;
    return [...pattern.matchAll(/\{([^{}]+)\}/g)].some((match) =>
      match[1].split(',').includes(extension)
    );
  };
  for (const extension of policy.requiredFileExtensions ?? []) {
    if (!fileIncludes.some((pattern) => includesExtension(pattern, extension))) {
      errors.push(`Biome files.includes must cover .${extension} files.`);
    }
  }

  const configuredPlugins = new Map(
    (config.plugins ?? []).map((plugin) => [plugin.path, plugin.includes ?? []])
  );
  for (const requiredPlugin of policy.requiredPlugins ?? []) {
    const pluginPath = typeof requiredPlugin === 'string' ? requiredPlugin : requiredPlugin.path;
    if (!configuredPlugins.has(pluginPath)) {
      errors.push(`Biome boundary plugin is missing: ${pluginPath}`);
      continue;
    }
    if (
      typeof requiredPlugin !== 'string' &&
      JSON.stringify(configuredPlugins.get(pluginPath)) !== JSON.stringify(requiredPlugin.includes)
    ) {
      errors.push(`Biome boundary plugin scope must remain exact: ${pluginPath}`);
    }
  }

  for (const override of config.overrides ?? []) {
    const scope = `[${(override.includes ?? []).join(', ')}]`;
    if (override.linter?.enabled === false) {
      errors.push(`Biome override may not disable the linter: ${scope}`);
    }
    if (override.linter?.rules?.preset === 'none') {
      errors.push(`Biome override may not set the rule preset to none: ${scope}`);
    }
  }
  return errors;
};

export const collectLifetimeHookCallsites = (sources) =>
  sources
    .map(({ file, content }) => {
      const hooks = Object.fromEntries(
        lifetimeHookNames.flatMap((hook) => {
          const count = [...content.matchAll(new RegExp(`\\b${hook}\\s*\\(`, 'g'))].length;
          return count > 0 ? [[hook, count]] : [];
        })
      );
      return { file, hooks };
    })
    .filter(({ hooks }) => Object.keys(hooks).length > 0)
    .sort((left, right) => left.file.localeCompare(right.file));

export const validateLifetimeHookSnapshot = (actual, approved) => {
  const actualByFile = new Map(actual.map((entry) => [entry.file, entry.hooks]));
  const approvedByFile = new Map(approved.map((entry) => [entry.file, entry.hooks]));
  const errors = actual
    .filter(({ file }) => !approvedByFile.has(file))
    .map(
      ({ file, hooks }) => `Unapproved hook lifetime callsite: ${file} ${JSON.stringify(hooks)}`
    );
  for (const { file, hooks } of actual) {
    const expected = approvedByFile.get(file);
    if (expected && JSON.stringify(expected) !== JSON.stringify(hooks)) {
      errors.push(
        `Changed hook lifetime callsite: ${file} expected ${JSON.stringify(expected)}, found ${JSON.stringify(hooks)}`
      );
    }
  }
  errors.push(
    ...approved
      .filter(({ file }) => !actualByFile.has(file))
      .map(
        ({ file, hooks }) =>
          `Stale approved hook lifetime callsite: ${file} ${JSON.stringify(hooks)}`
      )
  );
  return errors;
};

export const validateExceptionSnapshot = ({
  actualOverrides,
  approvedOverrides,
  actualSuppressions,
  approvedSuppressions,
}) => {
  const manifestErrors = approvedOverrides
    .filter((override) => !override.reason?.trim())
    .map(
      (override) =>
        `Approved Biome override requires a rationale: [${override.includes.join(', ')}] disables ${override.rules.join(', ')}`
    );
  const approvedKeys = new Set(approvedOverrides.map(overrideKey));
  const actualOverrideKeys = new Set(actualOverrides.map(overrideKey));
  const overrideErrors = actualOverrides
    .filter((override) => !approvedKeys.has(overrideKey(override)))
    .map(
      (override) =>
        `Unapproved Biome override: [${override.includes.join(', ')}] disables ${override.rules.join(', ')}`
    );
  const staleOverrideErrors = approvedOverrides
    .filter((override) => !actualOverrideKeys.has(overrideKey(override)))
    .map(
      (override) =>
        `Stale approved Biome override: [${override.includes.join(', ')}] disables ${override.rules.join(', ')}`
    );
  const approvedSuppressionKeys = new Set(approvedSuppressions.map(suppressionKey));
  const actualSuppressionKeys = new Set(actualSuppressions.map(suppressionKey));
  const suppressionErrors = actualSuppressions
    .filter((suppression) => !approvedSuppressionKeys.has(suppressionKey(suppression)))
    .map(
      (suppression) =>
        `Unapproved Biome suppression: ${suppression.file} disables ${suppression.rule} (${suppression.count} occurrence${suppression.count === 1 ? '' : 's'})`
    );
  const staleSuppressionErrors = approvedSuppressions
    .filter((suppression) => !actualSuppressionKeys.has(suppressionKey(suppression)))
    .map(
      (suppression) =>
        `Stale approved Biome suppression: ${suppression.file} disables ${suppression.rule} (${suppression.count} occurrence${suppression.count === 1 ? '' : 's'})`
    );
  return [
    ...manifestErrors,
    ...overrideErrors,
    ...staleOverrideErrors,
    ...suppressionErrors,
    ...staleSuppressionErrors,
  ];
};

const sourceExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.jsonc',
]);
const excludedDirectories = new Set(['node_modules', 'dist', 'wailsjs', 'coverage']);
const excludedFiles = new Set([
  'package-lock.json',
  'src/core/refresh/types.generated.ts',
  'scripts/check-biome-exceptions.mjs',
  'scripts/check-biome-exceptions.test.mjs',
]);

export const readSourceFiles = (projectRoot) => {
  const sources = [];
  const visit = (entryPath) => {
    if (!fs.existsSync(entryPath)) return;
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      fs.readdirSync(entryPath)
        .filter((entry) => !excludedDirectories.has(entry))
        .forEach((entry) => {
          visit(path.join(entryPath, entry));
        });
      return;
    }
    if (!sourceExtensions.has(path.extname(entryPath))) return;
    const file = path.relative(projectRoot, entryPath).split(path.sep).join('/');
    if (excludedFiles.has(file)) return;
    sources.push({ file, content: fs.readFileSync(entryPath, 'utf8') });
  };
  visit(projectRoot);
  return sources;
};

export const validateProjectExceptions = (projectRoot) => {
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'biome.json'), 'utf8'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'biome-exceptions.json'), 'utf8')
  );
  const sources = readSourceFiles(projectRoot);
  const collected = collectSuppressions(sources);
  return [
    ...collected.errors,
    ...collectConfigPolicyErrors(config, manifest.strictness),
    ...validateExceptionSnapshot({
      actualOverrides: collectDisabledOverrides(config),
      approvedOverrides: manifest.overrides,
      actualSuppressions: collected.suppressions,
      approvedSuppressions: manifest.suppressions,
    }),
    ...validateLifetimeHookSnapshot(
      collectLifetimeHookCallsites(sources),
      manifest.hookLifetimes ?? []
    ),
  ];
};

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const projectRoot = path.resolve(path.dirname(modulePath), '..');
  const errors = validateProjectExceptions(projectRoot);
  if (errors.length > 0) {
    errors.forEach((error) => {
      console.error(error);
    });
    process.exitCode = 1;
  } else {
    console.log('Biome exception snapshot matches the approved manifest.');
  }
}
