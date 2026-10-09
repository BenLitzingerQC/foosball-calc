// Compares the JS port against reference values generated directly with the
// FoosballEloRankingSystem from Quantco/elo-slackbot.
// Run: pixi run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyMatch,
  findBestSingleMatch,
  matchDeltas,
  predScore,
  simulateSeries,
  teamRating,
} from "../assets/elo.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/reference.json"), "utf8"));

const TOLERANCE = 1e-9;

test("reference values from the Python original", () => {
  for (const [i, fixture] of fixtures.entries()) {
    const ratings = new Map(fixture.players.map(([pid, r]) => [pid, r]));
    const nGames = new Map(fixture.players.map(([pid, , n]) => [pid, n]));

    for (const [g, [idsA, idsB, scoreA, scoreB]] of fixture.games.entries()) {
      const toTeam = (ids) =>
        ids.map((pid) => ({ id: pid, rating: ratings.get(pid), nGames: nGames.get(pid) }));

      const step = applyMatch(toTeam(idsA), toTeam(idsB), scoreA, scoreB);
      const expected = fixture.expected.per_game[g];

      for (const [team, deltas] of [
        [step.teamA, step.deltasA],
        [step.teamB, step.deltasB],
      ]) {
        team.forEach((p, k) => {
          assert.ok(
            Math.abs(deltas[k] - expected[p.id]) < TOLERANCE,
            `Fixture ${i}, game ${g}, ${p.id}: ${deltas[k]} != ${expected[p.id]}`,
          );
          ratings.set(p.id, p.rating);
          nGames.set(p.id, p.nGames);
        });
      }
    }

    for (const [pid, rating] of Object.entries(fixture.expected.final)) {
      assert.ok(
        Math.abs(ratings.get(pid) - rating) < TOLERANCE,
        `Fixture ${i}, final rating ${pid}: ${ratings.get(pid)} != ${rating}`,
      );
    }
    for (const [pid, n] of Object.entries(fixture.expected.n_games)) {
      assert.ok(
        Math.abs(nGames.get(pid) - n) < TOLERANCE,
        `Fixture ${i}, match count ${pid}: ${nGames.get(pid)} != ${n}`,
      );
    }
  }
});

test("teamRating is dominated by the stronger player", () => {
  // The logarithmic mean sits above the arithmetic one.
  assert.ok(teamRating([1000, 1500]) > 1250);
  assert.equal(teamRating([1100, 1100]), 1100);
});

test("expectations are symmetric and calibrated", () => {
  assert.ok(Math.abs(predScore([1000], [1000]) - 0.5) < 1e-12);
  const a = predScore([1200], [1000]);
  const b = predScore([1000], [1200]);
  assert.ok(Math.abs(a + b - 1) < 1e-12);
  // a 500 Elo gap == ten times as strong == 10/11 of the points expected
  assert.ok(Math.abs(predScore([1500], [1000]) - 10 / 11) < 1e-12);
});

test("participation bonus: a draw at equal Elo gives both +0.5", () => {
  const team = (n) => [{ rating: 1000, nGames: n }];
  const { deltasA, deltasB } = matchDeltas(team(20), team(20), 5, 5);
  assert.ok(Math.abs(deltasA[0] - 0.5) < 1e-12);
  assert.ok(Math.abs(deltasB[0] - 0.5) < 1e-12);
});

test("the placement period only damps established players", () => {
  const established = { rating: 1000, nGames: 20 };
  const rookie = { rating: 1000, nGames: 1 }; // placementFactor = 1/5
  const { deltasA, deltasB, rawDelta, placementFactor } = matchDeltas(
    [established],
    [rookie],
    10,
    0,
  );
  assert.equal(placementFactor, 0.2);
  assert.ok(Math.abs(deltasA[0] - (0.5 + rawDelta * 0.2)) < 1e-12);
  assert.ok(Math.abs(deltasB[0] - (0.5 - rawDelta)) < 1e-12);
});

test("invalid input is rejected", () => {
  const p = [{ rating: 1000, nGames: 10 }];
  assert.throws(() => matchDeltas(p, p, 0, 0), /total score/);
  assert.throws(() => matchDeltas([], p, 10, 0), /at least one player/);
});

test("findBestSingleMatch recovers a single game exactly", () => {
  const teamA = [
    { rating: 1050, nGames: 15 },
    { rating: 980, nGames: 22 },
  ];
  const teamB = [
    { rating: 1010, nGames: 9 },
    { rating: 1120, nGames: 31 },
  ];
  // A single game as a "series" -> the search has to find exactly that score.
  const series = simulateSeries(teamA, teamB, [{ scoreA: 10, scoreB: 7 }]);
  const [best] = findBestSingleMatch(teamA, teamB, series.cumulativeA, series.cumulativeB, {
    maxPoints: 10,
    mode: "winnerExact",
  });
  assert.equal(best.scoreA, 10);
  assert.equal(best.scoreB, 7);
  assert.ok(best.rmse < 1e-12);
});

test("findBestSingleMatch respects the search space", () => {
  const team = [{ rating: 1000, nGames: 10 }];
  const other = [{ rating: 1000, nGames: 10 }];
  const target = [0];

  const exact = findBestSingleMatch(team, other, target, target, {
    maxPoints: 10,
    mode: "winnerExact",
    topN: 999,
  });
  assert.ok(exact.every((c) => Math.max(c.scoreA, c.scoreB) === 10 && c.scoreA !== c.scoreB));

  const any = findBestSingleMatch(team, other, target, target, {
    maxPoints: 10,
    mode: "any",
    topN: 999,
  });
  // 11*11 pairs minus (0,0)
  assert.equal(any.length, 120);
  // At identical Elo the draw is the closest approximation to 0.
  assert.equal(any[0].scoreA, any[0].scoreB);
});

test("series: sum of the single deltas == cumulative change", () => {
  const teamA = [
    { rating: 1200, nGames: 3 },
    { rating: 900, nGames: 40 },
  ];
  const teamB = [
    { rating: 1000, nGames: 12 },
    { rating: 1100, nGames: 7 },
  ];
  const games = [
    { scoreA: 10, scoreB: 8 },
    { scoreA: 5, scoreB: 10 },
    { scoreA: 10, scoreB: 1 },
  ];
  const series = simulateSeries(teamA, teamB, games);

  teamA.forEach((_, i) => {
    const summed = series.perGame.reduce((s, step) => s + step.deltasA[i], 0);
    assert.ok(Math.abs(summed - series.cumulativeA[i]) < 1e-9);
  });
  // Match counts: three 2v2 games -> +1.5 per player
  assert.ok(Math.abs(series.finalA[0].nGames - (3 + 1.5)) < 1e-12);
});
