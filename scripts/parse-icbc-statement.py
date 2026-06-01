#!/usr/bin/env python3
"""Parse ICBC transaction-detail PDFs into a small cashflow preview.

The browser Finance page owns the real encrypted import path. This script is a
local verification helper for downloaded ICBC statement PDFs.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from decimal import Decimal
from pathlib import Path

from pypdf import PdfReader


@dataclass
class ParsedTransaction:
    date_time: str
    summary: str
    amount: str
    balance: str
    direction: str
    kind: str
    category: str
    counterparty: str
    channel: str
    raw: str


def parse_money(value: str) -> Decimal:
    return Decimal(value.replace(" ", "").replace(",", ""))


def compact(line: str) -> str:
    return re.sub(r"\s+", " ", line.replace("\xa0", " ")).strip()


def transaction_chunks(text: str) -> list[str]:
    normalized = text.replace("\r", "\n")
    normalized = re.sub(r"(\d{4}-\d{2}-\d{2})\s*\n\s*(\d{2}:\d{2}:\d{2})", r"\1 \2", normalized)
    pattern = re.compile(
        r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})([\s\S]*?)(?=\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|本页|第\s*\d+\s*页|$)"
    )
    return [f"{match.group(1)} {match.group(2)}" for match in pattern.finditer(normalized)]


def redact_bank_raw(value: str) -> str:
    return re.sub(r"\b\d{10,}\b", "****", value)


def classify(summary: str, counterparty: str, channel: str, amount: Decimal) -> tuple[str, str]:
    text = f"{summary} {counterparty} {channel}"
    positive = amount >= 0
    if re.search(r"理财|基金|金融付款|证券|银证|投资", text):
        return "investment", "investment_sell" if positive else "investment_buy"
    if re.search(r"工资|薪", text):
        return "income", "salary"
    if re.search(r"退款|退货|返现", text):
        return "income", "reward"
    if re.search(r"利息|分红", text):
        return "income", "interest"
    if re.search(r"转账|网转|提现|充值|卡通|财付通|微信|支付宝", text):
        return "transfer", "transfer"
    if re.search(r"手续费|服务费", text):
        return "fee", "fee"
    if re.search(r"餐|饭|美团|饿了么|外卖|咖啡|饮品", text):
        return "expense", "food"
    if re.search(r"房租|物业|水电|燃气|宽带", text):
        return "expense", "housing"
    if re.search(r"地铁|公交|铁路|机票|滴滴|高德|交通", text):
        return "expense", "transport"
    if re.search(r"医院|药|医保|健康", text):
        return "expense", "health"
    if re.search(r"课程|书|教育|学习", text):
        return "expense", "education"
    return ("income", "other") if positive else ("expense", "living")


def parse_line(line: str) -> ParsedTransaction | None:
    normalized = compact(line)
    date_match = re.match(r"^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$", normalized)
    if not date_match:
        return None
    rest = date_match.group(3)
    amount_match = re.search(r"([+-]\s?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(.*)$", rest)
    if not amount_match:
        return None
    before_amount = compact(rest[: amount_match.start()])
    before_tokens = [token for token in before_amount.split(" ") if token]
    summary_index = len(before_tokens) - 2 if before_tokens and re.match(r"^\d+$", before_tokens[-1]) else len(before_tokens) - 1
    summary = before_tokens[summary_index] if summary_index >= 0 else "银行流水"
    amount = parse_money(amount_match.group(1))
    balance = parse_money(amount_match.group(2))
    tail_tokens = [token for token in compact(amount_match.group(3)).split(" ") if token]
    channel = tail_tokens[-1] if tail_tokens else ""
    counterparty = " ".join(tail_tokens[:-1])
    kind, category = classify(summary, counterparty, channel, amount)
    return ParsedTransaction(
        date_time=f"{date_match.group(1)} {date_match.group(2)}",
        summary=summary,
        amount=str(amount),
        balance=str(balance),
        direction="in" if amount >= 0 else "out",
        kind=kind,
        category=category,
        counterparty=counterparty,
        channel=channel,
        raw=normalized,
    )


def extract_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages)


def parse_pdf(pdf_path: Path) -> tuple[list[ParsedTransaction], list[str], int]:
    text = extract_text(pdf_path)
    rows: list[ParsedTransaction] = []
    skipped: list[str] = []
    for line in transaction_chunks(text):
        parsed = parse_line(line)
        if parsed:
            parsed.raw = redact_bank_raw(parsed.raw)
            rows.append(parsed)
        else:
            skipped.append(line)
    return rows, skipped, text.count("\f") + 1


def build_summary(rows: list[ParsedTransaction]) -> dict[str, object]:
    totals: dict[str, Decimal] = defaultdict(Decimal)
    categories: dict[str, Decimal] = defaultdict(Decimal)
    for row in rows:
        amount = parse_money(row.amount)
        totals[row.kind] += abs(amount)
        categories[f"{row.kind}:{row.category}"] += abs(amount)
    return {
        "transaction_count": len(rows),
        "income": str(totals["income"]),
        "expense": str(totals["expense"]),
        "investment": str(totals["investment"]),
        "transfer": str(totals["transfer"]),
        "fee": str(totals["fee"]),
        "net_cashflow": str(totals["income"] - totals["expense"] - totals["fee"]),
        "top_categories": sorted(((key, str(value)) for key, value in categories.items()), key=lambda item: Decimal(item[1]), reverse=True)[:12],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("data/analysis"))
    args = parser.parse_args()
    rows, skipped, _page_hint = parse_pdf(args.pdf)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.pdf.stem
    json_path = args.out_dir / f"{stem}.parsed.json"
    csv_path = args.out_dir / f"{stem}.parsed.csv"
    summary_path = args.out_dir / f"{stem}.summary.json"
    json_path.write_text(json.dumps([asdict(row) for row in rows], ensure_ascii=False, indent=2), encoding="utf-8")
    summary_path.write_text(json.dumps({"summary": build_summary(rows), "skipped_count": len(skipped), "skipped": skipped[:20]}, ensure_ascii=False, indent=2), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
      writer = csv.DictWriter(handle, fieldnames=list(asdict(rows[0]).keys()) if rows else ["date_time"])
      writer.writeheader()
      for row in rows:
          writer.writerow(asdict(row))
    print(json.dumps({"rows": len(rows), "skipped": len(skipped), "json": str(json_path), "csv": str(csv_path), "summary": build_summary(rows)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
