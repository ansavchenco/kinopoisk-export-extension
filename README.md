# Kinopoisk export

A browser extension that saves your Kinopoisk library to a JSON file. Kinopoisk has no export of its own, so the extension reads the same pages you see when signed in.

I built it for the Kinopoisk import in [Foyerr](https://foyerr.app). The source is public so you can check what it does before you run it on your account.

## What it exports

| Key         | Kinopoisk page          | Has                  |
| ----------- | ----------------------- | -------------------- |
| `ratings`   | Оценки                  | Your rating, 1 to 10 |
| `seen`      | Просмотры               | Watched, not rated   |
| `watchlist` | The Буду смотреть list  | Date added           |
| `favorites` | The Любимые фильмы list | Date added           |

Every title looks like this.

```json
{
  "kinopoiskId": "258687",
  "type": "film",
  "title": "Интерстеллар",
  "originalTitle": "Interstellar",
  "year": 2014,
  "date": "2022-02-21T17:55",
  "rating": 9,
  "tmdbId": "157336",
  "tmdbIdMatchedBy": "kinopoiskId"
}
```

`date` is the time shown on the page, with no time zone. Only `ratings` has `rating`.

## What it sends and where

The extension talks to two hosts.

| Host                 | Request                                                        |
| -------------------- | -------------------------------------------------------------- |
| `kinopoisk.ru`       | Your list pages, with your session cookies                     |
| `query.wikidata.org` | Kinopoisk IDs, and titles with years for the IDs it can't find |

Nothing goes to [Foyerr](https://foyerr.app) or to me. The file is built in the side panel and saved through the browser's download.

The `sidePanel` permission lets the extension show its UI in the browser's side panel. A popup closes when you click outside it, and that would stop the export.

Requests to Kinopoisk go one at a time with a 1.5 second pause. If Kinopoisk shows a captcha, the export stops and tells you to solve it.

## TMDB IDs

Wikidata is the only source. The lookup has two steps.

1. By Kinopoisk ID.
2. By title, for the rest. A title gets an ID only if exactly one Wikidata item has the same English name, a TMDB ID of the same type, no Kinopoisk ID, and the same year. A year that is one off passes if the Russian names match too.

Step 2 can pick another title with the same name and year. `tmdbIdMatchedBy` is `title` for those, so search the file for it and check them. It is `null` when nothing matched.

## Install

It is not in the Chrome Web Store. Build it and load it yourself.

```bash
pnpm install
```

```bash
pnpm build
```

Open `chrome://extensions`, turn on developer mode, click "Load unpacked" and pick `.output/chrome-mv3`. Sign in on kinopoisk.ru, click the extension's icon and click "Export library" in the side panel.

`pnpm build:firefox` builds for Firefox. I haven't tested that one, and the icon click doesn't open the sidebar there.

## Development

`pnpm dev` opens a browser with the extension loaded. The profile is kept in `.wxt/chrome-data`, so you stay signed in between runs.

| Path                        | Is                                     |
| --------------------------- | -------------------------------------- |
| `entrypoints/sidepanel`     | The side panel, plain TypeScript       |
| `entrypoints/background.ts` | Opens the side panel on an icon click  |
| `utils/kinopoisk`           | Fetches and parses the Kinopoisk pages |
| `utils/wikidata`            | Looks up TMDB IDs with SPARQL          |

`pnpm compile` typechecks.

## When it breaks

The parsers depend on Kinopoisk's old profile pages. If a page comes back in a shape the extension doesn't expect, the export stops and the side panel says which check failed.

## Known gaps

- The watch later and favorites folders write "Dog Stars, The". The extension moves a trailing "The", "A" or "An" to the front. Articles in other languages stay where Kinopoisk put them.
- A title with no year on Kinopoisk never gets a TMDB ID from step 2.
- Custom folders are not exported.
