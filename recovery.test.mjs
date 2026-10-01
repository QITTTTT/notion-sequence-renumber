import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createNotionClient } from './notion-client.mjs';

function fixture(responses) {
  const delays = [];
  let calls = 0;
  const notion = createNotionClient({}, {
    fetchImpl: async () => {
      const item = responses[Math.min(calls++, responses.length - 1)];
      if (item instanceof Error) throw item;
      return item();
    },
    sleep: async (ms) => delays.push(ms),
    warn: () => {},
  });
  return { notion, delays, calls: () => calls };
}
const ok = () => new Response('{"results":[]}');
const serverError = () => new Response('{"code":"internal_server_error"}', { status: 500 });

test('server and network errors recover with backoff', async () => {
  const f = fixture([serverError, new TypeError('fetch failed'), ok]);
  assert.deepEqual(await f.notion('/test'), { results: [] });
  assert.deepEqual(f.delays, [1000, 2000]);
});
test('response body network failure is retryable', async () => {
  const f = fixture([() => ({ text: async () => { throw new Error('connection reset'); } }), ok]);
  await f.notion('/test');
  assert.equal(f.calls(), 2);
});
test('429 respects Retry-After', async () => {
  const f = fixture([() => new Response('{}', { status: 429, headers: { 'Retry-After': '45' } }), ok]);
  await f.notion('/test');
  assert.deepEqual(f.delays, [45000]);
});
test('persistent 500 has a bounded retry budget', async () => {
  const f = fixture([serverError]);
  await assert.rejects(f.notion('/test'), (error) => error.retryable === true);
  assert.equal(f.calls(), 6);
});
test('authentication and validation failures stop immediately', async () => {
  for (const status of [400, 401, 403, 404]) {
    const f = fixture([() => new Response('{}', { status })]);
    await assert.rejects(f.notion('/test'), (error) => error.retryable === false);
    assert.equal(f.calls(), 1);
  }
});
test('request timeout aborts a stalled request', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const notion = createNotionClient({}, {
      requestTimeoutMs: 5, maxRetries: 0,
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    });
    await assert.rejects(notion('/test'), (error) => error.retryable === true);
  } finally { clearInterval(keepAlive); }
});

function poll(statuses, minutes = '12') {
  const script = `
    statuses=(${statuses.join(' ')})
    index=0
    timeout() {
      code=\${statuses[$index]:-0}
      index=$((index + 1))
      return "$code"
    }
    sleep() { echo "WAIT $1"; SECONDS=$((SECONDS + $1)); }
    source ./poll.sh
  `;
  const result = spawnSync(process.env.TEST_BASH || 'bash', ['--noprofile', '--norc', '-c', script], {
    encoding: 'utf8', env: { ...process.env, NOTION_TOKEN: 'test', POLLING_MINUTES: minutes },
  });
  if (result.error) throw result.error;
  return result;
}
test('polling recovers, resets backoff, and returns to one-second pauses', () => {
  const r = poll([75, 75, 0, 75, 0]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WAIT 30[\s\S]*WAIT 60[\s\S]*WAIT 1[\s\S]*WAIT 30/);
});
test('polling stops after five consecutive temporary failures', () => {
  const r = poll([75, 75, 75, 75, 75]);
  assert.equal(r.status, 75);
  assert.match(r.stdout, /Five consecutive/);
});
test('polling retries a round timeout but stops on permanent failures', () => {
  assert.equal(poll([124, 0]).status, 0);
  const r = poll([1]);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /WAIT/);
});
test('unresolved failures at window end remain failures', () => {
  const r = poll([75, 75], '1');
  assert.equal(r.status, 75);
  assert.match(r.stdout, /without recovery/);
});
