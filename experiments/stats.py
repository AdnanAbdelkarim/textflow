"""
Statistical procedures for the TextFlow evaluation.

Two common pitfalls in comparing cross-validated classifiers are handled here.

1. A non-significant paired t-test is not evidence of equivalence.
   Failing to reject "no difference" is not evidence of no difference.
   `tost_paired` performs two one-sided tests against a pre-specified
   equivalence margin and returns a confidence interval for the difference.

2. Fold-level scores from k-fold cross-validation are not independent -
   training sets overlap - so the ordinary paired t-test is anti-conservative.
   `corrected_resampled_ttest` applies the Nadeau & Bengio variance correction
   (Nadeau & Bengio 2003; Bouckaert & Frank 2004), which inflates the variance
   estimate by (1/k + n_test/n_train).
"""
import numpy as np
from scipy import stats


def paired_ttest(a, b):
    """Ordinary paired t-test. Reported for comparison only; see the note above."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = a - b
    # scipy returns nan when the paired differences have zero variance. That
    # case is not a failure - it means the two pipelines agreed exactly on
    # every fold - so report it explicitly rather than emitting nan.
    if d.var(ddof=1) == 0:
        identical = bool(np.all(d == 0))
        return {"test": "paired t-test (uncorrected)",
                "t": 0.0 if identical else float("inf"),
                "p": 1.0 if identical else 0.0,
                "df": int(len(a) - 1),
                "note": ("the two pipelines produced identical scores on every "
                         "fold; the test is undefined and no difference exists"
                         if identical else
                         "constant non-zero difference on every fold")}
    t, p = stats.ttest_rel(a, b)
    return {"test": "paired t-test (uncorrected)",
            "t": float(t), "p": float(p), "df": int(len(a) - 1)}


def corrected_resampled_ttest(a, b, n_train, n_test):
    """
    Nadeau & Bengio corrected resampled t-test for k-fold CV scores.

    The variance of the mean difference is inflated by (1/k + n_test/n_train)
    to account for the training-set overlap between folds.
    """
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = a - b
    k = len(d)
    mean_d = d.mean()
    var_d = d.var(ddof=1)

    correction = (1.0 / k) + (n_test / n_train)
    denom = np.sqrt(correction * var_d)
    if denom == 0:
        return {"test": "corrected resampled t-test (Nadeau & Bengio)",
                "t": 0.0, "p": 1.0, "df": k - 1,
                "mean_difference": float(mean_d),
                "correction_factor": float(correction),
                "note": "zero variance: the two configurations are identical "
                        "on every fold"}

    t = mean_d / denom
    p = 2 * stats.t.sf(abs(t), df=k - 1)
    return {"test": "corrected resampled t-test (Nadeau & Bengio)",
            "t": float(t), "p": float(p), "df": k - 1,
            "mean_difference": float(mean_d),
            "correction_factor": float(correction)}


def tost_paired(a, b, margin, alpha=0.05, corrected=False,
                n_train=None, n_test=None):
    """
    Two one-sided tests for equivalence of paired samples.

    Equivalence is concluded when BOTH one-sided tests reject, i.e. when the
    (1-2*alpha) confidence interval for the mean difference lies entirely
    inside (-margin, +margin).

    Args:
        margin: the equivalence margin, in the units of the scores. This must
                be chosen on substantive grounds BEFORE seeing the data.
        corrected: use the Nadeau & Bengio variance correction (requires
                   n_train and n_test).

    Returns a dict with both one-sided p-values, the decision, and the CI.
    """
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = a - b
    k = len(d)
    mean_d = d.mean()
    var_d = d.var(ddof=1)

    if corrected:
        if n_train is None or n_test is None:
            raise ValueError("corrected=True requires n_train and n_test")
        se = np.sqrt(((1.0 / k) + (n_test / n_train)) * var_d)
        se_label = "Nadeau & Bengio corrected"
    else:
        se = np.sqrt(var_d / k)
        se_label = "uncorrected"

    df = k - 1
    if se == 0:
        equivalent = abs(mean_d) < margin
        return {"test": f"TOST ({se_label})", "margin": float(margin),
                "mean_difference": float(mean_d), "se": 0.0,
                "p_lower": 0.0 if equivalent else 1.0,
                "p_upper": 0.0 if equivalent else 1.0,
                "p_tost": 0.0 if equivalent else 1.0,
                "equivalent": bool(equivalent),
                "ci_lower": float(mean_d), "ci_upper": float(mean_d),
                "ci_level": 1 - 2 * alpha,
                "note": "zero variance across folds"}

    # H0_lower: difference <= -margin   H0_upper: difference >= +margin
    t_lower = (mean_d + margin) / se
    t_upper = (mean_d - margin) / se
    p_lower = stats.t.sf(t_lower, df)
    p_upper = stats.t.cdf(t_upper, df)
    p_tost = max(p_lower, p_upper)

    crit = stats.t.ppf(1 - alpha, df)
    ci_lower = mean_d - crit * se
    ci_upper = mean_d + crit * se

    return {"test": f"TOST ({se_label})",
            "margin": float(margin), "alpha": alpha,
            "mean_difference": float(mean_d), "se": float(se), "df": df,
            "t_lower": float(t_lower), "t_upper": float(t_upper),
            "p_lower": float(p_lower), "p_upper": float(p_upper),
            "p_tost": float(p_tost),
            "equivalent": bool(p_tost < alpha),
            "ci_lower": float(ci_lower), "ci_upper": float(ci_upper),
            "ci_level": 1 - 2 * alpha}


def cohens_dz(a, b):
    """Effect size for paired samples: mean difference over its own SD."""
    d = np.asarray(a, float) - np.asarray(b, float)
    sd = d.std(ddof=1)
    return float(d.mean() / sd) if sd else 0.0


def holm_bonferroni(pvalues, alpha=0.05):
    """
    Holm-Bonferroni step-down correction.

    Preferred over plain Bonferroni: uniformly more powerful at the same
    family-wise error rate, and it adapts to the actual number of tests in the
    family rather than assuming a fixed count.
    """
    p = np.asarray(pvalues, float)
    n = len(p)
    order = np.argsort(p)
    adjusted = np.empty(n)
    running = 0.0
    for rank, i in enumerate(order):
        val = (n - rank) * p[i]
        running = max(running, val)
        adjusted[i] = min(1.0, running)
    return {"adjusted_p": adjusted.tolist(),
            "reject": (adjusted < alpha).tolist(),
            "n_tests": n, "alpha": alpha, "method": "Holm-Bonferroni"}
