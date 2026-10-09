import {
  DEFAULT_CONFIG,
  findBestSingleMatch,
  matchDeltas,
  simulateSeries,
} from "./elo.js";

const cfg = DEFAULT_CONFIG;

// ------------------------------------------------------------------ Helfer

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const fmt = (n, digits = 2) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Vorzeichenbehaftete Elo-Änderung, z.B. "+11,75". */
const fmtDelta = (n, digits = 2) => (n >= 0 ? "+" : "−") + fmt(Math.abs(n), digits);

const signClass = (n) => (Math.abs(n) < 0.005 ? "" : n > 0 ? "gain" : "loss");

const deltaCell = (n, digits = 2) =>
  `<td class="${signClass(n)}">${fmtDelta(n, digits)}</td>`;

const pct = (n) => fmt(n * 100, 1) + " %";

// ------------------------------------------------------------------ Menü

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

// ------------------------------------------------------------------ Team-Editor

/**
 * Editierbare Spielerliste für ein Team.
 *
 * Gibt `{ read, setPlacementVisible }` zurück. `read()` liefert
 * `[{ name, rating, nGames }]` und wirft bei unbrauchbaren Eingaben.
 */
function createTeamEditor(root, { title, players }) {
  root.innerHTML = `
    <h3>${esc(title)}</h3>
    <div class="column-head">
      <span>Spieler</span>
      <span class="num">Elo</span>
      <span class="num games-col">Spiele</span>
      <span class="spacer"></span>
    </div>
    <div class="players"></div>
    <button type="button" class="ghost add">+ Spieler</button>
  `;

  const list = root.querySelector(".players");

  const addRow = ({ name = "", rating = cfg.initialRating, nGames = 25 } = {}) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <input class="p-name" type="text" placeholder="Name" value="${esc(name)}" />
      <input class="p-elo" type="number" step="0.001" value="${rating}" required />
      <input class="p-games" type="number" step="0.5" min="0" value="${nGames}" required />
      <button type="button" class="ghost remove" title="Spieler entfernen">&times;</button>
    `;
    row.querySelector(".remove").addEventListener("click", () => {
      if (list.children.length > 1) row.remove();
    });
    list.append(row);
    return row;
  };

  root.querySelector(".add").addEventListener("click", () => addRow().querySelector(".p-name").focus());
  for (const player of players) addRow(player);

  let placementVisible = false;

  const api = {
    read() {
      return [...list.children].map((row, index) => {
        const rating = row.querySelector(".p-elo").valueAsNumber;
        const nGames = row.querySelector(".p-games").valueAsNumber;
        if (!Number.isFinite(rating)) {
          throw new Error(`${title}: Spieler ${index + 1} hat keine gültige Elo.`);
        }
        if (placementVisible && (!Number.isFinite(nGames) || nGames < 0)) {
          throw new Error(`${title}: Spieler ${index + 1} hat keine gültige Spielzahl.`);
        }
        return {
          name: row.querySelector(".p-name").value.trim() || `Spieler ${index + 1}`,
          rating,
          // Ohne Platzierungsmodus gelten alle als etabliert; nur die Schwelle
          // `nGames >= placementMatches` ist für die Rechnung relevant.
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

/** Verdrahtet eine Checkbox mit den Spalten "Spiele" beider Team-Editoren. */
function bindPlacementToggle(checkbox, editors) {
  const sync = () => editors.forEach((e) => e.setPlacementVisible(checkbox.checked));
  checkbox.addEventListener("change", sync);
  sync();
}

// ------------------------------------------------------------------ Ansicht: Spiel simulieren

const simulateEditors = (() => {
  const [rootA, rootB] = document.querySelectorAll("#view-simulate .team-editor");
  return [
    createTeamEditor(rootA, {
      title: "Team A",
      players: [{ name: "", rating: 1000 }, { name: "", rating: 1000 }],
    }),
    createTeamEditor(rootB, {
      title: "Team B",
      players: [{ name: "", rating: 1000 }, { name: "", rating: 1000 }],
    }),
  ];
})();

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
      throw new Error("Bitte beide Punktzahlen eintragen.");
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
        <td>${fmt(p.rating, 1)}</td>
        ${deltaCell(deltas[i])}
        <td>${fmt(p.rating + deltas[i], 1)}</td>
      </tr>`,
    )
    .join("");
}

