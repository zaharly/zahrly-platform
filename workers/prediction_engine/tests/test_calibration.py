from workers.prediction_engine.calibration import apply_temperature, fit_temperature


def test_temperature_preserves_argmax_and_normalizes():
    p = (0.60, 0.25, 0.15)
    q = apply_temperature(p, 0.80)
    assert abs(sum(q) - 1.0) < 1e-12
    assert max(range(3), key=lambda i: p[i]) == max(range(3), key=lambda i: q[i])


def test_insufficient_calibration_is_identity():
    p = [(0.5, 0.3, 0.2)] * 100
    y = ["H"] * 100
    fit = fit_temperature(p, y, minimum_samples=300)
    assert fit.temperature == 1.0
    assert fit.status == "INSUFFICIENT_DATA"
