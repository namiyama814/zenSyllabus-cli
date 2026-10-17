import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import worker from '../src/index.js';
import { isOwner, configured, type AppEnv } from '../src/auth.js';
import { envelope, subject, numbering } from '../../../tests/fixtures.mjs';

const bindings = () =>
  ({ ...env, GITHUB_CLIENT_SECRET: 'test-secret' }) as AppEnv;
let jar: Map<string, string>;
let githubId: number;
let apiFailure: boolean;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  jar = new Map();
  githubId = 12345;
  apiFailure = false;
  fetcher = vi.fn(async (input: string | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.href === 'https://github.com/login/oauth/access_token') {
      expect(String(init?.body)).toContain('client_secret=test-secret');
      return Response.json({
        access_token: 'github-token-must-never-be-stored',
      });
    }
    if (url.href === 'https://api.github.com/user')
      return Response.json({ id: githubId, login: 'owner' });
    if (url.origin !== 'https://api.syllabus.zen.ac.jp')
      throw new Error('Unexpected network request');
    if (apiFailure) return Response.json({ broken: true });
    const n = url.searchParams.get('subject_numbering') ?? numbering;
    return Response.json(envelope([subject({ numbering: n })]));
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function send(path: string, init: RequestInit = {}, custom = bindings()) {
  const headers = new Headers(init.headers);
  if (!headers.has('Cookie') && jar.size)
    headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  const request = new Request(new URL(path, custom.PUBLIC_ORIGIN), {
    ...init,
    headers,
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, custom, ctx);
  await waitOnExecutionContext(ctx);
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]!;
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return response;
}
async function register() {
  const r = await send('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: '<script>evil</script>',
      redirect_uris: ['https://client.test/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  expect(r.status).toBe(201);
  return (await r.json()) as { client_id: string };
}
const verifier = 'a'.repeat(64);
async function startAuth(override: Record<string, string> = {}) {
  const client = await register();
  const challenge = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(verifier),
        ),
      ),
    ),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: 'https://client.test/callback',
    response_type: 'code',
    scope: 'syllabus:read offline_access',
    state: 'client-state',
    resource: 'https://zen.test/mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...override,
  });
  const consent = await send(`/authorize?${params}`);
  return { client, consent };
}
async function approve() {
  const { client, consent } = await startAuth();
  expect(consent.status).toBe(200);
  const html = await consent.text();
  expect(html).toContain('&lt;script&gt;evil&lt;/script&gt;');
  expect(html).not.toContain('<script>evil');
  expect(html).toContain('client.test');
  const handle = html.match(/name="handle" value="([^"]+)"/)![1]!;
  const r = await send('/authorize', {
    method: 'POST',
    headers: {
      Origin: 'https://zen.test',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ handle, action: 'approve' }),
  });
  expect(r.status).toBe(302);
  const github = new URL(r.headers.get('Location')!);
  expect(github.origin).toBe('https://github.com');
  expect(github.searchParams.get('scope')).toBe('read:user');
  return { client, state: github.searchParams.get('state')! };
}
async function authorizationCode() {
  const { client, state } = await approve();
  const r = await send(
    `/callback?state=${encodeURIComponent(state)}&code=github-code`,
  );
  return {
    client,
    response: r,
    code: r.headers.get('Location')
      ? new URL(r.headers.get('Location')!).searchParams.get('code')
      : null,
    state,
  };
}
async function exchange(
  clientId: string,
  code: string,
  codeVerifier = verifier,
) {
  return send('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: 'https://client.test/callback',
      code_verifier: codeVerifier,
      resource: 'https://zen.test/mcp',
    }),
  });
}
async function token() {
  const { client, response, code } = await authorizationCode();
  expect(response.status).toBe(302);
  expect(
    new URL(response.headers.get('Location')!).searchParams.get('state'),
  ).toBe('client-state');
  const r = await exchange(client.client_id, code!);
  expect(r.status).toBe(200);
  return {
    ...((await r.json()) as { access_token: string; refresh_token: string }),
    clientId: client.client_id,
  };
}
async function rpc(accessToken: string, method: string, params?: unknown) {
  const r = await send('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      ...(params ? { params } : {}),
    }),
  });
  const text = await r.text();
  const payload =
    text.startsWith('event:') || text.startsWith('data:')
      ? JSON.parse(
          text
            .split('\n')
            .find((l) => l.startsWith('data:'))!
            .slice(5),
        )
      : JSON.parse(text);
  return { response: r, payload };
}

