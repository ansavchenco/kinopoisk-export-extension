import type { LucideIcon } from 'lucide-solid'
import { Check, Circle, Clock, Eye, LoaderCircle, Star, TriangleAlert, X } from 'lucide-solid'
import type { JSX } from 'solid-js'
import { createSignal, For, onMount, Show } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Dynamic } from 'solid-js/web'
import { fetchUserId } from '@/utils/kinopoisk'
import type { ExportResult, Step } from './library'
import { exportLibrary } from './library'

type View = 'ready' | 'running' | 'done' | 'error'
type StepState = 'pending' | 'active' | 'done' | 'failed'

const VIEW_TEXT: Record<View, { heading: string; lead: string }> = {
  ready: {
    heading: 'Kinopoisk export',
    lead: 'Saves your library to a JSON file. Takes a few minutes.',
  },
  running: { heading: 'Exporting…', lead: 'Keep this panel open.' },
  done: { heading: 'Export saved', lead: 'kinopoisk-library.json is in your downloads.' },
  error: { heading: 'Export stopped', lead: '' },
}

const STEPS: { step: Step; label: string }[] = [
  { step: 'watched', label: 'Watched titles' },
  { step: 'ratings', label: 'Ratings' },
  { step: 'watchlist', label: 'Watch later' },
  { step: 'tmdb', label: 'TMDB IDs' },
]

/** The missing titles that the done view shows before "Show more". */
const MISSING_PREVIEW_COUNT = 5

const ROW = 'flex items-center gap-2 border-t border-neutral-200 py-2 dark:border-neutral-700'
const MUTED = 'text-neutral-500 dark:text-neutral-400'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function download(json: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  link.download = 'kinopoisk-library.json'
  link.click()
  URL.revokeObjectURL(link.href)
}

const STATE_ICONS: Record<StepState, LucideIcon> = {
  pending: Circle,
  active: LoaderCircle,
  done: Check,
  failed: X,
}
const STATE_COLORS: Record<StepState, string> = {
  pending: '',
  active: 'animate-spin text-blue-600 dark:text-blue-400',
  done: 'text-green-600 dark:text-green-400',
  failed: 'text-red-700 dark:text-red-300',
}

function StateIcon(props: { state: StepState; failedIcon?: LucideIcon; class?: string }) {
  const icon = () =>
    props.state === 'failed' && props.failedIcon ? props.failedIcon : STATE_ICONS[props.state]
  return (
    <Dynamic
      component={icon()}
      class={`size-4.5 shrink-0 ${STATE_COLORS[props.state]} ${props.class ?? ''}`}
    />
  )
}

function Button(props: {
  primary?: boolean
  disabled?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <button
      class="cursor-pointer rounded-lg border px-3 py-2 disabled:cursor-default disabled:opacity-40"
      classList={{
        'border-neutral-900 bg-neutral-900 text-white enabled:hover:border-neutral-700 enabled:hover:bg-neutral-700 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 dark:enabled:hover:border-neutral-300 dark:enabled:hover:bg-neutral-300':
          props.primary,
        'border-neutral-200 enabled:hover:bg-neutral-100 dark:border-neutral-700 dark:enabled:hover:bg-neutral-800':
          !props.primary,
      }}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  )
}

/** Shows the text with each "kinopoisk.ru" in it as a link to the site. */
function LinkKinopoisk(props: { text: string }) {
  return (
    <For each={props.text.split('kinopoisk.ru')}>
      {(part, index) => (
        <>
          <Show when={index() > 0}>
            <a
              href="https://www.kinopoisk.ru/"
              target="_blank"
              class="font-medium underline underline-offset-2 hover:no-underline"
            >
              kinopoisk.ru
            </a>
          </Show>
          {part}
        </>
      )}
    </For>
  )
}

/** The result of the sign-in check, in the ready view. */
function Account(props: {
  state: 'active' | 'done' | 'failed'
  text: string
  onCheckAgain: () => void
}) {
  const failed = () => props.state === 'failed'
  return (
    <div
      class="flex gap-2 rounded-lg px-3 py-2.5"
      classList={{
        'bg-neutral-100 dark:bg-neutral-800': !failed(),
        'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300': failed(),
      }}
    >
      <StateIcon state={props.state} failedIcon={TriangleAlert} class="mt-px" />
      <div class="flex flex-1 flex-col gap-2">
        <span>
          <Show when={failed()} fallback={props.text}>
            <LinkKinopoisk text={props.text} />
          </Show>
        </span>
        <Show when={failed()}>
          <button
            class="cursor-pointer self-end rounded-md border border-red-200 bg-white px-2.5 py-1 font-medium hover:bg-red-100 dark:border-red-800 dark:bg-red-900 dark:hover:bg-red-800"
            onClick={() => props.onCheckAgain()}
          >
            Check again
          </button>
        </Show>
      </div>
    </div>
  )
}

/** Why the export stopped, in the error view. */
function ErrorBox(props: { text: string }) {
  return (
    <p class="flex gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-red-700 dark:bg-red-950 dark:text-red-300">
      <TriangleAlert class="mt-px size-4.5 shrink-0" />
      {props.text}
    </p>
  )
}

function Stat(props: { count: number; label: string }) {
  return (
    <div class="flex-1 rounded-lg bg-neutral-100 px-2.5 py-2 dark:bg-neutral-800">
      <b class="block text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {props.count}
      </b>
      {props.label}
    </div>
  )
}

