import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_RULE = 'typescript:S3776';
const EXPECTED_THRESHOLD = 15;
const OPEN_STATUSES = new Set(['OPEN', 'CONFIRMED']);
const DEFAULT_API_BASE_URL = 'https://sonarcloud.io/api';
const DEFAULT_BASELINE_FILE = 'typescript-s3776-baseline.json';
const DEFAULT_NETWORK_RETRIES = 4;

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const parseReportedScore = (message) => {
  const match = message?.match(/Cognitive Complexity from (\d+) to (?:the )?(\d+) allowed/);
  if (!match) {
    throw new Error(`Unable to parse cognitive complexity from Sonar message: ${message}`);
  }
  const score = Number(match[1]);
  const threshold = Number(match[2]);
  if (threshold !== EXPECTED_THRESHOLD) {
    throw new Error(
      `Sonar reported an unexpected S3776 threshold of ${threshold}; expected ${EXPECTED_THRESHOLD}.`
    );
  }
  return score;
};

const projectRelativePath = (component, projectKey) => {
  const prefix = `${projectKey}:`;
  if (typeof component !== 'string' || !component.startsWith(prefix)) {
    throw new Error(`Sonar component ${component} does not belong to project ${projectKey}.`);
  }
  return component.slice(prefix.length);
};

export const normalizeS3776Issue = (issue, projectKey) => {
  if (issue.rule !== EXPECTED_RULE) {
    throw new Error(`Expected ${EXPECTED_RULE}, received ${issue.rule}.`);
  }
  return {
    key: issue.key,
    path: projectRelativePath(issue.component, projectKey),
    line: issue.line,
    score: parseReportedScore(issue.message),
  };
};

export const validateBaseline = (baseline) => {
  const errors = [];
  if (baseline?.schemaVersion !== 1) {
    errors.push('S3776 baseline schemaVersion must be 1.');
  }
  if (baseline?.rule !== EXPECTED_RULE) {
    errors.push(`S3776 baseline rule must be ${EXPECTED_RULE}.`);
  }
  if (baseline?.threshold !== EXPECTED_THRESHOLD) {
    errors.push(`S3776 baseline threshold must be ${EXPECTED_THRESHOLD}.`);
  }
  if (!baseline?.projectKey) {
    errors.push('S3776 baseline projectKey is required.');
  }
  if (!baseline?.analysis?.branch || !baseline?.analysis?.revision || !baseline?.analysis?.date) {
    errors.push('S3776 baseline analysis must include branch, revision, and date.');
  }
  if (!Array.isArray(baseline?.issues)) {
    errors.push('S3776 baseline issues must be an array.');
    return errors;
  }

  const seenKeys = new Set();
  for (const issue of baseline.issues) {
    if (!issue?.key) {
      errors.push('S3776 baseline issue key is required.');
    } else if (seenKeys.has(issue.key)) {
      errors.push(`S3776 baseline has duplicate issue key ${issue.key}.`);
    } else {
      seenKeys.add(issue.key);
    }
    if (typeof issue?.path !== 'string' || !issue.path.startsWith('frontend/src/')) {
      errors.push(
        `S3776 baseline issue ${issue?.key ?? '<missing>'} must reference frontend/src/.`
      );
    }
    if (!Number.isInteger(issue?.line) || issue.line < 1) {
      errors.push(`S3776 baseline issue ${issue?.key ?? '<missing>'} line must be positive.`);
    }
    if (typeof issue?.symbol !== 'string' || issue.symbol.trim().length === 0) {
      errors.push(`S3776 baseline issue ${issue?.key ?? '<missing>'} symbol is required.`);
    }
    if (!Number.isInteger(issue?.score) || issue.score <= EXPECTED_THRESHOLD) {
      errors.push(
        `S3776 baseline issue ${issue?.key ?? '<missing>'} score must be greater than ${EXPECTED_THRESHOLD}.`
      );
    }
  }
  return errors;
};

