# ENGINE BEHAVIOR ANALYSIS — Phase 4
Date: 2026-09-18T13:21:10.319Z

## 1. Model vs Odds Divergence

How much does the VirtuMatch model modify odds-implied probabilities?

| Odds (H/D/A) | Model (H/D/A) | Odds Winner | Model Winner | Max Divergence |
|--------------|---------------|-------------|-------------|----------------|
| 1.3/5/9 | 71.2/18.5/10.3% | 1 | 1 | 0.02% |
| 1.8/3.5/4.5 | 52.2/26.9/20.9% | 1 | 1 | 0.04% |
| 2.5/3.2/2.8 | 37.4/29.2/33.4% | 1 | 1 | 0.02% |
| 3/3.3/2.3 | 31.1/28.3/40.6% | 2 | 2 | 0.02% |
| 7/4.5/1.4 | 13.2/20.6/66.2% | 2 | 2 | 0.04% |
| 2.8/2.8/2.8 | 33.3/33.3/33.3% | 1 | 1 | 0.03% |
| 2.4/3.1/2.9 | 38.4/29.8/31.8% | 1 | 1 | 0.04% |
| 1.9/3.3/4 | 48.8/28.1/23.2% | 1 | 1 | 0.04% |
| 1.1/7/15 | 81.3/12.8/6.0% | 1 | 1 | 0.04% |
| 2.2/3/3.3 | 41.7/30.6/27.8% | 1 | 1 | 0.04% |

**Average divergence**: 0.03%
**Prediction reversals**: 0 / 10

## 2. Divergence Direction Analysis

When the model diverges from odds, which direction does it tend?

- Home probability: average shift = -0.01% (model reduces home)
- Draw probability: average shift = 0.01% (model boosts draws)
- Away probability: average shift = 0.01% (model boosts away)

## 3. Confidence Analysis

| Odds | Model Confidence | Expected Goals |
|------|----------------|---------------|
| 1.3/5/9 | 53% | 2.75 |
| 1.8/3.5/4.5 | 36% | 2.25 |
| 2.5/3.2/2.8 | 25% | 2.20 |
| 3/3.3/2.3 | 25% | 2.30 |
| 7/4.5/1.4 | 48% | 2.70 |
| 2.8/2.8/2.8 | 25% | 1.80 |
| 2.4/3.1/2.9 | 25% | 2.15 |
| 1.9/3.3/4 | 33% | 2.20 |
| 1.1/7/15 | 60% | 3.15 |
| 2.2/3/3.3 | 27% | 1.95 |

**Average confidence**: 35.7%
**Confidence range**: 25% - 60%

**Note**: Confidence is a heuristic score (25-82%), NOT a calibrated probability.
Using it as a probability in LogLoss/Brier calculations would be incorrect.