describe('Workers MCP and OAuth', () => {
  it('serves health and fails closed without configuration', async () => {
    expect(
      (await send('/health', {}, { ...bindings(), ALLOWED_GITHUB_USER_ID: '' }))
        .status,
    ).toBe(200);
    expect(
      (await send('/mcp', {}, { ...bindings(), ALLOWED_GITHUB_USER_ID: '' }))
        .status,
    ).toBe(503);
    expect(
      configured({ ...bindings(), PUBLIC_ORIGIN: 'http://unsafe.example' }),
    ).toBe(false);
    expect(isOwner({ githubId: '12345', login: 'owner' }, '')).toBe(false);
  });
  it('supports local HTTP discovery for localhost development', async () => {
    const r = await send(
      '/.well-known/oauth-authorization-server',
      {},
      { ...bindings(), PUBLIC_ORIGIN: 'http://localhost:8787' },
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveProperty(
      'authorization_endpoint',
      'http://localhost:8787/authorize',
    );
  });
  it('publishes discovery and challenges unauthenticated requests', async () => {
    const discovery = await send('/.well-known/oauth-authorization-server');
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({
      authorization_endpoint: 'https://zen.test/authorize',
      token_endpoint: 'https://zen.test/token',
    });
    const r = await send('/mcp');
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toContain('resource_metadata');
    expect(
      (await send('/mcp', { headers: { Authorization: 'Bearer invalid' } }))
        .status,
    ).toBe(401);
  });
  it('runs initialization and every read-only tool through OAuth in the Workers runtime', async () => {
    const credentials = await token();
    const init = await rpc(credentials.access_token, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.response.status).toBe(200);
    expect(init.payload.result.serverInfo.name).toBe('zen-syllabus');
    const list = await rpc(credentials.access_token, 'tools/list');
    expect(list.payload.result.tools).toHaveLength(5);
    expect(
      list.payload.result.tools.every(
        (t: { annotations: { readOnlyHint: boolean } }) =>
          t.annotations.readOnlyHint,
      ),
    ).toBe(true);
    const calls = [
      ['search_subjects', { query: 'Python', quarter: '1q' }],
      ['get_subject', { year: 2026, numbering }],
      [
        'compare_subjects',
        { year: 2026, numberings: [numbering, 'INF-1-C1-1030-002'] },
      ],
      ['get_subject_relations', { year: 2026, numbering }],
      ['list_filter_options', { kind: 'teacher' }],
    ] as const;
    for (const [name, args] of calls) {
      const result = await rpc(credentials.access_token, 'tools/call', {
        name,
        arguments: args,
      });
      expect(result.response.status, name).toBe(200);
      expect(
        result.payload.result.isError,
        JSON.stringify(result.payload),
      ).not.toBe(true);
      expect(result.payload.result.structuredContent).toBeDefined();
    }
    const invalid = await rpc(credentials.access_token, 'tools/call', {
      name: 'search_subjects',
      arguments: { quarter: 'invalid' },
    });
    expect(
      invalid.payload.error || invalid.payload.result?.isError,
    ).toBeTruthy();
    apiFailure = true;
    const upstream = await rpc(credentials.access_token, 'tools/call', {
      name: 'get_subject',
      arguments: { year: 2026, numbering },
    });
    expect(upstream.payload.result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'UPSTREAM_SCHEMA' } },
    });
  });
  it('rejects a different GitHub account before issuing a code', async () => {
    githubId = 54321;
    const { response } = await authorizationCode();
    expect(response.status).toBe(403);
    expect(response.headers.get('Location')).toBeNull();
  });
  it('requires PKCE S256', async () => {
    const { consent } = await startAuth({ code_challenge_method: 'plain' });
    expect(consent.status).toBe(400);
  });
  it('rejects mismatched PKCE on code exchange', async () => {
    const { client, code } = await authorizationCode();
    const r = await exchange(client.client_id, code!, 'b'.repeat(64));
    expect(r.status).toBe(400);
  });
  it('binds upstream state to the approving browser and consumes it once', async () => {
    const { state } = await approve();
    const saved = jar;
    jar = new Map();
    expect((await send(`/callback?state=${state}&code=x`)).status).toBe(400);
    jar = saved;
    // A mismatched state must never reach GitHub.
    expect((await send('/callback?state=wrong&code=x')).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('denies a consent form without its binding cookie', async () => {
    const { consent } = await startAuth();
    const handle = (await consent.text()).match(
      /name="handle" value="([^"]+)"/,
    )![1]!;
    jar.clear();
    const r = await send('/authorize', {
      method: 'POST',
      headers: { Origin: 'https://zen.test' },
      body: new URLSearchParams({ handle, action: 'approve' }),
    });
    expect(r.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects the same token after the allowed owner changes', async () => {
    const credentials = await token();
    expect(
      (
        await send(
          '/mcp',
          { headers: { Authorization: `Bearer ${credentials.access_token}` } },
          { ...bindings(), ALLOWED_GITHUB_USER_ID: '98765' },
        )
      ).status,
    ).toBe(403);
  });
  it('rejects expired access tokens and refreshes valid grants', async () => {
    const credentials = await token();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 2 * 60 * 60 * 1000);
    expect(
      (
        await send('/mcp', {
          headers: { Authorization: `Bearer ${credentials.access_token}` },
        })
      ).status,
    ).toBe(401);
    vi.restoreAllMocks();
    const r = await send('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: credentials.clientId,
        refresh_token: credentials.refresh_token,
        resource: 'https://zen.test/mcp',
      }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveProperty('access_token');
  });
  it('rejects replayed callback state and authorization codes', async () => {
    const { client, response, code, state } = await authorizationCode();
    expect(response.status).toBe(302);
    expect(
      (await send(`/callback?state=${state}&code=github-code`)).status,
    ).toBe(400);
    expect((await exchange(client.client_id, code!)).status).toBe(200);
    expect((await exchange(client.client_id, code!)).status).toBe(400);
  });
  it('supports declining a client and rejects cross-origin approval', async () => {
    const { consent } = await startAuth();
    const handle = (await consent.text()).match(
      /name="handle" value="([^"]+)"/,
    )![1]!;
    const body = new URLSearchParams({ handle, action: 'deny' }).toString();
    expect(
      (
        await send('/authorize', {
          method: 'POST',
          headers: { Origin: 'https://evil.test' },
          body,
        })
      ).status,
    ).toBe(403);
    const declined = await send('/authorize', {
      method: 'POST',
      headers: { Origin: 'https://zen.test' },
      body,
    });
    expect(declined.status).toBe(302);
    expect(
      new URL(declined.headers.get('Location')!).searchParams.get('error'),
    ).toBe('access_denied');
  });
  it('keeps OAuth codes and tokens out of application logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const credentials = await token();
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain('github-code');
    expect(output).not.toContain('test-secret');
    expect(output).not.toContain(credentials.access_token);
    expect(output).not.toContain(credentials.refresh_token);
    expect(output).not.toContain('github-token-must-never-be-stored');
    expect(output).toContain('request');
  });
  it('stores no GitHub token in KV', async () => {
    await token();
    const keys = await env.OAUTH_KV.list();
    for (const key of keys.keys)
      expect(await env.OAUTH_KV.get(key.name)).not.toContain(
        'github-token-must-never-be-stored',
      );
  });
});
