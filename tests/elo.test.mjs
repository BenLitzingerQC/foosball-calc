// Vergleicht die JS-Portierung gegen Referenzwerte, die direkt mit dem
// FoosballEloRankingSystem aus Quantco/elo-slackbot erzeugt wurden.
// Lauf: pixi run test

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

test("Referenzwerte aus dem Python-Original", () => {
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
            `Fixture ${i}, Spiel ${g}, ${p.id}: ${deltas[k]} != ${expected[p.id]}`,
          );
          ratings.set(p.id, p.rating);
          nGames.set(p.id, p.nGames);
        });
      }
    }

    for (const [pid, rating] of Object.entries(fixture.expected.final)) {
      assert.ok(
        Math.abs(ratings.get(pid) - rating) < TOLERANCE,
        `Fixture ${i}, Endwertung ${pid}: ${ratings.get(pid)} != ${rating}`,
      );
    }
    for (const [pid, n] of Object.entries(fixture.expected.n_games)) {
      assert.ok(
        Math.abs(nGames.get(pid) - n) < TOLERANCE,
        `Fixture ${i}, Spielzähler ${pid}: ${nGames.get(pid)} != ${n}`,
      );
    }
  }
});

test("teamRating wird vom stärkeren Spieler dominiert", () => {
  // Logarithmisches Mittel liegt über dem arithmetischen Mittel.
  assert.ok(teamRating([1000, 1500]) > 1250);
  assert.equal(teamRating([1100, 1100]), 1100);
});

test("Erwartungswerte sind symmetrisch und kalibriert", () => {
  assert.ok(Math.abs(predScore([1000], [1000]) - 0.5) < 1e-12);
  const a = predScore([1200], [1000]);
  const b = predScore([1000], [1200]);
  assert.ok(Math.abs(a + b - 1) < 1e-12);
  // 500 Elo Differenz == 10x so stark == 10/11 der Punkte erwartet
  assert.ok(Math.abs(predScore([1500], [1000]) - 10 / 11) < 1e-12);
});

test("Teilnahme-Bonus: ein Unentschieden bei gleicher Elo bringt beiden +0.5", () => {
  const team = (n) => [{ rating: 1000, nGames: n }];
  const { deltasA, deltasB } = matchDeltas(team(20), team(20), 5, 5);
  assert.ok(Math.abs(deltasA[0] - 0.5) < 1e-12);
  assert.ok(Math.abs(deltasB[0] - 0.5) < 1e-12);
});

test("Platzierungsphase dämpft nur die etablierten Spieler", () => {
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

test("Ungültige Eingaben werden abgewiesen", () => {
  const p = [{ rating: 1000, nGames: 10 }];
  assert.throws(() => matchDeltas(p, p, 0, 0), /Gesamtpunktzahl/);
  assert.throws(() => matchDeltas([], p, 10, 0), /mindestens einen Spieler/);
});

test("findBestSingleMatch findet ein Einzelspiel exakt zurück", () => {
  const teamA = [
    { rating: 1050, nGames: 15 },
    { rating: 980, nGames: 22 },
  ];
  const teamB = [
    { rating: 1010, nGames: 9 },
    { rating: 1120, nGames: 31 },
  ];
  // Ein einzelnes Spiel als "Serie" -> die Suche muss genau dieses Ergebnis finden.
  const series = simulateSeries(teamA, teamB, [{ scoreA: 10, scoreB: 7 }]);
  const [best] = findBestSingleMatch(teamA, teamB, series.cumulativeA, series.cumulativeB, {
    maxPoints: 10,
    mode: "winnerExact",
  });
  assert.equal(best.scoreA, 10);
  assert.equal(best.scoreB, 7);
  assert.ok(best.rmse < 1e-12);
});

test("findBestSingleMatch respektiert den Suchraum", () => {
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
  // 11*11 Paare minus (0,0)
  assert.equal(any.length, 120);
  // Bei identischer Elo ist das Unentschieden die beste Annäherung an 0.
  assert.equal(any[0].scoreA, any[0].scoreB);
});

test("Serie: Summe der Einzeldeltas == kumulierte Änderung", () => {
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
  // Spielzähler: drei 2v2-Spiele -> +1.5 pro Spieler
  assert.ok(Math.abs(series.finalA[0].nGames - (3 + 1.5)) < 1e-12);
});