function renderSimulate(result, teamA, teamB, scoreA, scoreB) {
  const winner =
    scoreA === scoreB ? "Unentschieden" : scoreA > scoreB ? "Team A gewinnt" : "Team B gewinnt";

  outSimulate.innerHTML = `
    <div class="panel">
      <p class="headline">
        ${scoreA} : ${scoreB}
        <span class="sub">${winner}</span>
      </p>
      <div class="table-wrap">
        <table class="result">
          <thead>
            <tr><th>Spieler</th><th>Elo vorher</th><th>Änderung</th><th>Elo nachher</th></tr>
          </thead>
          <tbody>
            ${playerRows(teamA, result.deltasA)}
            ${playerRows(teamB, result.deltasB, true)}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Zwischenwerte</h3>
      <dl class="facts">
        <dt>Team-Wertung A</dt><dd>${fmt(result.teamRatingA, 1)}</dd>
        <dt>Team-Wertung B</dt><dd>${fmt(result.teamRatingB, 1)}</dd>
        <dt>Erwartete Punktquote A</dt><dd>${pct(result.expected)}</dd>
        <dt>Tatsächliche Punktquote A</dt><dd>${pct(result.actual)}</dd>
        <dt>Rohe Änderung</dt><dd>${fmtDelta(result.rawDelta)} Elo auf das Team A</dd>
        <dt>Teilnahme-Bonus</dt><dd>${fmtDelta(cfg.freeRatingGain)} Elo für jeden</dd>
        <dt>Platzierungsfaktor</dt><dd>${fmt(result.placementFactor, 2)}${
          result.placementFactor < 1 ? " (gedämpft, Neuling im Spiel)" : ""
        }</dd>
      </dl>
    </div>
  `;
}

// ------------------------------------------------------------------ Ansicht: Spiele zusammenfassen

const combineEditors = (() => {
  const [rootA, rootB] = document.querySelectorAll("#view-combine .team-editor");
  return [
    createTeamEditor(rootA, {
      title: "Team A",
      players: [{ name: "", rating: 1000 }, { name: "", rating: 1000 }],
    }),
    createTeamEditor(rootB, {
      title: "Team B",
      players: [{ name: "", rating: 1000 }, { name: "", rating: 1000 }],
    }),
  ];
})();

bindPlacementToggle(document.getElementById("cmb-placement"), combineEditors);

const gameList = document.getElementById("game-list");

