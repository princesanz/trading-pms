import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The public gold landing is lazy-loaded (its chunk carries three + the
 * public Recharts charts), which would add a discovery roundtrip to the
 * PUBLIC page — the shop window. So we want to preload that chunk in parallel
 * with the entry chunk.
 *
 * But GoldLanding renders ONLY for signed-out visitors (Overview → PublicOverview
 * → GoldLanding); an authenticated admin never mounts it. A static
 * <link rel="modulepreload"> in index.html fires for everyone, making admin
 * sessions eagerly fetch ~239 kB gz they never use.
 *
 * Instead of a static tag, we inject a tiny synchronous head script that gates
 * the preload on auth state: it appends the modulepreload link ONLY when there
 * is no Supabase session in localStorage (key `sb-<ref>-auth-token`, written
 * synchronously by supabase-js). Public visitors still preload it at parse time
 * (LCP unchanged); admins skip it entirely. The gate is a perf heuristic, not a
 * security boundary — a rare signed-in non-admin just pays one discovery
 * roundtrip on GoldLanding.
 */
function preloadGoldLanding(): Plugin {
  return {
    name: 'preload-gold-landing',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return
        for (const chunk of Object.values(ctx.bundle)) {
          if (
            chunk.type === 'chunk' &&
            chunk.facadeModuleId?.replace(/\\/g, '/').includes('pages/public/gold/GoldLanding')
          ) {
            const href = '/' + chunk.fileName
            const script =
              '(function(){try{' +
              'for(var i=0;i<localStorage.length;i++){' +
              'var k=localStorage.key(i);' +
              "if(k&&k.indexOf('sb-')===0&&k.indexOf('-auth-token')!==-1)return;" +
              '}}catch(e){}' +
              "var l=document.createElement('link');" +
              "l.rel='modulepreload';l.crossOrigin='';l.href=" + JSON.stringify(href) + ';' +
              'document.head.appendChild(l);' +
              '})();'
            return [
              {
                tag: 'script',
                children: script,
                injectTo: 'head' as const,
              },
            ]
          }
        }
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), preloadGoldLanding()],
})
