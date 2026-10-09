"""Erzeugt reference.json mit dem echten FoosballEloRankingSystem.

Braucht eine Arbeitskopie von Quantco/elo-slackbot und eine Umgebung mit numpy,
pydantic und sqlalchemy:

    ELO_SLACKBOT_PATH=/pfad/zu/elo-slackbot \
        python tests/fixtures/generate_reference.py > tests/fixtures/reference.json
"""

import datetime
import json
import os
import sys

sys.path.insert(0, os.environ.get("ELO_SLACKBOT_PATH", "../elo-slackbot"))

from elo_slackbot.database.models import (  # noqa: E402
    Match,
    RankedPlayer,
    TeamPerformanceAggregated,
)
from elo_slackbot.ranking.foosball_ranking_system import (  # noqa: E402
    FoosballEloRankingSystem,
)

TS = datetime.datetime(2026, 1, 1)


def make_player(pid, rating, n_games):
    return RankedPlayer(
        name=pid, player_id=pid, slack_user_id=pid, rating=rating, n_games=n_games
    )


def run(spec):
    players = {
        pid: make_player(pid, rating, n_games)
        for pid, rating, n_games in spec["players"]
    }
    rs = FoosballEloRankingSystem(players=players)
    out = []
    for team_a, team_b, score_a, score_b in spec["games"]:
        match = Match(
            match_id="m",
            when=TS,
            team_performances=[
                TeamPerformanceAggregated(
                    match_id="m", tp_id="a", players=team_a,
                    result=score_a, game_timestamp=TS,
                ),
                TeamPerformanceAggregated(
                    match_id="m", tp_id="b", players=team_b,
                    result=score_b, game_timestamp=TS,
                ),
            ],
        )
        deltas = rs.player_rating_changes(match)
        out.append({pid: deltas[pid] for pid in [*team_a, *team_b]})
        rs.score_match(match)
    return {
        "per_game": out,
        "final": {pid: p.rating for pid, p in rs.players.items()},
        "n_games": {pid: p.n_games for pid, p in rs.players.items()},
    }


SPECS = [
    # 2v2, alle etabliert, klarer Sieg
    {
        "players": [("a1", 1000, 20), ("a2", 1200, 30), ("b1", 1100, 12), ("b2", 950, 8)],
        "games": [(["a1", "a2"], ["b1", "b2"], 10, 3)],
    },
    # 1v1, grosse Elo-Differenz, Favorit verliert
    {
        "players": [("a1", 1400, 50), ("b1", 900, 40)],
        "games": [(["a1"], ["b1"], 4, 10)],
    },
    # Serie aus drei Spielen, gleiche Teams -> Reihenfolge wirkt
    {
        "players": [("a1", 1050, 15), ("a2", 980, 22), ("b1", 1010, 9), ("b2", 1120, 31)],
        "games": [
            (["a1", "a2"], ["b1", "b2"], 10, 8),
            (["a1", "a2"], ["b1", "b2"], 6, 10),
            (["a1", "a2"], ["b1", "b2"], 10, 0),
        ],
    },
    # Platzierungsphase: b2 hat erst 2 Spiele -> placement_factor 0.4
    {
        "players": [("a1", 1000, 20), ("a2", 1000, 20), ("b1", 1000, 20), ("b2", 1000, 2)],
        "games": [(["a1", "a2"], ["b1", "b2"], 10, 5)],
    },
    # Unterschiedliche Teamgrössen 1v2
    {
        "players": [("a1", 1300, 40), ("b1", 1000, 10), ("b2", 1050, 11)],
        "games": [(["a1"], ["b1", "b2"], 10, 9)],
    },
    # Platzierungsphase mit Serie: n_games wächst um 1/Teamgrösse pro Spiel
    {
        "players": [("a1", 1000, 0), ("a2", 1000, 20), ("b1", 1000, 20), ("b2", 1000, 20)],
        "games": [
            (["a1", "a2"], ["b1", "b2"], 10, 2),
            (["a1", "a2"], ["b1", "b2"], 10, 2),
            (["a1", "a2"], ["b1", "b2"], 10, 2),
        ],
    },
]

if __name__ == "__main__":
    fixtures = [
        {"players": s["players"], "games": s["games"], "expected": run(s)} for s in SPECS
    ]
    print(json.dumps(fixtures, indent=2))
