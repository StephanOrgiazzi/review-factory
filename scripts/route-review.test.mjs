import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIALISTS, routeReview } from './route-review.mjs';

const context = (overrides = {}) => ({
  target: 'base-sha..head-sha', changedLines: 2, changedFiles: 1,
  securitySensitive: false, performanceRelevant: false, contextComplete: true,
  files: ['README.md'], summary: 'Correct a documentation typo.',
  diff: '-recieve\n+receive', ...overrides,
});
const response = (probabilities = {}) => ({
  model: 'jev-test',
  answers: Object.fromEntries([...SPECIALISTS.map(role => [role, {
    type: 'noul', noul: probabilities[role] ?? 0.01,
  }]), ...['generalist', ...SPECIALISTS].map(role => [`reasoning_${role}`, {
    type: 'choice', choice: 'low', confidence: 0.95,
    probabilities: { low: 0.98, medium: 0.01, high: 0.01 },
  }])]),
  usage: { input_tokens: 123, output_tokens: 45 },
});
const live = (body = response()) => ({
  live: true, apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => body }),
});
const mustNotFetch = async () => { assert.fail('Unexpected network request'); };

test('offline routing preserves trivial, lite, performance, and full floors', async () => {
  const cases = [
    [{ changedLines: 10 }, 'trivial', ['generalist']],
    [{ changedLines: 11 }, 'lite', ['correctness', 'design', 'tests-docs']],
    [{ changedLines: 100, performanceRelevant: true }, 'lite', ['correctness', 'design', 'tests-docs', 'performance']],
    [{ changedLines: 101 }, 'full', SPECIALISTS],
    [{ securitySensitive: true }, 'full', SPECIALISTS],
    [{ changedFiles: 21, files: Array.from({ length: 21 }, (_, i) => `f${i}`) }, 'full', SPECIALISTS],
  ];
  for (const [change, tier, reviewers] of cases) {
    const result = await routeReview(context(change), { fetchImpl: mustNotFetch });
    assert.equal(result.tier, tier);
    assert.deepEqual(result.reviewers, reviewers);
    assert.equal(result.reason, 'disabled');
  }
});

test('live mode makes no request without a key or complete bounded evidence', async () => {
  const cases = [
    [{}, { apiKey: '' }, 'missing-api-key'],
    [{ contextComplete: false }, {}, 'incomplete-context'],
    [{ diff: 'x'.repeat(16_001) }, {}, 'state-budget-exceeded'],
  ];
  for (const [change, options, reason] of cases) {
    const result = await routeReview(context(change), {
      ...live(), fetchImpl: mustNotFetch, ...options,
    });
    assert.equal(result.source, 'baseline');
    assert.equal(result.reason, reason);
    assert.equal(result.coordinatorReviewRequired, true);
  }
});

test('independent domains share one documented API request with bounded transport', async () => {
  let calls = 0;
  const result = await routeReview(context({ unusedSecret: 'must-not-leave' }), {
    ...live(), model: 'jev-pinned',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      assert.ok(options.signal instanceof AbortSignal);
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'jev-pinned');
      assert.equal(Object.keys(request.questions).length, 15);
      assert.ok(SPECIALISTS.every(role => request.questions[role].type === 'noul'));
      assert.ok(['generalist', ...SPECIALISTS].every(role => request.questions[`reasoning_${role}`].type === 'choice'));
      assert.ok(!options.body.includes('must-not-leave'));
      return { ok: true, json: async () => response({ performance: 0.95, release: 0.5 }) };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.reviewers, ['generalist', 'performance', 'release']);
  assert.deepEqual(result.uncertainReviewers, ['release']);
  assert.equal(result.model, 'jev-test');
  assert.equal(result.probabilities.performance, 0.95);
  assert.deepEqual(result.usage, { input_tokens: 123, output_tokens: 45 });
});

test('a small security change under an innocuous filename escalates to full', async () => {
  const result = await routeReview(context({
    files: ['src/handler.ts'], summary: 'Change request processing.',
    diff: '-if (user.id !== record.ownerId) throw new Error("Forbidden");\n+// ownership check removed',
  }), live(response({ security: 0.95 })));
  assert.equal(result.tier, 'full');
  for (const role of SPECIALISTS) assert.ok(result.reviewers.includes(role));
});

test('uncertain security is escalated; probability boundaries are inclusive', async () => {
  for (const probability of [0.2, 0.5, 0.8, 1]) {
    const result = await routeReview(context(), live(response({ security: probability })));
    assert.equal(result.tier, 'full');
    assert.equal(result.uncertainReviewers.includes('security'), probability < 0.8);
  }
  const low = await routeReview(context(), live(response({ security: 0.199 })));
  assert.equal(low.tier, 'trivial');
});

test('model answers cannot remove required reviewers or emit a verdict', async () => {
  const input = context({ changedLines: 50, performanceRelevant: true, requiredReviewers: ['release'] });
  const result = await routeReview(input, live(response()));
  assert.deepEqual(result.reviewers, ['correctness', 'design', 'tests-docs', 'performance', 'release']);
  assert.equal(result.coordinatorReviewRequired, true);
  assert.ok(!('verdict' in result));
});

