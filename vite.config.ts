import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The public gold landing is lazy-loaded (its chunk carries three + the
 * public Recharts charts), which would add a discovery roundtrip to the
 * PUBLIC page — the shop window. This plugin injects
 * <link rel="modulepreload"> for that chunk into the built index.html so the
 * browser fetches it in parallel with the entry chunk.
 */
function preloadGoldLanding(): Plugin {
  return {
    name: 'preload-gold-landing',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return
        const tags = []
        for (const chunk of Object.values(ctx.bundle)) {
          if (
            chunk.type === 'chunk' &&
            chunk.facadeModuleId?.replace(/\\/g, '/').includes('pages/public/gold/GoldLanding')
          ) {
            tags.push({
              tag: 'link',
              attrs: { rel: 'modulepreload', crossorigin: true, href: '/' + chunk.fileName },
              injectTo: 'head' as const,
            })
          }
        }
        return tags
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), preloadGoldLanding()],
})
