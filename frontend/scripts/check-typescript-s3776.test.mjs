import { describe, expect, it } from 'vitest';
import {
  auditPullRequestIssues,
  buildMonotonicBaselineUpdate,
  compareS3776Baseline,
  fetchSonarIssues,
  normalizeS3776Issue,
  parseAuditArguments,
  runSonarAudit,
  validateBaseline,
} from './check-typescript-s3776.mjs';

const baseline = {
  schemaVersion: 1,
  projectKey: 'luxury-yacht_app',
  rule: 'typescript:S3776',
  threshold: 15,
  analysis: {
    branch: 'main',
    revision: 'abc123',
    date: '2026-08-07T00:18:02Z',
  },
  issues: [
    {
      key: 'existing-high',
      path: 'frontend/src/high.ts',
      line: 10,
      symbol: 'high',
      score: 30,
    },
    {
      key: 'existing-low',
      path: 'frontend/src/low.tsx',
      line: 20,
      symbol: 'low',
      score: 18,
    },
  ],
};

const issue = ({ key, path, line, score, rule = 'typescript:S3776', status = 'OPEN' }) => ({
  key,
  component: `luxury-yacht_app:${path}`,
  line,
  message: `Refactor this function to reduce its Cognitive Complexity from ${score} to the 15 allowed.`,
  rule,
  status,
  severity: 'CRITICAL',
  type: 'CODE_SMELL',
});

describe('TypeScript S3776 baseline validation', () => {
  it('accepts a unique production-source inventory', () => {
    expect(validateBaseline(baseline)).toEqual([]);
  });

  it('rejects duplicate keys, non-offending scores, and mismatched rules', () => {
    const invalid = {
      ...baseline,
      rule: 'javascript:S3776',
      issues: [baseline.issues[0], { ...baseline.issues[0], score: 15 }],
    };

    expect(validateBaseline(invalid)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('typescript:S3776'),
        expect.stringContaining('duplicate issue key existing-high'),
        expect.stringContaining('score must be greater than 15'),
      ])
    );
  });
});

describe('Sonar issue normalization', () => {
  it('extracts the project-relative path and reported complexity', () => {
    expect(
      normalizeS3776Issue(
        issue({
          key: 'sonar-key',
          path: 'frontend/src/example.tsx',
          line: 42,
          score: 27,
        }),
        'luxury-yacht_app'
      )
    ).toEqual({
      key: 'sonar-key',
      path: 'frontend/src/example.tsx',
      line: 42,
      score: 27,
    });
  });

  it('rejects a message without a reported score', () => {
    expect(() =>
      normalizeS3776Issue(
        {
          ...issue({ key: 'bad', path: 'frontend/src/bad.ts', line: 1, score: 20 }),
          message: 'Unexpected message',
        },
        'luxury-yacht_app'
      )
    ).toThrow('Unable to parse cognitive complexity');
  });
});

describe('monotonic S3776 comparison', () => {
  it('allows closed findings and lower retained scores', () => {
    const current = [
      normalizeS3776Issue(
        issue({ key: 'existing-high', path: 'frontend/src/high.ts', line: 15, score: 22 }),
        baseline.projectKey
      ),
    ];

    expect(compareS3776Baseline(baseline, current)).toEqual([]);
  });

  it('rejects new keys and increased retained scores', () => {
    const current = [
      normalizeS3776Issue(
        issue({ key: 'existing-high', path: 'frontend/src/high.ts', line: 10, score: 31 }),
        baseline.projectKey
      ),
      normalizeS3776Issue(
        issue({ key: 'new-key', path: 'frontend/src/new.tsx', line: 8, score: 16 }),
        baseline.projectKey
      ),
    ];

    expect(compareS3776Baseline(baseline, current)).toEqual([
      'S3776 score increased for existing-high (frontend/src/high.ts): 30 -> 31.',
      'New typescript:S3776 issue new-key at frontend/src/new.tsx:8 (score 16).',
    ]);
  });

  it('builds updates that only lower scores or remove closed keys', () => {
    const current = [
      normalizeS3776Issue(
        issue({ key: 'existing-high', path: 'frontend/src/high.ts', line: 15, score: 22 }),
        baseline.projectKey
      ),
    ];

    expect(
      buildMonotonicBaselineUpdate(baseline, current, {
        branch: 'main',
        revision: 'def456',
        date: '2026-08-08T00:00:00Z',
      })
    ).toEqual({
      ...baseline,
      analysis: {
        branch: 'main',
        revision: 'def456',
        date: '2026-08-08T00:00:00Z',
      },
      issues: [
        {
          ...baseline.issues[0],
          line: 15,
          score: 22,
        },
      ],
    });
  });
});

describe('pull-request all-rule audit', () => {
  it('reports every open or confirmed issue, not only S3776', () => {
    const diagnostics = auditPullRequestIssues(
      [
        issue({ key: 'complex', path: 'frontend/src/a.ts', line: 4, score: 16 }),
        {
          ...issue({ key: 'a11y', path: 'frontend/src/View.tsx', line: 9, score: 20 }),
          rule: 'typescript:S6848',
          message: 'Use a native interactive element.',
          severity: 'MAJOR',
        },
        {
          ...issue({ key: 'resolved', path: 'frontend/src/old.ts', line: 3, score: 20 }),
          status: 'RESOLVED',
        },
      ],
      'luxury-yacht_app'
    );

    expect(diagnostics).toEqual([
      'CRITICAL typescript:S3776 complex at frontend/src/a.ts:4: Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed.',
      'MAJOR typescript:S6848 a11y at frontend/src/View.tsx:9: Use a native interactive element.',
    ]);
  });
});

