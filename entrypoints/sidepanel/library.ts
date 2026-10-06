import type { KinopoiskTitle } from '@/utils/kinopoisk'
import { fetchList, fetchUserId, fetchVotesList, parseFolderPage } from '@/utils/kinopoisk'
import type { TmdbIds } from '@/utils/wikidata'
import { fetchTmdbIds, fetchTmdbIdsByTitle } from '@/utils/wikidata'

export type Step = 'watched' | 'ratings' | 'watchlist' | 'tmdb'

/**
 * Tells the side panel how the export goes. `count` is "12 of 558" while a
 * step runs and the number of titles when it is done.
 */
export type OnStep = (step: Step, state: 'active' | 'done', count?: string) => void

export interface ExportResult {
  library: {
    ratings: unknown[]
    seen: unknown[]
    watchlist: unknown[]
  }
  /** The titles that have no TMDB ID. */
  missing: KinopoiskTitle[]
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

/** Fetches the library of the user from Kinopoisk and the TMDB IDs from Wikidata. */
export async function exportLibrary(
  userId: string | null,
  onStep: OnStep,
  signal: AbortSignal
): Promise<ExportResult> {
  /** Starts a step and returns the function that shows its progress. */
  function startStep(step: Step) {
    onStep(step, 'active')
    return (itemCount: number, total: number) => onStep(step, 'active', `${itemCount} of ${total}`)
  }

  const onWatchedProgress = startStep('watched')
  userId ??= await fetchUserId(signal)
  const watched = await fetchVotesList(userId, 'novote', onWatchedProgress, signal)
  onStep('watched', 'done', String(watched.length))

  const rated = await fetchVotesList(userId, 'vote', startStep('ratings'), signal)
  onStep('ratings', 'done', String(rated.length))

  const watchlist = await fetchList(
    (page) => `https://www.kinopoisk.ru/mykp/folders/3575/?limit=50&page=${page}`,
    parseFolderPage,
    startStep('watchlist'),
    signal
  )
  onStep('watchlist', 'done', String(watchlist.length))

  startStep('tmdb')
  const titles = new Map(
    [...rated, ...watched, ...watchlist].map((item) => [item.kinopoiskId, item])
  )
  const tmdbIds = await fetchTmdbIds([...titles.keys()], signal)

  const hasNoTmdbId = (item: KinopoiskTitle) => {
    const ids = tmdbIds.get(item.kinopoiskId)
    return ids?.movie == null && ids?.tv == null
  }
  const titlesToLookUpByName = [...titles.values()].filter(hasNoTmdbId)
  for (const [kinopoiskId, ids] of await fetchTmdbIdsByTitle(titlesToLookUpByName, signal)) {
    tmdbIds.set(kinopoiskId, ids)
  }

  // The list of watched titles also has the rated titles, with no rating shown.
  const ratedIds = new Set(rated.map((item) => item.kinopoiskId))
  return {
    library: {
      ratings: rated.map((item) => withTmdbId(item, tmdbIds)),
      seen: watched
        .filter((item) => !ratedIds.has(item.kinopoiskId))
        .map(({ rating, ...item }) => withTmdbId(item, tmdbIds)),
      watchlist: watchlist.map((item) => withTmdbId(item, tmdbIds)),
    },
    missing: [...titles.values()].filter(hasNoTmdbId),
  }
}
