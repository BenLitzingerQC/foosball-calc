import {
  DEFAULT_CONFIG,
  findBestSingleMatch,
  matchDeltas,
  simulateSeries,
} from "./elo.js";

const cfg = DEFAULT_CONFIG;

// ----------------------------------------------------------------- helpers

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const fmt = (n, digits = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Signed Elo change, e.g. "+11.75". */
const fmtDelta = (n, digits = 2) => (n >= 0 ? "+" : "−") + fmt(Math.abs(n), digits);

const signClass = (n) => (Math.abs(n) < 0.005 ? "" : n > 0 ? "gain" : "loss");

const deltaCell = (n, digits = 2) =>
  `<td class="${signClass(n)}">${fmtDelta(n, digits)}</td>`;

const pct = (n) => fmt(n * 100, 1) + "%";

/** A grouped-list row with a label on the left and a value on the right. */
const factRow = (label, value) => `
  <div class="list-row">
    <span class="row-label">${label}</span>
    <span class="row-detail">${value}</span>
  </div>`;

// -------------------------------------------------------------------- menu

const menu = document.getElementById("menu");
const views = new Map(
  [...document.querySelectorAll(".view")].map((v) => [v.id.replace("view-", ""), v]),
);

function showView(name) {
  if (!views.has(name)) name = "simulate";
  for (const [key, view] of views) view.hidden = key !== name;
  for (const button of menu.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.view === name);
  }
  if (location.hash.slice(1) !== name) location.hash = name;
}

menu.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (button) showView(button.dataset.view);
});

window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

// ------------------------------------------------------------ team editor

/**
 * Editable player list for one team.
 *
 * Returns `{ read, setPlacementVisible }`. `read()` yields
 * `[{ name, rating, nGames }]` and throws on unusable input.
 */