test('HTTP errors fall back without retries or parsing sensitive error bodies', async () => {
  for (const status of [401, 422, 429, 500, 529]) {
    let calls = 0;
    const result = await routeReview(context(), {
      ...live(), fetchImpl: async () => {
        calls++;
        return { ok: false, status, json: mustNotFetch };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.reason, `http-${status}`);
    assert.deepEqual(result.reviewers, ['generalist']);
  }
});

test('malformed or partial provider answers cannot influence reviewer selection', async () => {
  const bodies = [null, {}, { ...response(), answers: {} }];
  for (const value of [-1, 1.01, NaN, Infinity, '0.9', null]) {
    const body = response();
    body.answers.security.noul = value;
    bodies.push(body);
  }
  const wrongType = response();
  wrongType.answers.security.type = 'score';
  bodies.push(wrongType);
  for (const body of bodies) {
    const result = await routeReview(context(), live(body));
    assert.equal(result.reason, 'invalid-response');
    assert.equal(result.probabilities, null);
    assert.deepEqual(result.reviewers, ['generalist']);
  }
});

test('network failures, timeout, and invalid JSON fall back without leaking secrets', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('test-key source-code'); },
    async () => ({ ok: true, json: async () => { throw new Error('source-code'); } }),
    async (_url, { signal }) => new Promise((_, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('timeout not applied')), 1000);
      signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
    }),
  ]) {
    const result = await routeReview(context(), { ...live(), fetchImpl, timeoutMs: 10 });
    assert.equal(result.source, 'baseline');
    assert.ok(!JSON.stringify(result).includes('test-key'));
    assert.ok(!JSON.stringify(result).includes('source-code'));
  }
});

test('invalid context stops before any network request', async () => {
  const cases = [null, {}, context({ changedLines: -1 }), context({ securitySensitive: 'false' }),
    context({ contextComplete: undefined }), context({ changedFiles: 2 }),
    context({ requiredReviewers: ['unknown'] }), context({ diff: '' })];
  for (const input of cases) {
    await assert.rejects(routeReview(input, { ...live(), fetchImpl: mustNotFetch }));
  }
});

test('context fingerprint changes when evidence changes', async () => {
  const first = await routeReview(context());
  const same = await routeReview(context());
  const edited = await routeReview(context({ diff: '-old\n+new' }));
  assert.equal(first.contextHash, same.contextHash);
  assert.notEqual(first.contextHash, edited.contextHash);
});

test('each selected subagent receives its own reasoning effort and model tier', async () => {
  const body = response({ performance: 0.95 });
  body.answers.reasoning_performance = {
    type: 'choice', choice: 'high', confidence: 0.9,
    probabilities: { low: 0.01, medium: 0.04, high: 0.95 },
  };
  const result = await routeReview(context(), live(body));
  assert.deepEqual(result.reviewerPlan.map(({ reviewer, reasoningEffort, modelTier }) =>
    [reviewer, reasoningEffort, modelTier]), [
    ['generalist', 'low', 'cheaper-capable'], ['performance', 'high', 'stronger-capable'],
  ]);
});

test('full reviews still use Jev to allocate effort without removing specialists', async () => {
  const result = await routeReview(context({ securitySensitive: true }), live());
  assert.equal(result.source, 'jev');
  assert.deepEqual(result.reviewers, SPECIALISTS);
  assert.equal(result.reviewerPlan.find(plan => plan.reviewer === 'security').reasoningEffort, 'medium');
  assert.equal(result.reviewerPlan.find(plan => plan.reviewer === 'release').reasoningEffort, 'medium');
  assert.equal(result.reviewerPlan.find(plan => plan.reviewer === 'design').reasoningEffort, 'low');
});

test('uncertain, missing, or malformed effort answers escalate only selected reviewers', async () => {
  const valid = response().answers.reasoning_generalist;
  for (const answer of [undefined, { ...valid, confidence: 0.79 }, { ...valid, choice: 'minimal' },
    { ...valid, probabilities: { low: 1, medium: 1, high: 1 } },
    { ...valid, probabilities: { low: 0.1, medium: 0.1, high: 0.8 } }]) {
    const body = response();
    body.answers.reasoning_generalist = answer;
    const result = await routeReview(context(), live(body));
    assert.equal(result.reviewerPlan[0].reasoningEffort, 'high');
    assert.equal(result.reviewerPlan[0].modelTier, 'stronger-capable');
    assert.deepEqual(result.reviewers, ['generalist']);
  }
  const body = response();
  body.answers.reasoning_security = null;
  body.answers.reasoning_generalist.confidence = 0.8;
  const result = await routeReview(context(), live(body));
  assert.equal(result.reviewerPlan[0].reasoningEffort, 'low');
  assert.equal(result.reviewerPlan.length, 1);
});

test('offline effort is explicitly delegated to the coordinator', async () => {
  const result = await routeReview(context());
  assert.equal(result.reviewerPlan[0].reasoningEffort, null);
  assert.equal(result.reviewerPlan[0].reason, 'coordinator-required');
});

test('CLI is offline by default and rejects invalid JSON without echoing contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-factory-'));
  try {
    const path = join(directory, 'context.json');
    const script = fileURLToPath(new URL('./route-review.mjs', import.meta.url));
    await writeFile(path, JSON.stringify(context()));
    const ok = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.equal(JSON.parse(ok.stdout).reason, 'disabled');
    await writeFile(path, '{ secret-value');
    const invalid = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.ok(!invalid.stderr.includes('secret-value'));
    assert.equal(invalid.stdout, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
