import type { IconNode } from 'lucide'
import {
  Check,
  Circle,
  Clock,
  createElement,
  Eye,
  LoaderCircle,
  Star,
  TriangleAlert,
  X,
} from 'lucide'
import type { KinopoiskTitle } from '@/utils/kinopoisk'
import { fetchList, fetchUserId, fetchVotesList, parseFolderPage } from '@/utils/kinopoisk'
import type { TmdbIds } from '@/utils/wikidata'
import { fetchTmdbIds, fetchTmdbIdsByTitle } from '@/utils/wikidata'
import './style.css'

type View = 'ready' | 'running' | 'done' | 'error'
type Step = 'watched' | 'ratings' | 'watchlist' | 'tmdb'
type StepState = 'pending' | 'active' | 'done' | 'failed'

const STEP_ICONS: Record<StepState, IconNode> = {
  pending: Circle,
  active: LoaderCircle,
  done: Check,
  failed: X,
}
/** The icons of the `data-icon` elements of the page. */
const PAGE_ICONS: Record<string, IconNode> = {
  star: Star,
  eye: Eye,
  clock: Clock,
}

/** The missing titles that the done view shows before "Show more". */
const MISSING_PREVIEW_COUNT = 5

const main = document.querySelector('main')!
const heading = document.querySelector('#heading')!
const lead = document.querySelector('#lead')!
const errorText = document.querySelector('#error')!
const account = document.querySelector<HTMLElement>('#account')!
const exportButton = document.querySelector<HTMLButtonElement>('#export')!
const missing = document.querySelector<HTMLElement>('#missing')!
const missingHeading = document.querySelector('#missing-heading')!
const missingList = document.querySelector('#missing-list')!
const showMissingButton = document.querySelector<HTMLButtonElement>('#show-missing')!

let userId: string | null = null
let abortController = new AbortController()
/** The file of the last export, for "Download again". */
let libraryJson = ''

function setView(view: View, headingText: string, leadText: string) {
  main.dataset.view = view
  heading.textContent = headingText
  lead.textContent = leadText
}

function showReady() {
  setView('ready', 'Kinopoisk export', 'Saves your library to a JSON file. Takes a few minutes.')
}

function setStep(step: Step, state: StepState, count = '') {
  const row = document.querySelector<HTMLElement>(`[data-step="${step}"]`)!
  row.dataset.state = state
  row.querySelector('[data-mark]')!.replaceChildren(createElement(STEP_ICONS[state]))
  row.querySelector('[data-count]')!.textContent = count
}

/** Shows the result of the sign-in check in the callout of the ready view. */
function setAccount(state: 'active' | 'done' | 'failed', text: string) {
  const icon = state === 'failed' ? TriangleAlert : STEP_ICONS[state]
  account.dataset.state = state
  account.querySelector('[data-mark]')!.replaceChildren(createElement(icon))
  account.querySelector('#account-text')!.textContent = text
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

function downloadLibrary() {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([libraryJson], { type: 'application/json' }))
  link.download = 'kinopoisk-library.json'
  link.click()
  URL.revokeObjectURL(link.href)
}

/** Lists the titles that have no TMDB ID in the done view. */
function showMissingTitles(titles: KinopoiskTitle[]) {
  missing.hidden = titles.length === 0
  missingHeading.textContent =
    titles.length === 1
      ? 'Could not find TMDB ID for 1 title'
      : `Could not find TMDB ID for ${titles.length} titles`

  missingList.replaceChildren(
    ...titles.map((title, index) => {
      const name = document.createElement('span')
      name.textContent = title.originalTitle ?? title.title
      const year = document.createElement('span')
      year.className = 'ml-auto tabular-nums text-neutral-500 dark:text-neutral-400'
      year.textContent = title.year == null ? '' : String(title.year)

      const row = document.createElement('li')
      row.className =
        'flex items-center gap-2 border-t border-neutral-200 py-2 dark:border-neutral-700'
      row.hidden = index >= MISSING_PREVIEW_COUNT
      row.append(name, year)
      return row
    })
  )
  showMissingButton.hidden = titles.length <= MISSING_PREVIEW_COUNT
  showMissingButton.textContent = `Show ${titles.length - MISSING_PREVIEW_COUNT} more`
}

