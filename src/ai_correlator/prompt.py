"""Build the Claude narrative prompt. Claude explains, the model decides."""
from __future__ import annotations


def build_prompt(
    signal: dict,
    confidence: float,
    top_features: list[dict],
    bt: dict,
    similar_opps: list[dict],
    macro: list[dict],
    hypothesis: dict,
) -> str:
    top_feat_str = "\n".join(
        f"  {f['feature']}: {f['current_value']:.3f} "
        f"({'supports' if f['shap_value'] > 0 else 'weighs against'}, "
        f"impact {abs(f['shap_value']):.3f})"
        for f in top_features
    ) or "  rule-based scoring active (model not yet trained)"

    similar_str = "\n".join(
        f"  [{o.get('sim', 0):.0%} match] {o['summary']} — conf {o['model_confidence']:.0%}"
        for o in similar_opps
    ) or "  none found"

    macro_str = "\n".join(
        f"  {r['series_id']}: {r['value']}" for r in macro
    ) or "  unavailable"

    return f"""You are a trading strategy analyst. A quantitative model has identified a
prediction. Your ONLY job is to explain it clearly in four fields.
Do NOT question the numbers. Do NOT add your own probability estimates.
Do NOT say whether this is a good or bad trade. Just explain what the model found.

HYPOTHESIS: {hypothesis['name']}
  {hypothesis['description']}

PREDICTION:
  Symbol: {signal['symbol']}
  Model confidence: {confidence:.0%}
  Historical win rate: {bt['win_rate']:.0%} over {bt['sample_size']} occurrences
  Avg return: {bt['avg_return_pct']:.2f}% over {hypothesis.get('hold_days', 5)} days
  Expectancy: {bt['expectancy']:.2f}% per trade

TOP FEATURES DRIVING MODEL SCORE (SHAP values):
{top_feat_str}

SIMILAR PAST OPPORTUNITIES:
{similar_str}

CURRENT MACRO:
{macro_str}

Write exactly these four fields. Keep each tight.
- summary: one sentence, plain English, no jargon, no numbers except the symbol
- thesis: two to three sentences explaining what signals aligned and why they matter together
- risk_note: one sentence on the main thing that could invalidate this setup
- historical_note: one sentence referencing a similar past opportunity if found, else null

Respond ONLY in valid JSON, no preamble, no markdown:
{{
  "summary": "...",
  "thesis": "...",
  "risk_note": "...",
  "historical_note": "..." or null
}}"""