function addGameRow(scoreA = 10, scoreB = 0) {
  const row = document.createElement("div");
  row.className = "row score-row";
  row.style.marginBottom = "0.5rem";
  row.innerHTML = `
    <span class="game-label">Spiel</span>
    <input class="g-a" type="number" min="0" step="1" value="${scoreA}" required />
    <span class="colon">:</span>
    <input class="g-b" type="number" min="0" step="1" value="${scoreB}" required />
    <button type="button" class="ghost remove" title="Spiel entfernen">&times;</button>
  `;
  row.querySelector(".remove").addEventListener("click", () => {
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
    row.querySelector(".game-label").textContent = `Spiel ${i + 1}`;
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
        throw new Error(`Spiel ${i + 1}: Bitte beide Punktzahlen eintragen.`);
      }
      if (scoreA + scoreB === 0) {
        throw new Error(`Spiel ${i + 1}: 0 : 0 ist kein Ergebnis.`);
      }
      return { scoreA, scoreB };
    });

    const maxPoints = document.getElementById("cmb-max-points").valueAsNumber;
    if (!Number.isFinite(maxPoints) || maxPoints < 1) {
      throw new Error("Die maximale Punktzahl muss mindestens 1 sein.");
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
    <div class="panel">
      <p class="headline">
        ${best.scoreA} : ${best.scoreB}
        <span class="sub">
          bestes Einzelergebnis für ${games.length} ${games.length === 1 ? "Spiel" : "Spiele"}
          &middot; mittlere Abweichung ${fmt(best.rmse)} Elo
        </span>
      </p>
      <p class="note">
        Im Bot eintragen als
        <code>!g ${esc(teamA.map((p) => "@" + p.name).join(" "))} ${best.scoreA} - ${
          best.scoreB
        } ${esc(teamB.map((p) => "@" + p.name).join(" "))}</code>
        &ndash; der Bot erwartet echte Slack-Mentions, die Namen hier sind nur Platzhalter.
      </p>
    </div>

    <div class="panel">
      <h3>Abgleich pro Spieler</h3>
      <div class="table-wrap">
        <table class="result">
          <thead>
            <tr>
              <th>Spieler</th>
              <th class="hide-sm">Elo vorher</th>
              <th>Ziel<span class="hide-sm"> (${games.length} Spiele)</span></th>
              <th>Einzelspiel</th>
              <th>Differenz</th>
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
              Von der Differenz sind <strong>${fmt(bonusGap)} Elo</strong> pro Spieler
              unvermeidbar: der Teilnahme-Bonus fällt ${games.length}× an, wenn man
              ${games.length} Spiele einträgt, aber nur 1× bei einem Eintrag. Dieser
              Betrag trifft beide Teams gleich und lässt sich über kein Ergebnis
              ausgleichen.
            </p>`
          : ""
      }
    </div>

    <div class="panel">
      <h3>Einzelne Spiele</h3>
      <div class="table-wrap">
        <table class="result">
          <thead>
            <tr>
              <th>Spiel</th>
              <th>Ergebnis</th>
              <th>Rohe Änderung auf Team A</th>
              <th class="hide-sm">Erwartete Quote A</th>
            </tr>
          </thead>
          <tbody>
            ${series.perGame
              .map(
                (step, i) => `
              <tr>
                <td>Spiel ${i + 1}</td>
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
        Die Reihenfolge wirkt sich aus: nach jedem Spiel sind die Wertungen anders,
        also auch die Erwartung für das nächste.
      </p>
    </div>

    ${
      alternatives
        ? `<div class="panel">
            <h3>Nächstbeste Ergebnisse</h3>
            <div class="table-wrap">
              <table class="result">
                <thead>
                  <tr>
                    <th>Ergebnis</th>
                    <th>Mittlere Abweichung</th>
                    <th class="hide-sm">Grösste Abweichung</th>
                  </tr>
                </thead>
                <tbody>${alternatives}</tbody>
              </table>
            </div>
          </div>`
        : ""
    }
  `;
}

// ------------------------------------------------------------------ Ansicht: Formel

document.getElementById("constants-table").innerHTML = `
  <thead><tr><th>Konstante</th><th>Wert</th><th>Bedeutung</th></tr></thead>
  <tbody>
    <tr><td><code>FREE_ELO_GAIN</code></td><td>${fmt(cfg.freeRatingGain, 1)}</td>
        <td>Bonus pro Eintrag, für jeden Beteiligten</td></tr>
    <tr><td><code>ELO_GAIN_COEF</code></td><td>${cfg.ratingGainCoef}</td>
        <td>globaler Multiplikator der Änderung</td></tr>
    <tr><td><code>INITIAL_ELO</code></td><td>${cfg.initialRating}</td>
        <td>Startwertung neuer Spieler</td></tr>
    <tr><td><code>PLACEMENT_MATCHES</code></td><td>${cfg.placementMatches}</td>
        <td>Spiele bis die Wertung als stabil gilt</td></tr>
    <tr><td><code>EXPONENT_ELO_DIFF</code></td><td>${cfg.exponentEloDiff}</td>
        <td>Elo-Differenz für &bdquo;zehnmal so stark&ldquo;</td></tr>
  </tbody>
`;

// ------------------------------------------------------------------ Start

showView(location.hash.slice(1) || "simulate");

// Offline-Betrieb und Home-Bildschirm-Start. Nur über https bzw. localhost
// erlaubt -- als gebündelte Einzeldatei über file:// greift der Zweig nicht.
if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" || location.hostname === "localhost")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* Offline-Betrieb ist eine Zugabe, kein Muss. */
    });
  });
}
