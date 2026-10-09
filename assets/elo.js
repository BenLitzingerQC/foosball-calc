// Portierung der Elo-Logik aus Quantco/elo-slackbot
// (elo_slackbot/ranking/foosball_ranking_system.py, FoosballEloRankingSystem).
// Reine Funktionen, keine DOM-Abhängigkeit -- damit auch unter node testbar.

/** Konstanten aus foosball_ranking_system.py. */
export const DEFAULT_CONFIG = Object.freeze({
  // FREE_ELO_GAIN -- Teilnahme-Bonus, den jeder Spieler pro Spiel geschenkt bekommt
  freeRatingGain: 0.5,
  // ELO_GAIN_COEF -- globaler Multiplikator der Rating-Änderung
  ratingGainCoef: 10,
  // INITIAL_ELO -- Startwertung neuer Spieler
  initialRating: 1000,
  // PLACEMENT_MATCHES -- Spiele bis die Wertung als stabil gilt
  placementMatches: 5,
  // EXPONENT_ELO_DIFF -- diese Elo-Differenz bedeutet "10x so stark"
  exponentEloDiff: 500,
});

/**
 * Reduzierte Wertung eines Teams: logarithmisches Mittel, dominiert vom
 * stärksten Spieler.
 */
export function teamRating(ratings, cfg = DEFAULT_CONFIG) {
  const d = cfg.exponentEloDiff;
  const mean = ratings.reduce((s, r) => s + 10 ** (r / d), 0) / ratings.length;
  return d * Math.log10(mean);
}

/** Sigmoid zur Umrechnung einer Rating-Differenz in eine erwartete Punktquote. */
export function scoreSigmoid(x, cfg = DEFAULT_CONFIG) {
  return 1 / (1 + 10 ** (x / cfg.exponentEloDiff));
}

/** Erwartete Punktquote von Team A gegen Team B. */
export function predScore(ratingsA, ratingsB, cfg = DEFAULT_CONFIG) {
  return scoreSigmoid(teamRating(ratingsB, cfg) - teamRating(ratingsA, cfg), cfg);
}

/**
 * Elo-Änderung aller Beteiligten für ein einzelnes Spiel.
 *
 * Teams sind Arrays von `{ rating, nGames }`. Gibt die Deltas sowie die
 * Zwischengrössen zurück, die die UI anzeigt.
 */
export function matchDeltas(teamA, teamB, scoreA, scoreB, cfg = DEFAULT_CONFIG) {
  if (teamA.length === 0 || teamB.length === 0) {
    throw new Error("Beide Teams brauchen mindestens einen Spieler.");
  }
  const totalPoints = scoreA + scoreB;
  if (!(totalPoints > 0)) {
    throw new Error("Die Gesamtpunktzahl muss grösser als 0 sein.");
  }

  // Spielt jemand noch Platzierungsspiele, werden die Deltas aller etablierten
  // Spieler gedämpft (gegen Elo-Farming an Neulingen).
  let placementFactor = 1;
  for (const p of [...teamA, ...teamB]) {
    if (p.nGames < cfg.placementMatches) {
      placementFactor = Math.min(placementFactor, p.nGames / cfg.placementMatches);
    }
  }

  const expected = predScore(
    teamA.map((p) => p.rating),
    teamB.map((p) => p.rating),
    cfg,
  );
  const actual = scoreA / totalPoints;
  const rawDelta = cfg.ratingGainCoef * totalPoints * (actual - expected);

  const deltasFor = (team, sign) =>
    team.map((p) => {
      let delta = (sign * rawDelta) / team.length;
      if (p.nGames >= cfg.placementMatches) delta *= placementFactor;
      return cfg.freeRatingGain + delta;
    });

  return {
    deltasA: deltasFor(teamA, 1),
    deltasB: deltasFor(teamB, -1),
    expected,
    actual,
    rawDelta,
    placementFactor,
    teamRatingA: teamRating(teamA.map((p) => p.rating), cfg),
    teamRatingB: teamRating(teamB.map((p) => p.rating), cfg),
  };
}

