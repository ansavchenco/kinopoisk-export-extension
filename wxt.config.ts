import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Kinopoisk export',
    permissions: ['cookies'],
    host_permissions: ['https://*.kinopoisk.ru/*', 'https://query.wikidata.org/*'],
  },
  webExt: {
    // Keeps the profile of the dev browser (cookies, settings) between runs.
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
  },
})
