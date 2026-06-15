export function peHistoryPercentile(history, currentPe, years) {
  const latestDate = history.at(-1)?.date;
  if (!latestDate) return null;
  const cutoff = new Date(latestDate);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const values = history.filter((item) => item.date >= cutoff).map((item) => item.pe);
  if (!values.length) return null;
  return Number(((values.filter((value) => value <= currentPe).length / values.length) * 100).toFixed(1));
}

export function parseWorldPeRatio(html) {
  const raw = String(html || '');
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mu;/gi, 'μ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const historyMatch = raw.match(/detailPE_data\s*=\s*\[(.*?)\];/s);
  const history = historyMatch
    ? [...historyMatch[1].matchAll(/\[Date\.UTC\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\),\s*([0-9.]+)\]/g)]
      .map((item) => ({ date: new Date(Date.UTC(Number(item[1]), Number(item[2]), Number(item[3]))), pe: Number(item[4]) }))
      .filter((item) => Number.isFinite(item.pe))
    : [];
  const pe = Number(text.match(/estimated Price-to-Earnings \(P\/E\) Ratio for .*? is\s*([0-9.]+)/i)?.[1]);
  const range = text.match(/average P\/E interval is\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/i);
  const sma200 = Number(text.match(/Price vs SMA200\s*([+-]?[0-9.]+)%/i)?.[1]);
  const sma50 = Number(text.match(/Price vs SMA50\s*([+-]?[0-9.]+)%/i)?.[1]);
  if (![pe, sma50, sma200].every(Number.isFinite) || !range || !history.length) throw new Error('估值或历史序列解析失败');
  return {
    pe,
    peRangeLow: Number(range[1]),
    peRangeHigh: Number(range[2]),
    pePercentile5: peHistoryPercentile(history, pe, 5),
    pePercentile10: peHistoryPercentile(history, pe, 10),
    sma50Margin: sma50,
    sma200Margin: sma200,
    asOf: text.match(/calculated on\s*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i)?.[1] || '',
  };
}

export function scoreIndexPurchaseAssessment(metrics) {
  let score = 0;
  const reasons = [];
  if (metrics.pePercentile5 <= 20) { score += 2; reasons.push(`近 5 年 PE 百分位仅 ${metrics.pePercentile5}%，估值处于历史低位`); }
  else if (metrics.pePercentile5 <= 40) { score += 1; reasons.push(`近 5 年 PE 百分位为 ${metrics.pePercentile5}%，估值相对偏低`); }
  else if (metrics.pePercentile5 >= 90) { score -= 2; reasons.push(`近 5 年 PE 百分位达到 ${metrics.pePercentile5}%，估值处于极高位置`); }
  else if (metrics.pePercentile5 >= 75) { score -= 1; reasons.push(`近 5 年 PE 百分位为 ${metrics.pePercentile5}%，估值相对偏高`); }
  else reasons.push(`近 5 年 PE 百分位为 ${metrics.pePercentile5}%，估值处于中性区间`);
  if (metrics.sma200Margin <= -10) { score += 1; reasons.push('价格明显低于 200 日均线，仅适合分批承接'); }
  else if (metrics.sma200Margin >= 20) { score -= 1; reasons.push('价格明显高于 200 日均线，长期趋势偏拥挤'); }
  if (metrics.sma50Margin <= -5) { score += 1; reasons.push('价格低于 50 日均线，短期已有回调'); }
  else if (metrics.sma50Margin >= 10) { score -= 1; reasons.push('价格明显高于 50 日均线，短期不宜追高'); }
  if (score >= 3) return { score, signal: '适合分批加仓', intensity: '高于常规定投', reasons };
  if (score >= 1) return { score, signal: '适合按计划定投', intensity: '常规定投', reasons };
  if (score === 0) return { score, signal: '中性，可按计划定投', intensity: '常规定投，不额外加仓', reasons };
  if (score >= -2) return { score, signal: '估值偏高，仍可按计划小额定投', intensity: '低于常规定投，不额外加仓', reasons };
  return { score, signal: '估值与趋势同时过热，暂缓追高', intensity: '暂缓额外加仓，仅保留极小额定投', reasons };
}
