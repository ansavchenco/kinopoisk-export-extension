import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Kinopoisk export',
    // With no popup, the manifest needs an empty `action` to show the toolbar icon.
    action: {},
    permissions: ['cookies'],
    host_permissions: ['https://*.kinopoisk.ru/*', 'https://query.wikidata.org/*'],
  },
  webExt: {
    // Keeps the profile of the dev browser (cookies, settings) between runs.
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
  },
})
