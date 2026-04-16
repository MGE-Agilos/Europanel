/**
 * EuroPanel — Static file server Edge Function
 *
 * Sert les fichiers du bucket Supabase Storage "Europanel"
 * avec les bons Content-Type headers.
 *
 * URL de l'app : https://vxwmhsgxoomcbiukeinp.supabase.co/functions/v1/bright-handler
 */

const STORAGE_BASE =
  'https://vxwmhsgxoomcbiukeinp.supabase.co/storage/v1/object/public/Europanel';

const MIME: Record<string, string> = {
  html:  'text/html; charset=utf-8',
  css:   'text/css; charset=utf-8',
  js:    'application/javascript; charset=utf-8',
  ico:   'image/x-icon',
  png:   'image/png',
  svg:   'image/svg+xml',
  woff2: 'font/woff2',
};

const STATIC_FILES = new Set(['style.css', 'app.js', 'pages-0-6.js', 'pages-7-12.js']);

// CSP that allows our scripts/styles without the default sandbox restriction
const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self' https://vxwmhsgxoomcbiukeinp.supabase.co",
  "img-src 'self' data:",
].join('; ');

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // Strip /functions/v1/<any-name>/ — works regardless of function name
  let path = url.pathname.replace(/^\/functions\/v1\/[^/]+\/?/, '');

  // Redirect root without trailing slash so relative asset URLs resolve correctly
  // e.g. /functions/v1/bright-handler → /functions/v1/bright-handler/
  if (path === '' && !url.pathname.endsWith('/')) {
    return Response.redirect(url.href + '/', 301);
  }

  // SPA: any unknown path → index.html
  const file = STATIC_FILES.has(path) ? path : 'index.html';

  const ext = file.split('.').pop()?.toLowerCase() ?? 'html';
  const contentType = MIME[ext] ?? 'application/octet-stream';

  try {
    const res = await fetch(`${STORAGE_BASE}/${file}`);

    if (!res.ok) {
      return new Response(`File not found: ${file}`, { status: 404 });
    }

    const body = await res.arrayBuffer();

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': file === 'index.html'
        ? 'no-cache'
        : 'public, max-age=86400',
    };

    // Only set CSP on HTML — overrides Supabase's default sandbox CSP
    if (file === 'index.html') {
      headers['Content-Security-Policy'] = HTML_CSP;
    }

    return new Response(body, { status: 200, headers });
  } catch (err) {
    return new Response(`Error: ${err}`, { status: 500 });
  }
});
