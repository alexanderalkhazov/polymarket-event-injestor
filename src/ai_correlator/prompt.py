"""Build the Claude prompt for opportunity detection."""
from __future__ import annotations


def sig_text(s: dict) -> str:
    return f"{s['source']} {s['type']} {s['symbol']} score={s['score']:.3f} dir={s.get('direction', 'n/a')}"


def build_prompt(new_signal: dict, recent: list, sim_sigs: list, sim_opps: list, macro: list, bt: dict) -> str:
    recent_str = "\n".join(f"  {sig_text(s)}" for s in recent)
    sim_sig_str = "\n".join(
        f"  [{s.get('sim', 0):.0%}] {sig_text(s)}" for s in sim_sigs
    ) or "  none"
    sim_opp_str = "\n".join(
        f"  [{o.get('sim', 0):.0%}] {o['summary']} — action={o['action']} conf={o['confidence']:.0%}"
        for o in sim_opps
    ) or "  none"
    macro_str = "\n".join(f"  {r['series_id']}: {r['value']}" for r in macro)

    return f"""You are a quantitative analyst inside an algorithmic trading system.

NEW SIGNAL:
  {sig_text(new_signal)}

RECENT CROSS-SOURCE SIGNALS (last 15 min, {len(recent)} signals, {len({s['source'] for s in recent})} sources):
{recent_str}

BACKTEST RESULT (how this exact signal combination performed historically):
  sample_size={bt.get('sample_size', 0)} occurrences over 2 years
  win_rate={bt.get('win_rate', 0):.0%}
  avg_return={bt.get('avg_return_pct', 0)}% (5-day hold)
  median_return={bt.get('median_return_pct', 0)}%
  sharpe={bt.get('sharpe', 'n/a')}
  max_drawdown={bt.get('max_drawdown_pct', 'n/a')}%
  expectancy={bt.get('expectancy', 0)}% per trade

SEMANTICALLY SIMILAR PAST SIGNALS:
{sim_sig_str}

SIMILAR PAST OPPORTUNITIES AND OUTCOMES:
{sim_opp_str}

CURRENT MACRO CONDITIONS:
{macro_str}

INSTRUCTIONS:
- Base expected_return_pct directly on the backtest avg_return_pct — do not fabricate.
- If win_rate < 50%, cap confidence at 0.65 regardless of signal strength.
- Factor macro context into your thesis (e.g. rising rates affect equities differently than commodities).
- Reference similar past opportunities if found and note whether they played out.

Respond ONLY in valid JSON with no preamble:
{{
  "is_opportunity": <bool>,
  "confidence": <0.0-1.0>,
  "summary": "<one sentence, plain English, for a non-expert user>",
  "thesis": "<2-3 sentences: why signals correlate, what the trade is>",
  "action": "<buy|sell|watch>",
  "tickers": ["<symbols>"],
  "expected_return_pct": <number sourced from backtest>,
  "hold_days": <suggested holding period>,
  "stop_loss_pct": <e.g. 0.03>,
  "historical_context": "<note on similar past setups, or null>",
  "macro_notes": "<how current macro affects this trade, or null>"
}}"""
