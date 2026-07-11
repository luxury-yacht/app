import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const collectSuppressionErrors = (sources) => {
  const errors = [];
  for (const { file, content } of sources) {
    content.split('\n').forEach((line, index) => {
      const markerMatch = line.match(/biome-ignore(?:-all|-start|-end)?\s/);
      if (!markerMatch || markerMatch.index === undefined) {
        return;
      }
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
      for (const rule of ruleText.split(/\s+/).filter(Boolean)) {
        if (rule.split('/').length < 3) {
          errors.push(`${file}:${index + 1} Biome suppression must name an exact rule: ${rule}`);
        }
        if (!rationale) {
          errors.push(`${file}:${index + 1} Biome suppression requires a rationale: ${rule}`);
        }
      }
    });
  }
  return errors;
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
  'scripts/check-biome-suppressions.mjs',
  'scripts/check-biome-suppressions.test.mjs',
]);

export const readSourceFiles = (projectRoot) => {
  const sources = [];
  const visit = (entryPath) => {
    if (!fs.existsSync(entryPath)) {
      return;
    }
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      fs.readdirSync(entryPath)
        .filter((entry) => !excludedDirectories.has(entry))
        .forEach((entry) => {
          visit(path.join(entryPath, entry));
        });
      return;
    }
    if (!sourceExtensions.has(path.extname(entryPath))) {
      return;
    }
    const file = path.relative(projectRoot, entryPath).split(path.sep).join('/');
    if (!excludedFiles.has(file)) {
      sources.push({ file, content: fs.readFileSync(entryPath, 'utf8') });
    }
  };
  visit(projectRoot);
  return sources;
};

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const projectRoot = path.resolve(path.dirname(modulePath), '..');
  const errors = collectSuppressionErrors(readSourceFiles(projectRoot));
  if (errors.length > 0) {
    errors.forEach((error) => {
      console.error(error);
    });
    process.exitCode = 1;
  } else {
    console.info('Biome suppressions follow repository policy.');
  }
}
