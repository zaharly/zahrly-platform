# Netlify deployment

The Zahrly Admin Dashboard is deployed on Netlify.

- Build command: `npm --prefix admin/frontend install --no-package-lock && npm --prefix admin/frontend run build`
- Publish directory: `admin/frontend/dist`
- Functions directory: `admin/netlify/functions`
- SPA fallback: `/* -> /index.html`

Vercel configuration is intentionally not used.
