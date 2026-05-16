"""Build the Groq prompt — AI is a structured classifier, not a trade generator."""
from __future__ import annotations


def sig_text(s: dict) -> str:
    payload = s.get("payload") or {}
    if isinstance(payload, str):
        import json
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    urgency = payload.get("urgency", "")
    ci = payload.get("confidence_interval", [])
    ci_str = f" ci={ci}" if ci else ""
    return (
        f"source={s['source']:<12} type={s['type']:<18} "
        f"symbol={s['symbol'][:20]:<20} score={s['score']:.3f}"
        f"{' urgency=' + urgency if urgency else ''}{ci_str}"
    )


def build_prompt(new_signal: dict, recent: list, macro: list, bt: dict) -> str:
    recent_str = "\n".join(f"  {sig_text(s)}" for s in recent)
    macro_str = "\n".join(f"  {r['series_id']}: {r['value']}" for r in macro) or "  unavailable"

    return f"""You are a structured market event classifier. Your role is to INTERPRET and CLASSIFY signals — not to generate trades.

SIGNAL CLUSTER ({len(recent)} signals, {len({s['source'] for s in recent})} sources, last 15 min):
{recent_str}

BACKTEST STATISTICS (how similar setups performed historically):
  sample_size={bt['sample_size']}  data_quality={bt['data_quality']}
  win_rate={bt['win_rate']:.0%}    expectancy={bt['expectancy']:+.2f}%/trade
  sharpe={bt['sharpe']:.2f}        max_drawdown={bt['max_drawdown_pct']:.1f}%
  optimal_hold={bt['holding_period_optimal']}

CURRENT MACRO CONDITIONS:
{macro_str}

INSTRUCTIONS:
- Classify the event type and identify which sectors are affected.
- Estimate a confidence_adjustment in the range [-0.20, +0.20].
  Use NEGATIVE adjustments for: conflicting signals, poor macro alignment, event ambiguity.
  Use POSITIVE adjustments for: strong cross-source confirmation, clear macro tailwind, high-impact event.
- Do NOT invent trade ideas. Do NOT speculate beyond what the signals indicate.
- summary must be one plain-English sentence a non-expert can understand.
- thesis must be 1-2 sentences on what happened and why it matters quantitatively.

Respond ONLY in valid JSON with no preamble:
{{
  "event_class": "<earnings_surprise|macro_shift|conviction_shift|volume_anomaly|news_catalyst|regulatory|sector_rotation|liquidity_event|other>",
  "affected_sectors": {{"<sector>": "<positive|negative|neutral>"}},
  "confidence_adjustment": <float -0.20 to +0.20>,
  "macro_alignment": "<strong|moderate|weak|negative>",
  "summary": "<one sentence, plain English>",
  "thesis": "<1-2 sentences: what happened and why it matters>",
  "notes": "<historical context if relevant, or null>"
}}"""
