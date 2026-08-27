// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Required for sitemap generation and absolute canonical/OG URLs.
  site: 'https://deadpixeltest.space',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [
    sitemap({
      // The fill routes are near-duplicate utility surfaces; the canonical
      // entry point is the guided sequence. Keep them in the sitemap but
      // don't let them outrank the pages that carry the explanatory content.
      serialize(item) {
        if (item.url.includes('/test/')) {
          item.priority = 0.6;
        }
        return item;
      }
    })
  ]
});
