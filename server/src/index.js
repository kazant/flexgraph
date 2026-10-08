// FlexGraph license server — Cloudflare Worker entry point.
//
//   POST /v1/validate                    license validation (public, CORS)
//   POST /v1/webhooks/lemonsqueezy       payment webhooks
//   POST /v1/webhooks/stripe
//   *    /v1/portal/...                  customer portal API
//   GET  /portal/                        customer portal UI (static asset)
//   PUT  /v1/admin/packages              publish a package version to the private registry
//   GET  /health                         uptime checks
//   npm.<your domain>/*                  private npm registry (read-only, token protected)

import { error, CORS, json } from './util.js';
import { handleValidate } from './validate.js';
import { handleLemonSqueezy, handleStripe } from './webhooks.js';
import { handlePortal } from './portal.js';
import { handleRegistry, handlePublish } from './registry.js';
import { runDaily } from './cron.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (env.REGISTRY_HOST && url.hostname === env.REGISTRY_HOST) return await handleRegistry(req, env, path, url.origin);
      if (path.startsWith('/npm/')) return await handleRegistry(req, env, path.slice(4), url.origin + '/npm');

      if (path === '/v1/validate') {
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        if (req.method === 'POST') return await handleValidate(req, env, ctx);
        return error(405, 'method', 'Use POST.', CORS);
      }
      if (path === '/v1/webhooks/lemonsqueezy' && req.method === 'POST') return await handleLemonSqueezy(req, env);
      if (path === '/v1/webhooks/stripe' && req.method === 'POST') return await handleStripe(req, env);
      if (path.startsWith('/v1/portal/')) return await handlePortal(req, env, path);
      if (path === '/v1/admin/packages' && req.method === 'PUT') return await handlePublish(req, env);
      if (path === '/health') {
        await env.DB.prepare('SELECT 1').first();
        return json({ ok: true });
      }
      if (env.ASSETS && (path === '/portal' || path.startsWith('/portal/'))) return env.ASSETS.fetch(req);
      return error(404, 'not-found', 'Not found.');
    } catch (err) {
      console.error(err);
      return error(500, 'server-error', 'Internal error.', path === '/v1/validate' ? CORS : {});
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDaily(env).then((r) => console.log('[cron]', JSON.stringify(r))));
  }
};
