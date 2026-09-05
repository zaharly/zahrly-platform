# Prediction Engine evidence gates

Drift evidence uses the database status contract (`OK`, `WARN`, `ALERT`, `UNKNOWN`); only `OK` is promotion-safe. The 1X2 canonical architecture does not define a universal numeric fold-to-fold promotion threshold, so the gate does not invent one.

Market benchmark follows the canonical priority and may use `HISTORICAL_CALIBRATED_BASE_RATE` as the last-resort fallback when trustworthy historical odds are unavailable.

A reference baseline comparison is useful for background evaluation but is not a production incumbent. Promotion therefore requires an explicitly identified production incumbent.