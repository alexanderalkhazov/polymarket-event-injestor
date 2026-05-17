"""Build the Claude narrative prompt. Claude explains, the model decides."""
from __future__ import annotations


def _fmt_prob(p: float) -> str:
    """Format a probability as a percentage with a trend emoji bucket."""
    pct = round(p * 100)
    if pct >= 70:
        return f"{pct}% ▲ (elevated)"
    if pct >= 50:
        return f"{pct}% → (slight lean)"
    if pct >= 30:
        return f"{pct}% → (uncertain)"
    return f"{pct}% ▼ (low)"


def build_prompt(
    signal: dict,
    confidence: float,
    top_features: list[dict],
    bt: dict,
    similar_opps: list[dict],
    macro: list[dict],
    hypothesis: dict,
    polymarket_sentiment: dict | None = None,
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

    # Format Polymarket sentiment block
    if polymarket_sentiment:
        poly_lines = []
        for cat_name, data in polymarket_sentiment.items():
            prob_str = _fmt_prob(data["avg_prob"])
            n = data["market_count"]
            top_q = data["top_question"][:90] + ("…" if len(data["top_question"]) > 90 else "")
            note = data["direction_note"]
            poly_lines.append(
                f"  {cat_name.replace('_', ' ').upper()}: {prob_str}  "
                f"[{n} market{'s' if n != 1 else ''}]\n"
                f"    e.g. \"{top_q}\"\n"
                f"    Note: {note}"
            )
        poly_str = "\n".join(poly_lines)
    else:
        poly_str = "  unavailable (producer not yet populated cache)"

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

CURRENT MACRO (FRED):
{macro_str}

POLYMARKET CROWD SENTIMENT (prediction market probabilities — live crowd wisdom):
{poly_str}

SIMILAR PAST OPPORTUNITIES:
{similar_str}

The Polymarket sentiment above reflects what prediction markets currently price in.
Use it to add nuance: if recession probability is elevated, that's a material risk for
equities. If Fed cut probability is high, that tailwinds bond trades. Reference specific
probabilities by name (e.g. "recession odds at 45%") when they are directly relevant.

Write exactly these four fields. Keep each tight.
- summary: one sentence, plain English, no jargon, no numbers except the symbol
- thesis: two to three sentences explaining what signals aligned and why they matter together; weave in Polymarket context where relevant
- risk_note: one sentence on the main thing that could invalidate this setup; include Polymarket-derived risks if significant (e.g. high recession odds)
- historical_note: one sentence referencing a similar past opportunity if found, else null

Respond ONLY in valid JSON, no preamble, no markdown:
{{
  "summary": "...",
  "thesis": "...",
  "risk_note": "...",
  "historical_note": "..." or null
}}"""
