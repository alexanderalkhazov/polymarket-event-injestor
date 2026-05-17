"""XGBoost model trainer. Run locally (NOT in Docker).

  python src/ml/train.py

Connects to TimescaleDB at localhost:5433 (the exposed port).
Saves models/scoring_model.json and models/shap_explainer.pkl.
Restart ai-correlator after training:
  docker compose restart ai-correlator
"""
from __future__ import annotations

import asyncio
import os
import pickle
import sys

import asyncpg
import pandas as pd
import shap
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit

FEATURE_COLS = [
    "poly_conviction_delta_1h", "poly_conviction_delta_4h",
    "news_sentiment_1h", "news_sentiment_4h", "news_hotness_peak_4h",
    "news_article_count_4h", "rsi_14", "macd_histogram", "atr_14",
    "bb_position", "sma_20_slope", "vol_ratio_30d",
    "price_change_1d", "price_change_5d", "put_call_ratio",
    "unusual_sweep_count_4h", "vix_level", "wti_crude",
    "us_10y_yield", "fed_funds_rate", "usd_index", "social_sentiment_z",
]

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
    return pd.DataFrame([dict(r) for r in rows])


def train(df: pd.DataFrame) -> None:
    X = df[FEATURE_COLS].fillna(0)
    y = (df["forward_return_5d"] > 0.03).astype(int)

    print(f"Samples: {len(df)}, positive class: {y.mean():.1%}")
    if len(df) < 100:
        print("WARNING: very few labeled samples. Wait for more data before relying on this model.")

    model = xgb.XGBClassifier(
        n_estimators=300, max_depth=4, learning_rate=0.05,
        subsample=0.8, tree_method="hist", device="cpu",
        eval_metric="logloss", use_label_encoder=False,
        random_state=42,
    )

    tscv = TimeSeriesSplit(n_splits=5)
    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        model.fit(
            X.iloc[train_idx], y.iloc[train_idx],
            eval_set=[(X.iloc[val_idx], y.iloc[val_idx])],
            verbose=False,
        )
        val_preds = model.predict(X.iloc[val_idx])
        acc = (val_preds == y.iloc[val_idx]).mean()
        print(f"  Fold {fold+1}: val accuracy {acc:.3f}")

    os.makedirs("models", exist_ok=True)
    model.save_model("models/scoring_model.json")
    print("Saved: models/scoring_model.json")

    explainer = shap.TreeExplainer(model)
    with open("models/shap_explainer.pkl", "wb") as f:
        pickle.dump(explainer, f)
    print("Saved: models/shap_explainer.pkl")

    # Feature importance summary
    importance = sorted(
        zip(FEATURE_COLS, model.feature_importances_),
        key=lambda x: x[1], reverse=True
    )
    print("\nTop 10 features by importance:")
    for feat, imp in importance[:10]:
        print(f"  {feat:<40} {imp:.4f}")


if __name__ == "__main__":
    df = asyncio.run(load_data())
    if df.empty:
        print("No labeled data found. Run the feature store and wait for labels to fill.")
        sys.exit(1)
    train(df)
