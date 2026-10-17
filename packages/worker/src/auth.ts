import {
  AuthorizationError,
  authorizationErrorRedirect,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { z } from 'zod';

export type AppEnv = Env & { GITHUB_CLIENT_SECRET: string };
type AuthEnv = AppEnv & { OAUTH_PROVIDER: OAuthHelpers };
export const authPropsSchema = z.object({
  githubId: z.string().regex(/^[1-9]\d*$/),
  login: z.string(),
});
export function isOwner(props: unknown, allowed: string) {
  const parsed = authPropsSchema.safeParse(props);
  return (
    /^[1-9]\d*$/.test(allowed) &&
    parsed.success &&
    parsed.data.githubId === allowed
  );
}
export function configured(env: AppEnv) {
  try {
    const url = new URL(env.PUBLIC_ORIGIN);
    return (
      !!env.GITHUB_CLIENT_ID &&
      !!env.GITHUB_CLIENT_SECRET &&
      /^[1-9]\d*$/.test(env.ALLOWED_GITHUB_USER_ID) &&
      url.origin === env.PUBLIC_ORIGIN &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const redirect = (url: string, headers: Headers) => {
  headers.set('Location', url);
  return new Response(null, { status: 302, headers });
};
async function githubFetch(url: string, init: RequestInit) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
}
export async function handleAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const oauth = env.OAUTH_PROVIDER;
  if (url.pathname !== '/authorize' && url.pathname !== '/callback')
    return new Response('Not found', { status: 404 });
  if (!configured(env))
    return Response.json({ error: 'server_not_configured' }, { status: 503 });
  try {
    if (url.pathname === '/authorize' && request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request);
      if (!auth.codeChallenge || auth.codeChallengeMethod !== 'S256')
        return Response.json(
          {
            error: 'invalid_request',
            error_description: 'PKCE S256 is required',
          },
          { status: 400 },
        );
      if (
        auth.scope.some((s) => !['syllabus:read', 'offline_access'].includes(s))
      )
        return Response.json({ error: 'invalid_scope' }, { status: 400 });
      // The consent form explicitly approves this read-only scope, even if the client omitted it.
      auth.scope = [...new Set(['syllabus:read', ...auth.scope])];
      const info = await oauth.describeConsent(auth);
      const transaction = await oauth.beginConsent(auth);
      const headers = transaction.headers;
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Cache-Control', 'no-store');
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      return new Response(
        `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ZENシラバスへの接続</title><main><h1>ZENシラバスへの接続</h1><dl><dt>アプリ</dt><dd>${escape(info.clientName)}</dd><dt>接続先</dt><dd>${escape(info.redirectHost)}</dd><dt>権限</dt><dd>シラバスの読み取り${auth.scope.includes('offline_access') ? '、接続の継続' : ''}</dd></dl>${info.redirectIsLoopback ? '<p>端末内のアプリへの接続です。接続先を確認してください。</p>' : ''}<form method="post"><input type="hidden" name="handle" value="${escape(transaction.handle)}"><button name="action" value="approve">GitHubで認証して接続</button><button name="action" value="deny">接続を拒否</button></form></main></html>`,
        { headers },
      );
    }
    if (url.pathname === '/authorize' && request.method === 'POST') {
      if (request.headers.get('origin') !== env.PUBLIC_ORIGIN)
        return new Response('Forbidden', { status: 403 });
      const text = new TextDecoder().decode(await request.arrayBuffer());
      if (text.length > 16384)
        return new Response('Request too large', { status: 413 });
      const form = new URLSearchParams(text);
      const handle = form.get('handle');
      if (!handle)
        return new Response('Missing consent handle', { status: 400 });
      if (form.get('action') === 'deny') {
        const denied = await oauth.denyConsent(request, handle);
        return redirect(denied.redirectTo, denied.headers);
      }
      if (form.get('action') !== 'approve')
        return new Response('Invalid action', { status: 400 });
      const approved = await oauth.approveConsent(request, handle);
      const upstream = await oauth.beginUpstream(approved.request, {
        headers: approved.headers,
      });
      const github = new URL('https://github.com/login/oauth/authorize');
      github.search = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: `${env.PUBLIC_ORIGIN}/callback`,
        scope: 'read:user',
        state: upstream.state,
      }).toString();
      return redirect(github.href, upstream.headers);
    }
    if (url.pathname === '/callback' && request.method === 'GET') {
      const resumed = await oauth.finishUpstream(request);
      if (url.searchParams.has('error'))
        return redirect(
          authorizationErrorRedirect(resumed.request, 'access_denied'),
          resumed.headers,
        );
      const code = url.searchParams.get('code');
      if (!code)
        return new Response('Missing code', {
          status: 400,
          headers: resumed.headers,
        });
      const response = await githubFetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: `${env.PUBLIC_ORIGIN}/callback`,
          }),
        },
      );
      if (!response.ok)
        return new Response('GitHub authentication failed', {
          status: 502,
          headers: resumed.headers,
        });
      const token = z
        .object({ access_token: z.string().min(1) })
        .safeParse(await response.json());
      if (!token.success)
        return new Response('GitHub authentication failed', {
          status: 401,
          headers: resumed.headers,
        });
      const userResponse = await githubFetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token.data.access_token}`,
          'User-Agent': 'zen-syllabus-mcp',
        },
      });
      if (!userResponse.ok)
        return new Response('GitHub identity check failed', {
          status: 502,
          headers: resumed.headers,
        });
      const user = z
        .object({ id: z.number().int().positive().safe(), login: z.string() })
        .parse(await userResponse.json());
      const props = { githubId: String(user.id), login: user.login };
      if (!isOwner(props, env.ALLOWED_GITHUB_USER_ID))
        return new Response('このGitHubアカウントには利用権限がありません', {
          status: 403,
          headers: resumed.headers,
        });
      // Only the identity is stored. The upstream GitHub token is never persisted.
      const completed = await oauth.completeAuthorization({
        request: resumed.request,
        userId: props.githubId,
        scope: resumed.request.scope,
        metadata: { label: user.login },
        props,
      });
      return redirect(completed.redirectTo, resumed.headers);
    }
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: url.pathname === '/authorize' ? 'GET, POST' : 'GET' },
    });
  } catch (e) {
    if (e instanceof AuthorizationError)
      return Response.json(
        { error: e.code, error_description: e.description },
        { status: 400 },
      );
    console.error(JSON.stringify({ event: 'oauth_error' }));
    return Response.json({ error: 'authentication_failed' }, { status: 400 });
  }
}