export const compareS3776Baseline = (baseline, currentIssues) => {
  const diagnostics = [];
  const baselineByKey = new Map(baseline.issues.map((issue) => [issue.key, issue]));
  const currentKeys = new Set();

  for (const current of currentIssues) {
    if (currentKeys.has(current.key)) {
      diagnostics.push(`Sonar returned duplicate typescript:S3776 issue ${current.key}.`);
      continue;
    }
    currentKeys.add(current.key);
    const previous = baselineByKey.get(current.key);
    if (!previous) {
      diagnostics.push(
        `New typescript:S3776 issue ${current.key} at ${current.path}:${current.line} (score ${current.score}).`
      );
      continue;
    }
    if (current.score > previous.score) {
      diagnostics.push(
        `S3776 score increased for ${current.key} (${current.path}): ${previous.score} -> ${current.score}.`
      );
    }
  }

  return diagnostics;
};

export const buildMonotonicBaselineUpdate = (baseline, currentIssues, analysis) => {
  const diagnostics = compareS3776Baseline(baseline, currentIssues);
  if (diagnostics.length > 0) {
    throw new Error(`Refusing non-monotonic baseline update:\n${diagnostics.join('\n')}`);
  }
  const baselineByKey = new Map(baseline.issues.map((issue) => [issue.key, issue]));
  const issues = currentIssues
    .map((current) => {
      const previous = baselineByKey.get(current.key);
      return {
        ...previous,
        path: current.path,
        line: current.line,
        score: current.score,
      };
    })
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  return {
    ...baseline,
    analysis,
    issues,
  };
};

export const auditPullRequestIssues = (issues, projectKey) =>
  issues
    .filter((issue) => OPEN_STATUSES.has(issue.status))
    .map((issue) => {
      const location = `${projectRelativePath(issue.component, projectKey)}:${issue.line ?? 1}`;
      return `${issue.severity} ${issue.rule} ${issue.key} at ${location}: ${issue.message}`;
    });