/** Wendet ein Spiel an und gibt die neuen Teamzustände zurück (nicht mutierend). */
export function applyMatch(teamA, teamB, scoreA, scoreB, cfg = DEFAULT_CONFIG) {
  const result = matchDeltas(teamA, teamB, scoreA, scoreB, cfg);
  const advance = (team, deltas) =>
    team.map((p, i) => ({
      ...p,
      rating: p.rating + deltas[i],
      // update_n_games(team_weight) -- ein Spiel zählt 1/Teamgrösse
      nGames: p.nGames + 1 / team.length,
    }));
  return {
    ...result,
    teamA: advance(teamA, result.deltasA),
    teamB: advance(teamB, result.deltasB),
  };
}

/**
 * Spielt eine Serie `games = [{ scoreA, scoreB }, ...]` nacheinander durch.
 *
 * Die Reihenfolge ist relevant: Wertungen und Spielzähler wandern von Spiel zu
 * Spiel weiter, genau wie der Bot es täte.
 */
export function simulateSeries(teamA, teamB, games, cfg = DEFAULT_CONFIG) {
  let currentA = teamA;
  let currentB = teamB;
  const perGame = [];

  for (const game of games) {
    const step = applyMatch(currentA, currentB, game.scoreA, game.scoreB, cfg);
    perGame.push(step);
    currentA = step.teamA;
    currentB = step.teamB;
  }

  return {
    perGame,
    finalA: currentA,
    finalB: currentB,
    cumulativeA: currentA.map((p, i) => p.rating - teamA[i].rating),
    cumulativeB: currentB.map((p, i) => p.rating - teamB[i].rating),
  };
}

/** Kandidaten-Ergebnisse (x, y) für die Suche. */
function* candidateScores({ maxPoints, mode }) {
  for (let x = 0; x <= maxPoints; x++) {
    for (let y = 0; y <= maxPoints; y++) {
      if (x + y === 0) continue;
      if (mode === "winnerExact") {
        if (x === y) continue;
        if (Math.max(x, y) !== maxPoints) continue;
      }
      yield [x, y];
    }
  }
}

/**
 * Sucht das Einzelergebnis, dessen Deltas den Zielwerten am nächsten kommen.
 *
 * `targetA` / `targetB` sind die gewünschten Elo-Änderungen pro Spieler --
 * typischerweise die Summe aus `simulateSeries`. Bewertet wird der RMSE über
 * alle Spieler; `mode` schränkt den Suchraum ein:
 *   "any"         -- alle Ergebnisse 0..maxPoints
 *   "winnerExact" -- Sieger hat genau maxPoints Punkte
 */
export function findBestSingleMatch(
  teamA,
  teamB,
  targetA,
  targetB,
  { maxPoints = 10, mode = "winnerExact", topN = 5 } = {},
  cfg = DEFAULT_CONFIG,
) {
  const nPlayers = teamA.length + teamB.length;
  const candidates = [];

  for (const [scoreA, scoreB] of candidateScores({ maxPoints, mode })) {
    const result = matchDeltas(teamA, teamB, scoreA, scoreB, cfg);
    const diffs = [
      ...result.deltasA.map((d, i) => d - targetA[i]),
      ...result.deltasB.map((d, i) => d - targetB[i]),
    ];
    const rmse = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / nPlayers);
    const maxAbs = diffs.reduce((m, d) => Math.max(m, Math.abs(d)), 0);
    candidates.push({ scoreA, scoreB, rmse, maxAbs, diffs, ...result });
  }

  if (candidates.length === 0) {
    throw new Error("Kein Ergebnis im gewählten Suchraum.");
  }

  candidates.sort((a, b) => a.rmse - b.rmse || a.scoreA + a.scoreB - (b.scoreA + b.scoreB));
  return candidates.slice(0, topN);
}