function createTeamEditor(root, { title, short, players }) {
  root.innerHTML = `
    <div class="group-head">
      <h3 class="group-title">${esc(title)}</h3>
      <span class="group-head-trailing">Elo<span class="games-col"> &middot; Matches</span></span>
    </div>
    <div class="card">
      <div class="players"></div>
      <button type="button" class="row-add">
        <span class="row-add-glyph" aria-hidden="true"></span>Add player
      </button>
    </div>
  `;

  const list = root.querySelector(".players");

  const addRow = ({ name = "", rating = cfg.initialRating, nGames = 25 } = {}) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <input class="p-name" type="text" placeholder="Name" value="${esc(name)}" />
      <input class="p-elo" type="number" step="0.001" value="${rating}" required
             aria-label="Elo rating" />
      <input class="p-games" type="number" step="0.5" min="0" value="${nGames}" required
             aria-label="Matches played" />
      <button type="button" class="row-remove" aria-label="Remove player"></button>
    `;
    row.querySelector(".row-remove").addEventListener("click", () => {
      if (list.children.length > 1) row.remove();
    });
    list.append(row);
    return row;
  };

  root
    .querySelector(".row-add")
    .addEventListener("click", () => addRow().querySelector(".p-name").focus());
  for (const player of players) addRow(player);

  let placementVisible = false;

  const api = {
    read() {
      return [...list.children].map((row, index) => {
        const rating = row.querySelector(".p-elo").valueAsNumber;
        const nGames = row.querySelector(".p-games").valueAsNumber;
        if (!Number.isFinite(rating)) {
          throw new Error(`${title}: player ${index + 1} has no valid Elo rating.`);
        }
        if (placementVisible && (!Number.isFinite(nGames) || nGames < 0)) {
          throw new Error(`${title}: player ${index + 1} has no valid match count.`);
        }
        return {
          name: row.querySelector(".p-name").value.trim() || `${short}${index + 1}`,
          rating,
          // Without placement mode everyone counts as established; only the
          // `nGames >= placementMatches` threshold matters to the maths.
          nGames: placementVisible ? nGames : cfg.placementMatches,
        };
      });
    },
    setPlacementVisible(visible) {
      placementVisible = visible;
      root.querySelectorAll(".p-games, .games-col").forEach((node) => {
        node.style.display = visible ? "" : "none";
      });
    },
  };

  const observer = new MutationObserver(() => api.setPlacementVisible(placementVisible));
  observer.observe(list, { childList: true });

  api.setPlacementVisible(false);
  return api;
}

/** Wires a switch to the "Matches" column of both team editors. */
function bindPlacementToggle(checkbox, editors) {
  const sync = () => editors.forEach((e) => e.setPlacementVisible(checkbox.checked));
  checkbox.addEventListener("change", sync);
  sync();
}

const defaultTeams = (selector) => {
  const [rootA, rootB] = document.querySelectorAll(selector);
  return [
    createTeamEditor(rootA, {
      title: "Team A",
      short: "A",
      players: [{ name: "", rating: 1000 }, { name: "", rating: 1000 }],
    }),
    createTeamEditor(rootB, {
      title: "Team B",
      short: "B",
      players: [{ name: "", rating: 1000 }, { name: "", rating: 1000 }],
    }),
  ];
};

// ------------------------------------------------------- view: simulate

const simulateEditors = defaultTeams("#view-simulate .team-editor");

bindPlacementToggle(document.getElementById("sim-placement"), simulateEditors);

const outSimulate = document.getElementById("out-simulate");

document.getElementById("form-simulate").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const teamA = simulateEditors[0].read();
    const teamB = simulateEditors[1].read();
    const scoreA = document.getElementById("sim-score-a").valueAsNumber;
    const scoreB = document.getElementById("sim-score-b").valueAsNumber;
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
      throw new Error("Please enter both scores.");
    }
    renderSimulate(matchDeltas(teamA, teamB, scoreA, scoreB, cfg), teamA, teamB, scoreA, scoreB);
  } catch (error) {
    outSimulate.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
});

function playerRows(team, deltas, separator = false) {
  return team
    .map(
      (p, i) => `
      <tr${separator && i === 0 ? ' class="separator"' : ""}>
        <td>${esc(p.name)}</td>
        <td class="hide-sm">${fmt(p.rating, 1)}</td>
        ${deltaCell(deltas[i])}
        <td>${fmt(p.rating + deltas[i], 1)}</td>
      </tr>`,
    )
    .join("");
}

function renderSimulate(result, teamA, teamB, scoreA, scoreB) {
  const winner =
    scoreA === scoreB ? "Draw" : scoreA > scoreB ? "Team A wins" : "Team B wins";

  outSimulate.innerHTML = `
    <div class="group">
      <div class="card card-pad">
        <p class="headline">
          ${scoreA} : ${scoreB}
          <span class="sub">${winner}</span>
        </p>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Elo change</h2>
      <div class="card">
        <div class="table-wrap">
          <table class="result">
            <thead>
              <tr>
                <th>Player</th>
                <th class="hide-sm">Before</th>
                <th>Change</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              ${playerRows(teamA, result.deltasA)}
              ${playerRows(teamB, result.deltasB, true)}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Intermediate values</h2>
      <div class="card">
        ${factRow("Team rating A", fmt(result.teamRatingA, 1))}
        ${factRow("Team rating B", fmt(result.teamRatingB, 1))}
        ${factRow("Expected point share A", pct(result.expected))}
        ${factRow("Actual point share A", pct(result.actual))}
        ${factRow("Raw change", `${fmtDelta(result.rawDelta)} to team A`)}
        ${factRow("Participation bonus", `${fmtDelta(cfg.freeRatingGain)} for everyone`)}
        ${factRow(
          "Placement factor",
          fmt(result.placementFactor, 2) +
            (result.placementFactor < 1 ? " (damped, newcomer in the match)" : ""),
        )}
      </div>
    </div>
  `;
}

// -------------------------------------------------------- view: combine

const combineEditors = defaultTeams("#view-combine .team-editor");

bindPlacementToggle(document.getElementById("cmb-placement"), combineEditors);

const gameList = document.getElementById("game-list");

function addGameRow(scoreA = 10, scoreB = 0) {
  const row = document.createElement("div");
  row.className = "score-row";
  row.innerHTML = `
    <span class="game-label">Game</span>
    <input class="g-a" type="number" min="0" step="1" value="${scoreA}" required
           aria-label="Points team A" />
    <span class="colon">:</span>
    <input class="g-b" type="number" min="0" step="1" value="${scoreB}" required
           aria-label="Points team B" />
    <button type="button" class="row-remove" aria-label="Remove game"></button>
  `;
  row.querySelector(".row-remove").addEventListener("click", () => {
    if (gameList.children.length > 1) {
      row.remove();
      renumberGames();
    }
  });
  gameList.append(row);
  renumberGames();
  return row;
}

function renumberGames() {
  [...gameList.children].forEach((row, i) => {
    row.querySelector(".game-label").textContent = `Game ${i + 1}`;
  });
}

document.getElementById("add-game").addEventListener("click", () => addGameRow(10, 0));

addGameRow(10, 7);
addGameRow(4, 10);
addGameRow(10, 2);

const outCombine = document.getElementById("out-combine");

document.getElementById("form-combine").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const teamA = combineEditors[0].read();
    const teamB = combineEditors[1].read();

    const games = [...gameList.children].map((row, i) => {
      const scoreA = row.querySelector(".g-a").valueAsNumber;
      const scoreB = row.querySelector(".g-b").valueAsNumber;
      if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
        throw new Error(`Game ${i + 1}: please enter both scores.`);
      }
      if (scoreA + scoreB === 0) {
        throw new Error(`Game ${i + 1}: 0 : 0 is not a result.`);
      }
      return { scoreA, scoreB };
    });

    const maxPoints = document.getElementById("cmb-max-points").valueAsNumber;
    if (!Number.isFinite(maxPoints) || maxPoints < 1) {
      throw new Error("The maximum score has to be at least 1.");
    }
    const mode = document.getElementById("cmb-mode").value;

    const series = simulateSeries(teamA, teamB, games, cfg);
    const candidates = findBestSingleMatch(
      teamA,
      teamB,
      series.cumulativeA,
      series.cumulativeB,
      { maxPoints, mode, topN: 5 },
      cfg,
    );

    renderCombine({ teamA, teamB, games, series, candidates });
  } catch (error) {
    outCombine.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
});

function renderCombine({ teamA, teamB, games, series, candidates }) {
  const best = candidates[0];
  const bonusGap = (games.length - 1) * cfg.freeRatingGain;

  const comparisonRows = (team, targets, deltas, separator) =>
    team
      .map(
        (p, i) => `
      <tr${separator && i === 0 ? ' class="separator"' : ""}>
        <td>${esc(p.name)}</td>
        <td class="hide-sm">${fmt(p.rating, 1)}</td>
        ${deltaCell(targets[i])}
        ${deltaCell(deltas[i])}
        ${deltaCell(deltas[i] - targets[i])}
      </tr>`,
      )
      .join("");

  const alternatives = candidates
    .slice(1)
    .map(
      (c) => `
      <tr>
        <td>${c.scoreA} : ${c.scoreB}</td>
        <td>${fmt(c.rmse)}</td>
        <td class="hide-sm">${fmt(c.maxAbs)}</td>
      </tr>`,
    )
    .join("");

  outCombine.innerHTML = `
    <div class="group">
      <div class="card">
        <div class="card-pad">
          <p class="headline">
            ${best.scoreA} : ${best.scoreB}
            <span class="sub">
              best single score for ${games.length}
              ${games.length === 1 ? "game" : "games"}
              &middot; average deviation ${fmt(best.rmse)} Elo
            </span>
          </p>
        </div>
        <p class="note">
          Enter it in the bot as
          <code>!g ${esc(teamA.map((p) => "@" + p.name).join(" "))} ${best.scoreA} - ${
            best.scoreB
          } ${esc(teamB.map((p) => "@" + p.name).join(" "))}</code>
          &ndash; the bot expects real Slack mentions, the names here are only
          placeholders.
        </p>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Per player</h2>
      <div class="card">
        <div class="table-wrap">
          <table class="result">
            <thead>
              <tr>
                <th>Player</th>
                <th class="hide-sm">Before</th>
                <th>Target</th>
                <th>Single game</th>
                <th>Diff</th>
              </tr>
            </thead>
            <tbody>
              ${comparisonRows(teamA, series.cumulativeA, best.deltasA, false)}
              ${comparisonRows(teamB, series.cumulativeB, best.deltasB, true)}
            </tbody>
          </table>
        </div>
        ${
          games.length > 1
            ? `<p class="note">
                <strong>${fmt(bonusGap)} Elo</strong> per player of that difference is
                unavoidable: the participation bonus is paid ${games.length} times when
                you enter ${games.length} games, but only once for a single entry. It
                hits both teams equally and no score can compensate for it.
              </p>`
            : ""
        }
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Individual games</h2>
      <div class="card">
        <div class="table-wrap">
          <table class="result">
            <thead>
              <tr>
                <th>Game</th>
                <th>Score</th>
                <th>Raw change to team A</th>
                <th class="hide-sm">Expected share A</th>
              </tr>
            </thead>
            <tbody>
              ${series.perGame
                .map(
                  (step, i) => `
                <tr>
                  <td>Game ${i + 1}</td>
                  <td>${games[i].scoreA} : ${games[i].scoreB}</td>
                  ${deltaCell(step.rawDelta)}
                  <td class="hide-sm">${pct(step.expected)}</td>
                </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <p class="note">
          Order matters: after every game the ratings differ, and so does the
          expectation for the next one.
        </p>
      </div>
    </div>

    ${
      alternatives
        ? `<div class="group">
            <h2 class="group-title">Runners-up</h2>
            <div class="card">
              <div class="table-wrap">
                <table class="result">
                  <thead>
                    <tr>
                      <th>Score</th>
                      <th>Average deviation</th>
                      <th class="hide-sm">Largest deviation</th>
                    </tr>
                  </thead>
                  <tbody>${alternatives}</tbody>
                </table>
              </div>
            </div>
          </div>`
        : ""
    }
  `;
}

// -------------------------------------------------------- view: formula

document.getElementById("constants-list").innerHTML = [
  ["FREE_ELO_GAIN", fmt(cfg.freeRatingGain, 1), "bonus per entry, for everyone involved"],
  ["ELO_GAIN_COEF", cfg.ratingGainCoef, "global multiplier of the change"],
  ["INITIAL_ELO", cfg.initialRating, "starting rating of a new player"],
  ["PLACEMENT_MATCHES", cfg.placementMatches, "matches until a rating counts as stable"],
  ["EXPONENT_ELO_DIFF", cfg.exponentEloDiff, "rating gap for &ldquo;ten times as strong&rdquo;"],
]
  .map(
    ([name, value, meaning]) => `
    <div class="list-row column">
      <span class="row-label"><code>${name}</code> = ${value}</span>
      <span class="row-detail">${meaning}</span>
    </div>`,
  )
  .join("");

// ------------------------------------------------------------------ start

showView(location.hash.slice(1) || "simulate");

// Offline use and Home Screen launch. Only allowed over https or localhost --
// as a bundled single file over file:// this branch never runs.
if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" || location.hostname === "localhost")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* Offline support is a bonus, not a requirement. */
    });
  });
}
