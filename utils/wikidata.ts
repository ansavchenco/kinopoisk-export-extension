import type { KinopoiskTitle } from './kinopoisk'

export type TmdbIds = {
  movie?: string
  tv?: string
  /** `true` when the ID is from the lookup by title, which can match another title of the same name. */
  matchedByTitle?: boolean
}

type Row = Record<string, { value: string } | undefined>

const BATCH_SIZE = 200

// P2603 is the Kinopoisk ID, P4947 the TMDB movie ID, P4983 the TMDB series ID.
async function runQuery(query: string): Promise<Row[]> {
  const response = await fetch('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: { Accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query }),
  })
  if (!response.ok) throw new Error(`Wikidata returned ${response.status}.`)

  const json: { results: { bindings: Row[] } } = await response.json()
  return json.results.bindings
}

/**
 * Looks up the TMDB IDs of Kinopoisk IDs in Wikidata. A Kinopoisk ID that
 * Wikidata does not have is not in the returned map.
 */
export async function fetchTmdbIds(kinopoiskIds: string[]): Promise<Map<string, TmdbIds>> {
  const result = new Map<string, TmdbIds>()

  for (let start = 0; start < kinopoiskIds.length; start += BATCH_SIZE) {
    const values = kinopoiskIds
      .slice(start, start + BATCH_SIZE)
      .map((id) => `"${id}"`)
      .join(' ')
    const rows = await runQuery(`SELECT ?kp ?movie ?tv WHERE {
      VALUES ?kp { ${values} }
      ?item wdt:P2603 ?kp .
      OPTIONAL { ?item wdt:P4947 ?movie }
      OPTIONAL { ?item wdt:P4983 ?tv }
    }`)

    for (const row of rows) {
      const kinopoiskId = row.kp!.value
      const ids = result.get(kinopoiskId) ?? {}
      if (row.movie) ids.movie = row.movie.value
      if (row.tv) ids.tv = row.tv.value
      result.set(kinopoiskId, ids)
    }
  }

  return result
}

/** Lets "Ёлки" and "елки" compare as the same title. */
function normalizeRussianTitle(title: string) {
  return title.trim().toLowerCase().replaceAll('ё', 'е')
}

/**
 * Looks up the TMDB IDs of titles that Wikidata does not have a Kinopoisk ID
 * for. A title gets an ID only when exactly one Wikidata item passes all of this:
 * - its English label or alias is the original title from Kinopoisk;
 * - it has a TMDB ID of the same type and no Kinopoisk ID of another title;
 * - it has the same year, or the same Russian title and a year at most one off.
 */
export async function fetchTmdbIdsByTitle(titles: KinopoiskTitle[]): Promise<Map<string, TmdbIds>> {
  const result = new Map<string, TmdbIds>()
  const titlesWithYear = titles.filter((title) => title.year != null)

  for (let start = 0; start < titlesWithYear.length; start += BATCH_SIZE) {
    const batch = titlesWithYear.slice(start, start + BATCH_SIZE)
    const values = batch
      .map((title) => {
        // Kinopoisk shows no original title for a Russian title.
        const label = JSON.stringify(title.originalTitle ?? title.title)
        const language = title.originalTitle == null ? 'ru' : 'en'
        return `(${label} ${label}@${language}) (${label} ${label}@mul)`
      })
      .join(' ')
    // P577 is the publication date of a film, P580 the start date of a series.
    const rows = await runQuery(`SELECT ?name ?item ?movie ?tv ?kp ?date ?russianLabel WHERE {
      VALUES (?name ?label) { ${values} }
      VALUES ?labelOrAlias { rdfs:label skos:altLabel }
      ?item ?labelOrAlias ?label .
      OPTIONAL { ?item wdt:P4947 ?movie }
      OPTIONAL { ?item wdt:P4983 ?tv }
      FILTER(BOUND(?movie) || BOUND(?tv))
      OPTIONAL { ?item wdt:P2603 ?kp }
      OPTIONAL { ?item wdt:P577|wdt:P580 ?date }
      OPTIONAL { ?item rdfs:label ?russianLabel FILTER(LANG(?russianLabel) = "ru") }
    }`)

    for (const title of batch) {
      const matches = new Map<string, string>()
      for (const row of rows) {
        const tmdbId = title.type === 'series' ? row.tv?.value : row.movie?.value
        if (row.name!.value !== (title.originalTitle ?? title.title)) continue
        if (tmdbId == null || row.kp != null || row.date == null) continue

        const yearsOff = Math.abs(Number(row.date.value.slice(0, 4)) - title.year!)
        const hasSameRussianTitle =
          title.originalTitle != null &&
          row.russianLabel != null &&
          normalizeRussianTitle(row.russianLabel.value) === normalizeRussianTitle(title.title)
        if (yearsOff === 0 || (yearsOff === 1 && hasSameRussianTitle)) {
          matches.set(row.item!.value, tmdbId)
        }
      }
      if (matches.size !== 1) continue

      const [tmdbId] = matches.values()
      result.set(
        title.kinopoiskId,
        title.type === 'series'
          ? { tv: tmdbId, matchedByTitle: true }
          : { movie: tmdbId, matchedByTitle: true }
      )
    }
  }

  return result
}
