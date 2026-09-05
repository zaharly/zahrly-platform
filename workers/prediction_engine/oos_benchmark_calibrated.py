from . import oos_benchmark
from . import top_label_calibration as cal
from . import walk_forward


def _apply(prediction, calibration):
    if calibration == 1.0 or calibration is None:
        return prediction
    return cal.apply(prediction, calibration)


walk_forward._apply_calibration = _apply
oos_benchmark.fit_temperature = cal.fit

if __name__ == "__main__":
    oos_benchmark.main()
