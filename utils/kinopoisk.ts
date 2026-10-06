export type KinopoiskTitle = {
  kinopoiskId: string
  type: 'film' | 'series'
  title: string
  originalTitle: string | null
  year: number | null
  /**
   * When the title was rated, marked as watched or added to the folder. It is
   * the date and time from the page, with no time zone: `2026-10-02T20:38`.
   */
  date: string | null
}

export type RatedKinopoiskTitle = KinopoiskTitle & {
  /** 1–10. `null` for a title that is marked as watched with no rating. */
  rating: number | null
}

type ParsedPage<T> = {
  items: T[]
  /** The number of titles in the whole list, from the "1—50 из 558" text. */
  total: number
}

/** `vote` is the list of ratings ("оценки"), `novote` the list of watched titles ("просмотры"). */
type VotesList = 'vote' | 'novote'

const REQUEST_DELAY_MS = 1500

/** Parses one page of a Kinopoisk folder, like "Буду смотреть". */
export function parseFolderPage(html: string): ParsedPage<KinopoiskTitle> {
  const page = new DOMParser().parseFromString(html, 'text/html')

  const items: KinopoiskTitle[] = []
  for (const li of page.querySelectorAll<HTMLElement>('#itemList > li.item')) {
    const link = li.querySelector('.info a.name')
    const kinopoiskId = li.dataset.id
    if (link == null || kinopoiskId == null) continue

    // "Yön lapsi (2025) 90 мин.", "From (2022-...) 52 мин." or a title with no year
    const originalLine = link.nextElementSibling?.textContent?.trim() ?? ''
    const withYear = /^(.*?)\s*\((\d{4})/.exec(originalLine)
    const originalTitle = cleanFolderTitle(withYear?.[1] ?? originalLine)

    items.push({
      kinopoiskId,
      type: link.getAttribute('href')?.startsWith('/series/') ? 'series' : 'film',
      title: cleanFolderTitle(link.textContent?.trim() ?? ''),
      originalTitle: originalTitle === '' ? null : originalTitle,
      year: withYear ? Number(withYear[2]) : null,
      date: parseDate(li.querySelector(':scope > span')?.textContent),
    })
  }
  return { items, total: parseTotal(page, items.length) }
}

/**
 * Parses one page of the list of ratings or of the list of watched titles.
 * `list` is the list that the "оценки / просмотры" select of the page shows.
 * Returns `null` when the page has no table of titles.
 */
export function parseVotesPage(
  html: string
): (ParsedPage<RatedKinopoiskTitle> & { list: string | null }) | null {
  const page = new DOMParser().parseFromString(html, 'text/html')
  if (page.querySelector('.profileFilmsList') == null) return null

  // The rating is not in the markup of the row. A script of the page draws it
  // from `ur_data.push({ film: 6782779, rating: '8', ... })`. The rating is '0'
  // for all the rows of the list of watched titles.
  const ratings = new Map<string, number>()
  const ratingPattern =
    /['"]?film['"]?\s*:\s*['"]?(\d+)['"]?\s*,\s*['"]?rating['"]?\s*:\s*['"]?(\d+)/g
  for (const match of html.matchAll(ratingPattern)) {
    ratings.set(match[1]!, Number(match[2]))
  }

  const items: RatedKinopoiskTitle[] = []
  for (const row of page.querySelectorAll('.profileFilmsList > .item')) {
    const link = row.querySelector('.nameRus a')
    const href = /^\/(film|series)\/(\d+)\//.exec(link?.getAttribute('href') ?? '')
    if (link == null || href == null) continue

    // "Орудия (2025)" or "У меня очень плохое предчувствие (мини-сериал, 2026)"
    const titleLine = (link.textContent ?? '').replace(/\s+/g, ' ').trim()
    const withYear = /^(.*) \(([^()]*)\)$/.exec(titleLine)
    const year = /\d{4}/.exec(withYear?.[2] ?? '')

    const originalTitle = (row.querySelector('.nameEng')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    const rating = ratings.get(href[2]!) ?? Number(row.querySelector('.myVote')?.textContent)

    items.push({
      kinopoiskId: href[2]!,
      type: href[1] === 'series' ? 'series' : 'film',
      title: withYear?.[1] ?? titleLine,
      originalTitle: originalTitle === '' ? null : originalTitle,
      year: year ? Number(year[0]) : null,
      date: parseDate(row.querySelector('.date')?.textContent),
      rating: rating != null && rating >= 1 && rating <= 10 ? rating : null,
    })
  }
  return {
    items,
    total: parseTotal(page, items.length),
    list: page.querySelector<HTMLSelectElement>('#sb_vs')?.value ?? null,
  }
}

/**
 * The folder page shows "Dog Stars, The" for "The Dog Stars" and
 * "Извне (сериал)" for "Извне".
 */
function cleanFolderTitle(title: string) {
  return title.replace(/ \((сериал|мини-сериал)\)$/, '').replace(/^(.*), (The|A|An)$/, '$2 $1')
}

/** Turns "02.10.2026, 20:38" into "2026-10-02T20:38". */
function parseDate(text: string | null | undefined) {
  const date = /(\d{2})\.(\d{2})\.(\d{4}), (\d{2}):(\d{2})/.exec(text ?? '')
  return date ? `${date[3]}-${date[2]}-${date[1]}T${date[4]}:${date[5]}` : null
}

/** Reads 558 from "1—50 из 558". A list of one page has no such text. */
function parseTotal(page: Document, itemCount: number) {
  const text = page.querySelector('.pagesFromTo')?.textContent ?? ''
  const total = /из([\d\s]+)/.exec(text)?.[1]?.replace(/\s/g, '')
  return total ? Number(total) : itemCount
}

async function fetchHtml(url: string, signal: AbortSignal) {
  let response: Response
  try {
    response = await fetch(url, { credentials: 'include', signal })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error('Could not reach kinopoisk.ru. Check your connection, then try again.')
  }
  // Kinopoisk sends a user who is signed out to Yandex to sign in.
  if (new URL(response.url).hostname.endsWith('passport.yandex.ru')) {
    throw new Error('Open kinopoisk.ru and sign in, then try again.')
  }
  if (!response.ok) {
    throw new Error(`Kinopoisk returned error ${response.status}. Try again later.`)
  }
  if (response.url.includes('showcaptcha')) {
    throw new Error('Kinopoisk shows a captcha. Open kinopoisk.ru, solve it, then try again.')
  }
  const html = await response.text()
  await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS))
  signal.throwIfAborted()
  return html
}

/**
 * Returns the ID of the signed-in user. It is in the links of the folder page.
 * `fetchHtml` finds out if the user is signed out, so a page with no such link
 * means that Kinopoisk has changed the page.
 */
export async function fetchUserId(signal: AbortSignal) {
  const html = await fetchHtml('https://www.kinopoisk.ru/mykp/folders/3575/?limit=10', signal)
  const page = new DOMParser().parseFromString(html, 'text/html')
  const href = page.querySelector('a[href^="/user/"]')?.getAttribute('href') ?? ''
  const userId = /^\/user\/(\d+)\//.exec(href)?.[1]
  if (userId == null) {
    throw new Error(
      'Could not find your account on the Kinopoisk page. The extension needs an update.'
    )
  }
  return userId
}

/** Fetches the pages of a list one by one until it has all the titles. */
export async function fetchList<T extends KinopoiskTitle>(
  urlOfPage: (page: number) => string,
  parsePage: (html: string) => ParsedPage<T>,
  onProgress: (itemCount: number, total: number) => void,
  signal: AbortSignal
): Promise<T[]> {
  const items: T[] = []
  const ids = new Set<string>()

  for (let page = 1; ; page++) {
    const parsed = parsePage(await fetchHtml(urlOfPage(page), signal))

    let newItemCount = 0
    for (const item of parsed.items) {
      if (ids.has(item.kinopoiskId)) continue
      ids.add(item.kinopoiskId)
      items.push(item)
      newItemCount++
    }
    onProgress(items.length, parsed.total)

    // A page with no new titles stops the loop if the total on the page is wrong.
    if (items.length >= parsed.total || newItemCount === 0) return items
  }
}

/** Fetches the list of ratings or the list of watched titles of a user. */
export async function fetchVotesList(
  userId: string,
  list: VotesList,
  onProgress: (itemCount: number, total: number) => void,
  signal: AbortSignal
) {
  return fetchList(
    // 200 titles a page, the largest page size the site offers.
    (page) =>
      `https://www.kinopoisk.ru/user/${userId}/votes/list/vs/${list}/perpage/200/page/${page}/`,
    (html) => {
      const parsed = parseVotesPage(html)
      if (parsed == null) {
        throw new Error(`The "${list}" page has no table of titles.`)
      }
      if (parsed.list != null && parsed.list !== list) {
        throw new Error(`Kinopoisk returned the "${parsed.list}" list for the "${list}" list.`)
      }
      if (list === 'vote' && parsed.items.some((item) => item.rating == null)) {
        throw new Error('The ratings page has titles with no rating.')
      }
      return parsed
    },
    onProgress,
    signal
  )
}
