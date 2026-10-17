import OAuthProvider, {
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { createServer } from './mcp.js';
import { configured, handleAuth, isOwner, type AppEnv } from './auth.js';

export function createProvider(env: AppEnv) {
  return new OAuthProvider<AppEnv>({
    apiRoute: '/mcp',
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    scopesSupported: ['syllabus:read', 'offline_access'],
    requiredScopes: ['syllabus:read'],
    resourceMetadata: {
      resource: `${env.PUBLIC_ORIGIN}/mcp`,
      resource_name: 'ZEN大学シラバス',
    },
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 24 * 60 * 60,
    apiHandler: {
      async fetch(request, bindings, ctx) {
        if (!isOwner(ctx.props, bindings.ALLOWED_GITHUB_USER_ID))
          return new Response('Forbidden', { status: 403 });
        const auth = z
          .object({ scope: z.array(z.string()) })
          .safeParse('auth' in ctx ? ctx.auth : undefined);
        if (!auth.success || !auth.data.scope.includes('syllabus:read'))
          return Response.json(
            { error: 'insufficient_scope' },
            { status: 403 },
          );
        return createMcpHandler(() => createServer(), {
          route: '/mcp',
          corsOptions: false,
        })(request, bindings, ctx);
      },
    },
    defaultHandler: {
      fetch(request, bindings) {
        if (!('OAUTH_PROVIDER' in bindings))
          return new Response('OAuth unavailable', { status: 503 });
        return handleAuth(
          request,
          bindings as AppEnv & { OAUTH_PROVIDER: OAuthHelpers },
        );
      },
    },
  });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return Response.json({ status: 'ok', service: 'zen-syllabus-mcp' });
    if (!configured(env))
      return Response.json({ error: 'server_not_configured' }, { status: 503 });
    // Pin OAuth issuer/resource/callback URLs to deployment configuration, never to forwarded Host headers.
    if (url.origin !== env.PUBLIC_ORIGIN)
      return new Response('Invalid host', { status: 400 });
    const started = Date.now();
    try {
      const response = await createProvider(env).fetch(request, env, ctx);
      console.log(
        JSON.stringify({
          event: 'request',
          path: url.pathname,
          status: response.status,
          durationMs: Date.now() - started,
        }),
      );
      return response;
    } catch {
      console.error(
        JSON.stringify({ event: 'request_error', path: url.pathname }),
      );
      return Response.json({ error: 'internal_error' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<AppEnv>;
