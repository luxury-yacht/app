import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const overrideKey = ({ includes, rules }) =>
  `${[...includes].sort().join(',')}::${[...rules].sort().join(',')}`;
const suppressionKey = ({ file, rule, count }) => `${file}::${rule}::${count}`;

export const collectSuppressions = (sources) => {
  const errors = [];
  const counts = new Map();
  for (const { file, content } of sources) {
    content.split('\n').forEach((line, index) => {
      const markerIndex = line.indexOf('biome-ignore ');
      if (markerIndex < 0) return;
      const directive = line.slice(markerIndex + 'biome-ignore '.length);
      const rationaleSeparator = directive.indexOf(':');
      const ruleText =
        rationaleSeparator < 0 ? directive.trim() : directive.slice(0, rationaleSeparator).trim();
      const rationale =
        rationaleSeparator < 0 ? '' : directive.slice(rationaleSeparator + 1).trim();
      const rules = ruleText.split(/\s+/).filter(Boolean);
      rules.forEach((rule) => {
        if (rule.split('/').length < 3) {
          errors.push(
            `${file}:${index + 1} Biome suppression must name an exact rule: ${rule}`
          );
        }
        if (!rationale) {
          errors.push(
            `${file}:${index + 1} Biome suppression requires a rationale: ${rule}`
          );
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

const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.html']);

export const readSourceFiles = (projectRoot) => {
  const sources = [];
  const visit = (entryPath) => {
    if (!fs.existsSync(entryPath)) return;
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      fs.readdirSync(entryPath).forEach((entry) => visit(path.join(entryPath, entry)));
      return;
    }
    if (!sourceExtensions.has(path.extname(entryPath))) return;
    const file = path.relative(projectRoot, entryPath).split(path.sep).join('/');
    if (file === 'scripts/check-biome-exceptions.mjs' || file === 'scripts/check-biome-exceptions.test.mjs') {
      return;
    }
    sources.push({ file, content: fs.readFileSync(entryPath, 'utf8') });
  };
  ['src', '.storybook', 'styles', 'scripts'].forEach((directory) =>
    visit(path.join(projectRoot, directory))
  );
  return sources;
};

export const validateProjectExceptions = (projectRoot) => {
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'biome.json'), 'utf8'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'biome-exceptions.json'), 'utf8')
  );
  const collected = collectSuppressions(readSourceFiles(projectRoot));
  return [
    ...collected.errors,
    ...validateExceptionSnapshot({
      actualOverrides: collectDisabledOverrides(config),
      approvedOverrides: manifest.overrides,
      actualSuppressions: collected.suppressions,
      approvedSuppressions: manifest.suppressions,
    }),
  ];
};

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const projectRoot = path.resolve(path.dirname(modulePath), '..');
  const errors = validateProjectExceptions(projectRoot);
  if (errors.length > 0) {
    errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log('Biome exception snapshot matches the approved manifest.');
  }
}
