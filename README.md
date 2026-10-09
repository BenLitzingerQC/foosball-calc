# Elo Calculator

**→ [benlitzingerqc.github.io/foosball-calc](https://benlitzingerqc.github.io/foosball-calc/)**

Static page for recomputing the Elo ratings of the foosball Slack bot
([`Quantco/elo-slackbot`](https://github.com/Quantco/elo-slackbot)), driven by a
menu with three views:

| View | Purpose |
| --- | --- |
| **Simulate** | Enter the players' current Elo and a score, read off the Elo change per player. Any team sizes (1 v 1, 2 v 2, 1 v 2 …). |
| **Combine** | Enter several games played and search for the single score whose Elo change comes closest to all of them together. |
| **Formula** | The bot's maths and constants, typeset with MathML. |

## Running it

```bash
pixi run serve     # http://localhost:8000
pixi run test      # tests for the Elo logic
pixi run build     # dist/foosball-calc.html, everything in one file
```

Locally the page needs a server: `assets/elo.js` is loaded as an ES module, and
browsers block module imports over `file://`.

## Design

The interface follows the iOS idiom: inset grouped lists on a grey canvas, a
segmented control for navigation, system colours, switches instead of
checkboxes, and the system font stack. Light and dark appearance both come from
`prefers-color-scheme`.

The formulas are plain [MathML](https://www.w3.org/TR/mathml-core/), rendered by
the browser's own math layout engine in the default math serif face — the LaTeX
look without shipping a megabyte of KaTeX fonts, and it works offline.

## On a phone

The page is built for phone width (one layout from 320 px up, thumb-sized hit
areas, 17 px text in input fields so iOS does not zoom on focus). On narrow
screens the secondary table columns are dropped.

Hosted, the page can be launched like an app via "Add to Home Screen":
`manifest.webmanifest` supplies name and icon, `sw.js` makes it usable offline
after the first visit (stale-while-revalidate &ndash; the cached state always
appears immediately, the new version is fetched in the background and becomes
active on the next launch). Bump the `CACHE` constant in `sw.js` whenever files
change.

Without hosting there is `pixi run build`: `dist/foosball-calc.html` contains
HTML, CSS, JavaScript and the icon in a single file (~50 kB, no external
references) and can be passed around via AirDrop or a cloud folder and opened
directly. Service worker and manifest do not apply there &ndash; the file is
fully local anyway.

## Layout

```
index.html             markup, menu and the MathML formulas
assets/elo.js          Elo logic, pure functions, no DOM
assets/app.js          forms, menu, result rendering
assets/style.css       styles (light and dark, narrow breakpoint at 40 rem)
assets/icon.svg        icon, source for the PNG sizes
manifest.webmanifest   name and icons for the Home Screen
sw.js                  service worker for offline use
build.mjs              bundles everything into one HTML file
tests/elo.test.mjs     tests against reference values from the original
tests/fixtures/        reference values, produced with the real Python code
```

No runtime dependencies, no framework. Pixi only provides Python for the local
server and Node for tests and build.

## Correctness

`assets/elo.js` is a port of `FoosballEloRankingSystem` from
`elo_slackbot/ranking/foosball_ranking_system.py`. `tests/fixtures/reference.json`
holds Elo changes, final ratings and match counts generated directly with that
Python class &ndash; across six scenarios (1 v 1, 2 v 2, 1 v 2, series, placement
period). The tests compare the JS port against it at `1e-9`.

## How the bot computes

1. **Team rating** &ndash; logarithmic mean, `R = 500 · log₁₀(mean(10^(rᵢ/500)))`.
   One strong player pulls the team rating above the average.
2. **Expected point share** &ndash; `E = 1 / (1 + 10^((R_B − R_A)/500))`.
   A 500 Elo gap means "ten times as strong", so `10/11` of the points.
3. **Actual point share** &ndash; `S = points_A / (points_A + points_B)`.
   The point ratio counts, not win or loss.
4. **Raw change** &ndash; `Δ = 10 · total points · (S − E)`.
5. **Split** &ndash; `Δ / team size` per player, the losing team with the sign
   flipped, plus a `+0.5` participation bonus for everyone.
6. **Placement period** &ndash; below 5 matches a rating counts as provisional. If
   anyone is in that phase, the changes of every *established* player are damped
   by `min(matches/5)`. A 2 v 2 game counts as half a match per player.

Placement mode is off by default in the UI; then everyone counts as established.
The switch reveals a per-player field for the match count.

## On combining several games

The search looks for the score `(x : y)` whose Elo changes come closest to the
target values; the target is the summed change of all entered games, scored one
after another. Candidates are ranked by RMSE over all players, and the search
space can be narrowed to "winner has exactly N points".

An exact match is impossible: the participation bonus is paid per entry, not per
game played. Three games hand everyone `3 × 0.5 = 1.5` Elo for free, a single
entry only `0.5`. That difference of `(n − 1) · 0.5` hits every player equally
and no score can compensate for it &ndash; it is reported separately in the
result. The competitive part of the change, on the other hand, is usually matched
very closely.

## Regenerating the reference values

`tests/fixtures/reference.json` is checked in so the tests run without access to
the bot repository. Regenerating it needs a working copy of
`Quantco/elo-slackbot` and an environment with `numpy`, `pydantic` and
`sqlalchemy` (not part of this Pixi environment):

```bash
ELO_SLACKBOT_PATH=/path/to/elo-slackbot \
    python tests/fixtures/generate_reference.py > tests/fixtures/reference.json
```
