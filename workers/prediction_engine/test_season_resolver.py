from .season_resolver import normalize_season_label, resolve_season


def test_api_football_archive_year_resolves_to_football_season():
    resolved = resolve_season("2011", source="api-football")
    assert resolved.archive_season_key == "2011"
    assert resolved.logical_season == "2011/2012"
    assert resolved.start_year == 2011


def test_logical_season_is_preserved():
    assert normalize_season_label("2011/2012") == "2011/2012"


def test_other_api_football_years_are_adjacent_seasons():
    assert normalize_season_label("2008") == "2008/2009"
    assert normalize_season_label("2009") == "2009/2010"
    assert normalize_season_label("2010") == "2010/2011"