const readJsonResponse = async (response, url) => {
  if (!response.ok) {
    const body = await response.text?.();
    throw new Error(`Sonar API request failed (${response.status}) for ${url}: ${body ?? ''}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(
      `Sonar API request failed for ${url}: ${payload.errors.map((error) => error.msg).join('; ')}`
    );
  }
  return payload;
};

const fetchWithNetworkRetry = async ({
  url,
  fetchImpl,
  sleepImpl,
  retries = DEFAULT_NETWORK_RETRIES,
}) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchImpl(url);
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      await sleepImpl(250 * 2 ** attempt);
    }
  }
};

export const fetchSonarIssues = async ({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  projectKey,
  branch,
  pullRequest,
  rule,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) => {
  const issues = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (issues.length < total) {
    const url = new URL(`${apiBaseUrl}/issues/search`);
    url.searchParams.set('componentKeys', projectKey);
    url.searchParams.set('issueStatuses', 'OPEN,CONFIRMED');
    url.searchParams.set('ps', '500');
    url.searchParams.set('p', String(page));
    if (branch) {
      url.searchParams.set('branch', branch);
    }
    if (pullRequest) {
      url.searchParams.set('pullRequest', pullRequest);
    }
    if (rule) {
      url.searchParams.set('rules', rule);
    }

    const response = await fetchWithNetworkRetry({ url, fetchImpl, sleepImpl });
    const payload = await readJsonResponse(response, url);
    const pageIssues = payload.issues ?? [];
    issues.push(...pageIssues);
    total = payload.paging?.total ?? issues.length;
    if (pageIssues.length === 0 && issues.length < total) {
      throw new Error(`Sonar API pagination stopped before all ${total} issues were returned.`);
    }
    page += 1;
  }

  return issues;
};

const fetchLatestAnalysis = async ({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  projectKey,
  branch,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) => {
  const url = new URL(`${apiBaseUrl}/project_analyses/search`);
  url.searchParams.set('project', projectKey);
  url.searchParams.set('branch', branch);
  url.searchParams.set('ps', '1');
  const response = await fetchWithNetworkRetry({ url, fetchImpl, sleepImpl });
  const payload = await readJsonResponse(response, url);
  const analysis = payload.analyses?.[0];
  if (!analysis?.revision || !analysis?.date) {
    throw new Error(`Sonar has no completed analysis for ${projectKey}:${branch}.`);
  }
  return {
    branch,
    revision: analysis.revision,
    date: analysis.date,
  };
};

export const parseAuditArguments = (argv) => {
  const options = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    baselinePath: path.join(path.dirname(fileURLToPath(import.meta.url)), DEFAULT_BASELINE_FILE),
    updateBaseline: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    switch (argument) {
      case '--branch':
        options.branch = next;
        index += 1;
        break;
      case '--pull-request':
        options.pullRequest = next;
        index += 1;
        break;
      case '--baseline':
        options.baselinePath = path.resolve(next);
        index += 1;
        break;
      case '--api-base':
        options.apiBaseUrl = next;
        index += 1;
        break;
      case '--update-baseline':
        options.updateBaseline = true;
        break;
      default:
        throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (Boolean(options.branch) === Boolean(options.pullRequest)) {
    throw new Error('Specify exactly one of --branch <name> or --pull-request <number>.');
  }
  if (options.pullRequest && options.updateBaseline) {
    throw new Error('--update-baseline is allowed only with --branch.');
  }
  return options;
};

const readBaseline = (baselinePath) => JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const runBranchAudit = async (
  options,
  baseline,
  { fetchImpl = fetch, sleepImpl = sleep, writeFile = fs.writeFileSync, log = console.info } = {}
) => {
  const rawIssues = await fetchSonarIssues({
    apiBaseUrl: options.apiBaseUrl,
    projectKey: baseline.projectKey,
    branch: options.branch,
    rule: EXPECTED_RULE,
    fetchImpl,
    sleepImpl,
  });
  const issues = rawIssues.map((issue) => normalizeS3776Issue(issue, baseline.projectKey));
  const diagnostics = compareS3776Baseline(baseline, issues);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }

  const closedCount = baseline.issues.length - issues.length;
  log(
    `TypeScript S3776 is monotonic on ${options.branch}: ${issues.length} open, ${closedCount} closed since baseline.`
  );
  if (options.updateBaseline) {
    const analysis = await fetchLatestAnalysis({
      apiBaseUrl: options.apiBaseUrl,
      projectKey: baseline.projectKey,
      branch: options.branch,
      fetchImpl,
      sleepImpl,
    });
    const updated = buildMonotonicBaselineUpdate(baseline, issues, analysis);
    writeFile(options.baselinePath, `${JSON.stringify(updated, null, 2)}\n`);
    log(`Updated ${options.baselinePath} without accepting new or increased findings.`);
  }
};

const runPullRequestAudit = async (
  options,
  baseline,
  { fetchImpl = fetch, sleepImpl = sleep, log = console.info } = {}
) => {
  const issues = await fetchSonarIssues({
    apiBaseUrl: options.apiBaseUrl,
    projectKey: baseline.projectKey,
    pullRequest: options.pullRequest,
    fetchImpl,
    sleepImpl,
  });
  const diagnostics = auditPullRequestIssues(issues, baseline.projectKey);
  if (diagnostics.length > 0) {
    throw new Error(
      `Sonar reports ${diagnostics.length} open/confirmed new-code issue(s):\n${diagnostics.join('\n')}`
    );
  }
  log(`Sonar reports zero open/confirmed new-code issues on PR #${options.pullRequest}.`);
};

export const runSonarAudit = async (options, baseline, dependencies) => {
  const validationErrors = validateBaseline(baseline);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join('\n'));
  }
  if (options.branch) {
    await runBranchAudit(options, baseline, dependencies);
  } else {
    await runPullRequestAudit(options, baseline, dependencies);
  }
};

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    const options = parseAuditArguments(process.argv.slice(2));
    const baseline = readBaseline(options.baselinePath);
    await runSonarAudit(options, baseline);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