function MissingTitles(props: { titles: ExportResult['missing'] }) {
  const [showAll, setShowAll] = createSignal(false)
  const shown = () => (showAll() ? props.titles : props.titles.slice(0, MISSING_PREVIEW_COUNT))
  const hiddenCount = () => props.titles.length - shown().length

  return (
    <Show when={props.titles.length > 0}>
      <section>
        <p class="mb-1 text-amber-700 dark:text-amber-400">
          Could not find TMDB ID for {props.titles.length}{' '}
          {props.titles.length === 1 ? 'title' : 'titles'}
        </p>
        <ul>
          <For each={shown()}>
            {(title) => (
              <li class={ROW}>
                <span>{title.originalTitle ?? title.title}</span>
                <span class={`ml-auto tabular-nums ${MUTED}`}>{title.year ?? ''}</span>
              </li>
            )}
          </For>
        </ul>
        <Show when={hiddenCount() > 0}>
          <button
            class={`cursor-pointer py-2 ${MUTED} hover:text-neutral-900 dark:hover:text-neutral-100`}
            onClick={() => setShowAll(true)}
          >
            Show {hiddenCount()} more
          </button>
        </Show>
      </section>
    </Show>
  )
}

export function App() {
  const [view, setView] = createSignal<View>('ready')
  const [account, setAccount] = createSignal({
    state: 'active' as 'active' | 'done' | 'failed',
    text: '',
  })
  const [steps, setSteps] = createStore<Record<Step, { state: StepState; count: string }>>({
    watched: { state: 'pending', count: '' },
    ratings: { state: 'pending', count: '' },
    watchlist: { state: 'pending', count: '' },
    tmdb: { state: 'pending', count: '' },
  })
  const [error, setError] = createSignal('')
  const [result, setResult] = createSignal<ExportResult>()

  let userId: string | null = null
  let abortController = new AbortController()
  /** The file of the last export, for "Download again". */
  let libraryJson = ''

  async function checkAccount() {
    setAccount({ state: 'active', text: 'Checking that you are signed in…' })
    try {
      // Not `abortController`: Cancel aborts it, and the user can check again after that.
      userId = await fetchUserId(new AbortController().signal)
      setAccount({ state: 'done', text: 'Signed in on kinopoisk.ru' })
    } catch (error) {
      setAccount({ state: 'failed', text: errorMessage(error) })
    }
  }

  async function start() {
    abortController = new AbortController()
    const { signal } = abortController
    for (const { step } of STEPS) setSteps(step, { state: 'pending', count: '' })
    let activeStep: Step = 'watched'
    setView('running')

    try {
      const exported = await exportLibrary(
        userId,
        (step, state, count = '') => {
          activeStep = step
          setSteps(step, { state, count })
        },
        signal
      )
      libraryJson = JSON.stringify(exported.library, null, 2)
      download(libraryJson)
      setResult(exported)
      setView('done')
    } catch (error) {
      if (signal.aborted) return
      // The saved ID is of no use if the user has signed out.
      userId = null
      setSteps(activeStep, 'state', 'failed')
      setError(errorMessage(error))
      setView('error')
    }
  }

  function cancel() {
    abortController.abort()
    setView('ready')
  }

  onMount(checkAccount)

  return (
    <main class="flex min-h-screen flex-col gap-3 p-4">
      <h1 class="text-lg font-semibold">{VIEW_TEXT[view()].heading}</h1>
      <Show when={VIEW_TEXT[view()].lead}>
        <p class={MUTED}>{VIEW_TEXT[view()].lead}</p>
      </Show>

      <Show when={view() === 'ready'}>
        <Account state={account().state} text={account().text} onCheckAgain={checkAccount} />
        <ul>
          <li class={ROW}>
            <Star class="size-4.5 shrink-0" />
            Ratings
          </li>
          <li class={ROW}>
            <Eye class="size-4.5 shrink-0" />
            Watched titles
          </li>
          <li class={ROW}>
            <Clock class="size-4.5 shrink-0" />
            Watch later
          </li>
        </ul>
      </Show>

      <Show when={view() === 'error'}>
        <ErrorBox text={error()} />
      </Show>

      <Show when={view() === 'running' || view() === 'error'}>
        <ul>
          <For each={STEPS}>
            {({ step, label }) => (
              <li class={ROW} classList={{ [MUTED]: steps[step].state === 'pending' }}>
                <StateIcon state={steps[step].state} />
                {label}
                <span class={`ml-auto tabular-nums ${MUTED}`}>{steps[step].count}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={view() === 'done' && result()}>
        {(done) => (
          <>
            <div class={`flex gap-2 text-xs ${MUTED}`}>
              <Stat count={done().library.ratings.length} label="Ratings" />
              <Stat count={done().library.seen.length} label="Seen" />
              <Stat count={done().library.watchlist.length} label="Watch later" />
            </div>
            <MissingTitles titles={done().missing} />
          </>
        )}
      </Show>

      <footer class="mt-auto flex flex-col gap-2">
        <Show when={view() === 'ready'}>
          <Button primary disabled={account().state !== 'done'} onClick={start}>
            Export library
          </Button>
        </Show>
        <Show when={view() === 'running'}>
          <Button onClick={cancel}>Cancel</Button>
        </Show>
        <Show when={view() === 'done'}>
          <Button primary onClick={() => download(libraryJson)}>
            Download again
          </Button>
          <Button onClick={() => setView('ready')}>Start over</Button>
        </Show>
        <Show when={view() === 'error'}>
          <Button onClick={() => browser.tabs.create({ url: 'https://www.kinopoisk.ru/' })}>
            Open kinopoisk.ru
          </Button>
          <Button primary onClick={start}>
            Try again
          </Button>
        </Show>
      </footer>
    </main>
  )
}