describe('Sonar API pagination', () => {
  it('loads every issue page', async () => {
    const requestedPages = [];
    const fetchImpl = async (url) => {
      const page = Number(new URL(url).searchParams.get('p'));
      requestedPages.push(page);
      return {
        ok: true,
        json: async () => ({
          paging: { pageIndex: page, pageSize: 2, total: 3 },
          issues: page === 1 ? [{ key: 'one' }, { key: 'two' }] : [{ key: 'three' }],
        }),
      };
    };

    await expect(
      fetchSonarIssues({
        apiBaseUrl: 'https://sonarcloud.io/api',
        projectKey: 'luxury-yacht_app',
        branch: 'main',
        rule: 'typescript:S3776',
        fetchImpl,
      })
    ).resolves.toEqual([{ key: 'one' }, { key: 'two' }, { key: 'three' }]);
    expect(requestedPages).toEqual([1, 2]);
  });

  it('retries a transient network failure without accepting partial results', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError('fetch failed');
      }
      return {
        ok: true,
        json: async () => ({
          paging: { pageIndex: 1, pageSize: 500, total: 1 },
          issues: [{ key: 'recovered' }],
        }),
      };
    };

    await expect(
      fetchSonarIssues({
        apiBaseUrl: 'https://sonarcloud.io/api',
        projectKey: 'luxury-yacht_app',
        branch: 'main',
        rule: 'typescript:S3776',
        fetchImpl,
        sleepImpl: async () => undefined,
      })
    ).resolves.toEqual([{ key: 'recovered' }]);
    expect(attempts).toBe(2);
  });
});

describe('audit command orchestration', () => {
  const response = (payload) => ({
    ok: true,
    json: async () => payload,
  });

  it('parses branch, pull-request, path, API, and update options', () => {
    expect(
      parseAuditArguments([
        '--branch',
        'main',
        '--baseline',
        './custom.json',
        '--api-base',
        'https://sonar.example/api',
        '--update-baseline',
      ])
    ).toEqual({
      apiBaseUrl: 'https://sonar.example/api',
      baselinePath: expect.stringMatching(/custom\.json$/),
      branch: 'main',
      updateBaseline: true,
    });
    expect(parseAuditArguments(['--pull-request', '123'])).toEqual(
      expect.objectContaining({ pullRequest: '123', updateBaseline: false })
    );
  });

  it.each([
    [[], 'Specify exactly one'],
    [['--branch', 'main', '--pull-request', '123'], 'Specify exactly one'],
    [['--pull-request', '123', '--update-baseline'], 'allowed only with --branch'],
    [['--unknown'], 'Unknown or incomplete argument'],
  ])('rejects invalid arguments %#', (args, message) => {
    expect(() => parseAuditArguments(args)).toThrow(message);
  });

  it('audits a branch and writes only a monotonic update', async () => {
    const responses = [
      response({
        paging: { pageIndex: 1, pageSize: 500, total: 1 },
        issues: [
          issue({ key: 'existing-high', path: 'frontend/src/high.ts', line: 15, score: 22 }),
        ],
      }),
      response({
        analyses: [{ revision: 'def456', date: '2026-08-08T00:00:00Z' }],
      }),
    ];
    const requests = [];
    const writes = [];
    const logs = [];
    const fetchImpl = async (url) => {
      requests.push(new URL(url));
      return responses.shift();
    };

    await runSonarAudit(
      {
        apiBaseUrl: 'https://sonar.example/api',
        baselinePath: '/tmp/baseline.json',
        branch: 'main',
        updateBaseline: true,
      },
      baseline,
      {
        fetchImpl,
        sleepImpl: async () => undefined,
        writeFile: (file, content) => writes.push({ file, content }),
        log: (message) => logs.push(message),
      }
    );

    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/issues/search',
      '/api/project_analyses/search',
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0].file).toBe('/tmp/baseline.json');
    expect(JSON.parse(writes[0].content)).toEqual(
      expect.objectContaining({
        analysis: {
          branch: 'main',
          revision: 'def456',
          date: '2026-08-08T00:00:00Z',
        },
        issues: [expect.objectContaining({ key: 'existing-high', score: 22, line: 15 })],
      })
    );
    expect(logs).toEqual([
      'TypeScript S3776 is monotonic on main: 1 open, 1 closed since baseline.',
      'Updated /tmp/baseline.json without accepting new or increased findings.',
    ]);
  });

  it('audits every pull-request rule and rejects invalid baselines first', async () => {
    const logs = [];
    await runSonarAudit(
      {
        apiBaseUrl: 'https://sonar.example/api',
        pullRequest: '123',
        updateBaseline: false,
      },
      baseline,
      {
        fetchImpl: async () =>
          response({ paging: { pageIndex: 1, pageSize: 500, total: 0 }, issues: [] }),
        sleepImpl: async () => undefined,
        log: (message) => logs.push(message),
      }
    );
    expect(logs).toEqual(['Sonar reports zero open/confirmed new-code issues on PR #123.']);

    await expect(
      runSonarAudit({ branch: 'main' }, { ...baseline, rule: 'javascript:S3776' })
    ).rejects.toThrow('baseline rule must be typescript:S3776');
  });
});
