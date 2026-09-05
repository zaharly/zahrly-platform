from __future__ import annotations

from workers.prediction_engine import rolling_prediction_cycle as cycle


def main() -> None:
    # GitHub Actions owns scheduling. The runtime must not attempt to mutate
    # Supabase cron metadata because the Session Pooler role cannot edit cron.job.
    cycle.disable_legacy_crons = lambda conn: None
    cycle.main()


if __name__ == "__main__":
    main()