async function checkAccount() {
  setAccount('active', 'Checking that you are signed in…')
  exportButton.disabled = true
  try {
    userId = await fetchUserId(abortController.signal)
    setAccount('done', `Signed in as user ${userId}`)
  } catch (error) {
    setAccount('failed', error instanceof Error ? error.message : String(error))
  }
  // The export checks the sign-in again if this check failed.
  exportButton.disabled = false
}

async function exportLibrary() {
  abortController = new AbortController()
  const { signal } = abortController

  setView('running', 'Exporting…', 'Keep this panel open.')
  const steps: Step[] = ['watched', 'ratings', 'watchlist', 'tmdb']
  for (const step of steps) setStep(step, 'pending')
  let activeStep: Step = 'watched'

  /** Starts a step and returns the function that shows its progress. */
  function startStep(step: Step) {
    activeStep = step
    setStep(step, 'active')
    return (itemCount: number, total: number) => setStep(step, 'active', `${itemCount} of ${total}`)
  }

  try {
    const onWatchedProgress = startStep('watched')
    userId ??= await fetchUserId(signal)
    const watched = await fetchVotesList(userId, 'novote', onWatchedProgress, signal)
    setStep('watched', 'done', String(watched.length))

    const rated = await fetchVotesList(userId, 'vote', startStep('ratings'), signal)
    setStep('ratings', 'done', String(rated.length))

    const watchlist = await fetchList(
      (page) => `https://www.kinopoisk.ru/mykp/folders/3575/?vector=desc&limit=200&page=${page}`,
      parseFolderPage,
      startStep('watchlist'),
      signal
    )
    setStep('watchlist', 'done', String(watchlist.length))

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
    const library = {
      ratings: rated.map((item) => withTmdbId(item, tmdbIds)),
      seen: watched
        .filter((item) => !ratedIds.has(item.kinopoiskId))
        .map(({ rating, ...item }) => withTmdbId(item, tmdbIds)),
      watchlist: watchlist.map((item) => withTmdbId(item, tmdbIds)),
    }
    libraryJson = JSON.stringify(library, null, 2)
    downloadLibrary()

    document.querySelector('#ratings-count')!.textContent = String(library.ratings.length)
    document.querySelector('#seen-count')!.textContent = String(library.seen.length)
    document.querySelector('#watchlist-count')!.textContent = String(library.watchlist.length)
    showMissingTitles([...titles.values()].filter(hasNoTmdbId))
    setView('done', 'Export saved', 'kinopoisk-library.json is in your downloads.')
  } catch (error) {
    if (signal.aborted) return
    // The saved ID is of no use if the user has signed out.
    userId = null
    const row = document.querySelector(`[data-step="${activeStep}"] [data-count]`)!
    setStep(activeStep, 'failed', row.textContent ?? '')
    errorText.textContent = error instanceof Error ? error.message : String(error)
    setView('error', 'Export stopped', '')
  }
}

exportButton.addEventListener('click', exportLibrary)
document.querySelector('#retry')!.addEventListener('click', exportLibrary)
document.querySelector('#download')!.addEventListener('click', downloadLibrary)
document.querySelector('#back')!.addEventListener('click', showReady)
document.querySelector('#cancel')!.addEventListener('click', () => {
  abortController.abort()
  showReady()
})
document.querySelector('#open-kinopoisk')!.addEventListener('click', () => {
  browser.tabs.create({ url: 'https://www.kinopoisk.ru/' })
})
showMissingButton.addEventListener('click', () => {
  for (const row of missingList.children) (row as HTMLElement).hidden = false
  showMissingButton.hidden = true
})

for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  element.replaceChildren(createElement(PAGE_ICONS[element.dataset.icon!]!))
}
checkAccount()
