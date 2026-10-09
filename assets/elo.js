// Port of the Elo logic from Quantco/elo-slackbot
// (elo_slackbot/ranking/foosball_ranking_system.py, FoosballEloRankingSystem).
// Pure functions, no DOM dependency -- so it is testable under node too.

/** Constants from foosball_ranking_system.py. */
export const DEFAULT_CONFIG = Object.freeze({
  // FREE_ELO_GAIN -- participation bonus every player collects per match
  freeRatingGain: 0.5,
  // ELO_GAIN_COEF -- global multiplier of the rating change
  ratingGainCoef: 10,
  // INITIAL_ELO -- starting rating of a new player
  initialRating: 1000,
  // PLACEMENT_MATCHES -- matches until a rating counts as stable
  placementMatches: 5,
  // EXPONENT_ELO_DIFF -- this rating gap means "10x as strong"
  exponentEloDiff: 500,
});

/**
 * Reduced rating of a team: a logarithmic mean, dominated by the strongest
 * player.
 */
export function teamRating(ratings, cfg = DEFAULT_CONFIG) {
  const d = cfg.exponentEloDiff;
  const mean = ratings.reduce((s, r) => s + 10 ** (r / d), 0) / ratings.length;
  return d * Math.log10(mean);
}

/** Sigmoid turning a rating gap into an expected point share. */
export function scoreSigmoid(x, cfg = DEFAULT_CONFIG) {
  return 1 / (1 + 10 ** (x / cfg.exponentEloDiff));
}

/** Expected point share of team A against team B. */
export function predScore(ratingsA, ratingsB, cfg = DEFAULT_CONFIG) {
  return scoreSigmoid(teamRating(ratingsB, cfg) - teamRating(ratingsA, cfg), cfg);
}

/**
 * Elo change for everyone involved in a single match.
 *
 * Teams are arrays of `{ rating, nGames }`. Returns the deltas plus the
 * intermediate values the UI displays.
 */
export function matchDeltas(teamA, teamB, scoreA, scoreB, cfg = DEFAULT_CONFIG) {
  if (teamA.length === 0 || teamB.length === 0) {
    throw new Error("Both teams need at least one player.");
  }
  const totalPoints = scoreA + scoreB;
  if (!(totalPoints > 0)) {
    throw new Error("The total score has to be greater than 0.");
  }

  // While anyone is still playing placement matches, the deltas of every
  // established player are damped (against Elo farming off newcomers).
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

/** Applies a match and returns the new team states (non-mutating). */
export function applyMatch(teamA, teamB, scoreA, scoreB, cfg = DEFAULT_CONFIG) {
  const result = matchDeltas(teamA, teamB, scoreA, scoreB, cfg);
  const advance = (team, deltas) =>
    team.map((p, i) => ({
      ...p,
      rating: p.rating + deltas[i],
      // update_n_games(team_weight) -- one match counts as 1/team size
      nGames: p.nGames + 1 / team.length,
    }));
  return {
    ...result,
    teamA: advance(teamA, result.deltasA),
    teamB: advance(teamB, result.deltasB),
  };
}

/**
 * Plays a series `games = [{ scoreA, scoreB }, ...]` one after another.
 *
 * Order matters: ratings and match counts carry over from game to game,
 * exactly as the bot would do it.
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

/** Candidate scores (x, y) for the search. */
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
 * Searches the single score whose deltas come closest to the target values.
 *
 * `targetA` / `targetB` are the wanted Elo changes per player -- typically the
 * sum from `simulateSeries`. Candidates are ranked by RMSE over all players;
 * `mode` narrows the search space:
 *   "any"         -- every score from 0..maxPoints
 *   "winnerExact" -- the winner has exactly maxPoints points
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
    throw new Error("No score inside the chosen search space.");
  }

  candidates.sort((a, b) => a.rmse - b.rmse || a.scoreA + a.scoreB - (b.scoreA + b.scoreB));
  return candidates.slice(0, topN);
}
