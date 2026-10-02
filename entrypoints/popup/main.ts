import type { KinopoiskTitle } from '@/utils/kinopoisk'
import {
  fetchList,
  fetchUserId,
  fetchVotesList,
  parseFolderPage,
  UnexpectedPageError,
} from '@/utils/kinopoisk'
import type { TmdbIds } from '@/utils/wikidata'
import { fetchTmdbIds, fetchTmdbIdsByTitle } from '@/utils/wikidata'
import './style.css'

const exportButton = document.querySelector<HTMLButtonElement>('#export')!
const statusText = document.querySelector<HTMLParagraphElement>('#status')!

function setStatus(status: string) {
  statusText.textContent = status
}

/**
 * Adds the TMDB ID to a title. `tmdbId` is `null` when Wikidata does not have
 * it. `tmdbIdMatchedBy` is how Wikidata found it: `kinopoiskId` or `title`.
 */
function withTmdbId<T extends KinopoiskTitle>(item: T, tmdbIds: Map<string, TmdbIds>) {
  const ids = tmdbIds.get(item.kinopoiskId)
  let type = item.type
  let tmdbId = type === 'series' ? ids?.tv : ids?.movie
  // Wikidata has the title only as the other type, so we use that type.
  if (tmdbId == null && ids?.movie != null) {
    type = 'film'
    tmdbId = ids.movie
  }
  if (tmdbId == null && ids?.tv != null) {
    type = 'series'
    tmdbId = ids.tv
  }
  let tmdbIdMatchedBy: 'kinopoiskId' | 'title' | null = null
  if (tmdbId != null) {
    tmdbIdMatchedBy = ids?.matchedByTitle ? 'title' : 'kinopoiskId'
  }
  return { ...item, type, tmdbId: tmdbId ?? null, tmdbIdMatchedBy }
}

function downloadFile(name: string, content: string, type: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}

async function exportLibrary() {
  exportButton.disabled = true
  try {
    setStatus('Checking that you are signed in…')
    const userId = await fetchUserId()

    const watched = await fetchVotesList(userId, 'novote', (itemCount, total) =>
      setStatus(`Reading watched titles… ${itemCount} of ${total}`)
    )
    const rated = await fetchVotesList(userId, 'vote', (itemCount, total) =>
      setStatus(`Reading ratings… ${itemCount} of ${total}`)
    )
    const watchlist = await fetchList(
      (page) => `https://www.kinopoisk.ru/mykp/folders/3575/?vector=desc&limit=200&page=${page}`,
      parseFolderPage,
      (itemCount, total) => setStatus(`Reading the watch later folder… ${itemCount} of ${total}`)
    )

    const titles = new Map(
      [...rated, ...watched, ...watchlist].map((item) => [item.kinopoiskId, item])
    )
    setStatus(`Looking up TMDB IDs of ${titles.size} titles…`)
    const tmdbIds = await fetchTmdbIds([...titles.keys()])

    const titlesWithoutTmdbId = [...titles.values()].filter((item) => {
      const ids = tmdbIds.get(item.kinopoiskId)
      return ids?.movie == null && ids?.tv == null
    })
    setStatus(`Looking up ${titlesWithoutTmdbId.length} titles by name…`)
    for (const [kinopoiskId, ids] of await fetchTmdbIdsByTitle(titlesWithoutTmdbId)) {
      tmdbIds.set(kinopoiskId, ids)
    }

    // The list of watched titles also has the rated titles, with no rating shown.
    const ratedIds = new Set(rated.map((item) => item.kinopoiskId))
    const library = {
      ratings: rated.map((item) => withTmdbId(item, tmdbIds)),
      seen: watched
        .filter((item) => !ratedIds.has(item.kinopoiskId))
        .map(({ rating, ...item }) => withTmdbId(item, tmdbIds)),
      watchlist: watchlist.map((item) => withTmdbId(item, tmdbIds)),
    }

    downloadFile('kinopoisk-library.json', JSON.stringify(library, null, 2), 'application/json')

    const withoutTmdbId = [...titles.keys()].filter((id) => {
      const ids = tmdbIds.get(id)
      return ids?.movie == null && ids?.tv == null
    }).length
    setStatus(
      `Exported ${library.ratings.length} ratings, ${library.seen.length} seen titles and ${library.watchlist.length} watch later titles. ${withoutTmdbId} titles have no TMDB ID.`
    )
  } catch (error) {
    if (error instanceof UnexpectedPageError) {
      downloadFile('kinopoisk-unexpected-page.html', error.html, 'text/html')
      setStatus(`${error.message} The page is saved as kinopoisk-unexpected-page.html.`)
    } else {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }
  exportButton.disabled = false
}

exportButton.addEventListener('click', exportLibrary)
