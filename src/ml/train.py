"""XGBoost model trainer. Run locally (NOT in Docker).

  python src/ml/train.py [--min-samples N]

Connects to TimescaleDB at localhost:5433 (the exposed port).
Saves models/scoring_model.json and models/shap_explainer.pkl.
Restart ai-correlator after training:
  docker compose restart ai-correlator

Label strategy
--------------
We train two labels:
  - y_long  = 1 if 5-day return > +3% (buy signal worked)
  - y_short = 1 if 5-day return < -3% (sell signal worked)

The correlator calls predict_proba(X)[0][1] to get P(signal succeeds).
For buy signals, use the long model.  For sell signals, use the short model.
This avoids the class-imbalance problem of training a single bullish model
and then hoping it generalises to bearish setups.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import pickle
import sys
from pathlib import Path

import asyncpg
import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import TimeSeriesSplit

# All 31 features in the features table (was 21 — 10 were silently ignored)
FEATURE_COLS = [
    # Polymarket
    "poly_yes_price", "poly_conviction_delta_1h", "poly_conviction_delta_4h", "poly_volume_24h",
    # News
    "news_sentiment_1h", "news_sentiment_4h", "news_hotness_peak_4h", "news_article_count_4h",
    # Price / Technical
    "rsi_14", "macd_histogram", "atr_14", "bb_position", "sma_20_slope",
    "vol_ratio_30d", "price_change_1d", "price_change_5d",
    # Options
    "put_call_ratio", "unusual_sweep_count_4h",
    # Macro
    "vix_level", "wti_crude", "us_10y_yield", "fed_funds_rate", "usd_index", "yield_curve_10_2",
    # Advanced technical
    "adx_14", "bb_width", "price_vs_sma50", "atr_pct", "hv_20", "price_vs_52w_high", "stoch_k",
]

MODEL_DIR = Path(os.getenv("MODEL_DIR", "models"))
TIMESCALE_URL = os.getenv(
    "TIMESCALE_URL",
    "postgresql://postgres:postgres@localhost:5433/market_history",
)


async def load_data() -> pd.DataFrame:
    conn = await asyncpg.connect(TIMESCALE_URL)
    try:
        rows = await conn.fetch(
            "SELECT * FROM features WHERE forward_return_5d IS NOT NULL ORDER BY ts ASC"
        )
    finally:
        await conn.close()
    df = pd.DataFrame([dict(r) for r in rows])
    print(f"Loaded {len(df)} labeled rows from TimescaleDB")
    return df


def _xgb(scale_pos_weight: float = 1.0) -> xgb.XGBClassifier:
    return xgb.XGBClassifier(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.04,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=3,
        gamma=0.1,
        scale_pos_weight=scale_pos_weight,  # handles class imbalance
        tree_method="hist",
        device="cpu",
        eval_metric="aucpr",
        use_label_encoder=False,
        random_state=42,
    )


def _train_one(
    name: str, X: pd.DataFrame, y: pd.Series
) -> tuple[xgb.XGBClassifier, IsotonicRegression]:
    """Train XGBoost with TimeSeriesSplit CV.

    Also fits an isotonic regression calibrator on the out-of-fold predictions.
    Raw XGBoost probabilities are overconfident — the calibrator maps them to
    true frequencies so that a 0.70 confidence really means ~70% of similar
    setups won historically.
    """
    pos_rate  = y.mean()
    imbalance = (1 - pos_rate) / pos_rate if pos_rate > 0 else 1.0
    print(f"\n── {name} model ─────────────────────────────")
    print(f"   Samples: {len(y)}  positive: {pos_rate:.1%}  scale_pos_weight: {imbalance:.1f}")
    if len(y) < 100:
        print("   WARNING: very few samples — predictions may be unstable.")

    model = _xgb(scale_pos_weight=imbalance)
    tscv  = TimeSeriesSplit(n_splits=min(5, max(2, len(y) // 50)))
    all_val_y: list[float] = []
    all_val_p: list[float] = []

    for fold, (tr, va) in enumerate(tscv.split(X)):
        model.fit(
            X.iloc[tr], y.iloc[tr],
            eval_set=[(X.iloc[va], y.iloc[va])],
            verbose=False,
        )
        proba = model.predict_proba(X.iloc[va])[:, 1]
        pred  = (proba >= 0.5).astype(int)
        all_val_y.extend(y.iloc[va].tolist())
        all_val_p.extend(proba.tolist())
        f1  = f1_score(y.iloc[va], pred, zero_division=0)
        auc = roc_auc_score(y.iloc[va], proba) if y.iloc[va].nunique() > 1 else float("nan")
        print(f"   Fold {fold+1}: F1={f1:.3f}  AUC-ROC={auc:.3f}")

    oof_y = np.array(all_val_y)
    oof_p = np.array(all_val_p)

    if len(set(all_val_y)) > 1:
        auc_pr  = average_precision_score(oof_y, oof_p)
        brier   = brier_score_loss(oof_y, oof_p)
        print(f"   AUC-PR: {auc_pr:.3f}  |  Brier score (lower=better): {brier:.4f}")

    # ── Isotonic calibration ──────────────────────────────────────────────────
    # Fits a monotone mapping raw_prob → calibrated_prob using OOF predictions.
    # After calibration: if model says 0.70, ~70% of similar past setups won.
    calibrator = IsotonicRegression(out_of_bounds="clip")
    if len(oof_y) >= 20 and len(set(oof_y.tolist())) > 1:
        calibrator.fit(oof_p, oof_y)
        cal_p   = calibrator.predict(oof_p)
        brier_c = brier_score_loss(oof_y, cal_p)
        print(f"   Calibrated Brier score:         {brier_c:.4f}  (gap = improvement)")
    else:
        # Not enough data to calibrate — identity mapping
        calibrator.fit([0.0, 1.0], [0.0, 1.0])
        print("   Calibration skipped (insufficient OOF data)")

    return model, calibrator


def _save_model(
    model: xgb.XGBClassifier,
    calibrator: IsotonicRegression,
    suffix: str,
) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIR / f"scoring_model{suffix}.json"
    shap_path  = MODEL_DIR / f"shap_explainer{suffix}.pkl"
    cal_path   = MODEL_DIR / f"calibrator{suffix}.pkl"

    model.save_model(str(model_path))
    print(f"   Saved: {model_path}")

    explainer = shap.TreeExplainer(model)
    with open(shap_path, "wb") as f:
        pickle.dump(explainer, f)
    print(f"   Saved: {shap_path}")

    with open(cal_path, "wb") as f:
        pickle.dump(calibrator, f)
    print(f"   Saved: {cal_path}")

    importance = sorted(
        zip(FEATURE_COLS, model.feature_importances_),
        key=lambda x: x[1], reverse=True,
    )
    print("   Top 10 features:")
    for feat, imp in importance[:10]:
        print(f"     {feat:<42} {imp:.4f}")


def train(df: pd.DataFrame) -> None:
    # asyncpg returns NUMERIC as Decimal — cast everything to float64
    X = df[FEATURE_COLS].apply(pd.to_numeric, errors="coerce").fillna(0).astype(float)

    # ── Long model: did buying work? ─────────────────────────────────────────
    y_long          = (df["forward_return_5d"] > 0.03).astype(int)
    m_long, cal_long = _train_one("LONG (buy signal success)", X, y_long)
    _save_model(m_long, cal_long, "")

    # ── Short model: did selling work? ───────────────────────────────────────
    y_short           = (df["forward_return_5d"] < -0.03).astype(int)
    m_short, cal_short = _train_one("SHORT (sell signal success)", X, y_short)
    _save_model(m_short, cal_short, "_short")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-samples", type=int, default=50,
                        help="Abort if fewer labeled rows than this (default: 50)")
    args = parser.parse_args()

    df = asyncio.run(load_data())
    if df.empty:
        print("No labeled data — run the feature store and wait for forward_return_5d to fill.")
        sys.exit(1)
    if len(df) < args.min_samples:
        print(f"Only {len(df)} samples < --min-samples {args.min_samples}. Pass a lower value to override.")
        sys.exit(1)

    train(df)
    print("\nDone. Restart ai-correlator to pick up the new model:")
    print("  docker compose restart ai-correlator")
