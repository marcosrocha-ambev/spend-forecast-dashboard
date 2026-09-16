#!/usr/bin/env python
# -*- coding: latin-1 -*-
"""
transform.py - Converte o CSV do Anaplan para formato longo + rolling spend.
Etapa 1 do pipeline do Spend Forecast Dashboard.

Entrada : "Spend para o HTML.csv" (export do Anaplan, encoding latin1)
Saidas  :
  1) delta_may_june.csv - formato longo (fornecedor x mes x LE):
       Country, Category, GPO Category, Description, Parent Company, Supplier,
       Forecast Month, LE, Spend, WAPT
  2) rolling_spend.csv  - rolling spend por fornecedor x LE (12 meses):
       Country, Category, GPO Category, Description, Parent Company, Supplier,
       LE, Rolling Spend

FILTRO DE LEs VALIDOS
----------------------
O rolling spend so e calculado para LEs que tem dados reais. A deteccao e
automatica: percorre os LEs em ordem e para no primeiro cujo rolling total cai
mais de 50% abaixo do maximo ja observado (LEs futuros sem dados sao ignorados).

REGRA DO ROLLING SPEND (janela movel de 12 meses)
--------------------------------------------------
rolling(LE N) = soma de Jan..N   das colunas "ACT/LE Spend $ <mes> N"
              + soma de N+1..Dec das colunas "BASE Spend $ <mes>"
"""

import pandas as pd
import re
import sys
from collections import defaultdict

CSV_INPUT   = "Spend para o HTML.csv"
CSV_LONG    = "delta_may_june.csv"
CSV_ROLLING = "rolling_spend.csv"
ENCODING    = "latin1"

FIXED_COLS = ["Country", "Category", "GPO Category", "Description",
              "Parent Company", "Supplier"]

COL_ALIASES = {
    "country": "Country",
    "main category": "Category",
    "category": "Category",
    "gpo category": "GPO Category",
    "gpo": "GPO Category",
    "descripti on": "Description",
    "description": "Description",
    "parent company": "Parent Company",
    "supplier name": "Supplier",
    "supplier": "Supplier",
}

MONTHS = ["Jan","Feb","Mar","Apr","May","Jun",
          "Jul","Aug","Sep","Oct","Nov","Dec"]

SPEND_RE = re.compile(
    r'^ACT/LE Spend \$\s*(' + '|'.join(MONTHS) + r')\s*(\d+)$')
WAPT_RE = re.compile(
    r'^ACT/LE WAPT.*?(' + '|'.join(MONTHS) + r')\s*(\d+)$')
BASE_RE = re.compile(
    r'^BASE Spend \$\s*(' + '|'.join(MONTHS) + r')\s*(?:\d+)?$')

def detect_separator(filepath):
    with open(filepath, 'r', encoding=ENCODING) as f:
        first_line = f.readline()
    return ';' if first_line.count(';') > first_line.count(',') else ','

def clean_numeric(series):
    return pd.to_numeric(
        series.astype(str)
              .str.replace('$', '', regex=False)
              .str.replace(',', '', regex=False)
              .str.strip(),
        errors='coerce'
    ).fillna(0)

def normalize_columns(df):
    rename_map = {}
    for col in df.columns:
        key = re.sub(r'\s+', ' ', col.strip().lower())
        if key in COL_ALIASES:
            rename_map[col] = COL_ALIASES[key]
    if rename_map:
        print(f"Colunas renomeadas: {rename_map}")
        df = df.rename(columns=rename_map)
    dupes = df.columns[df.columns.duplicated()]
    if len(dupes) > 0:
        for d in dupes.unique():
            print(f"  AVISO: '{d}' duplicada; mantendo apenas a primeira ocorrencia.")
        df = df.loc[:, ~df.columns.duplicated(keep='first')]
    return df

def detect_valid_les(df, spend_by_key, base_by_month):
    """Detecta LEs com dados reais. Para no primeiro LE cujo rolling total
    cai mais de 50% abaixo do maximo ja observado (LEs futuros sem dados)."""
    all_les = sorted({le for (_, le) in spend_by_key.keys()})

    le_totals = {}
    for le in all_les:
        total = 0.0
        for m_idx, month in enumerate(MONTHS):
            if m_idx < le:
                for col in spend_by_key.get((month, le), []):
                    total += df[col].sum()
            else:
                for col in base_by_month.get(month, []):
                    total += df[col].sum()
        le_totals[le] = total

    max_so_far = 0.0
    valid = []
    for le in all_les:
        if max_so_far > 0 and le_totals[le] < max_so_far * 0.5:
            print(f"  LE {le}: rolling {le_totals[le]:,.0f} < 50% do maximo "
                  f"({max_so_far:,.0f}); parando.")
            break
        valid.append(le)
        max_so_far = max(max_so_far, le_totals[le])

    skipped = [le for le in all_les if le not in valid]
    if skipped:
        print(f"  LEs validos: {valid}  (ignorados: {skipped})")
    else:
        print(f"  LEs validos: {valid}")
    return valid

def build_rolling_long(df, spend_by_key, base_by_month):
    les = sorted({le for (_, le) in spend_by_key.keys()})
    frames = []
    for le in les:
        rolling = pd.Series(0.0, index=df.index)
        missing = []
        for m_idx, month in enumerate(MONTHS):
            if m_idx < le:
                cols = spend_by_key.get((month, le), [])
                name = f"ACT/LE Spend ${month} {le}"
            else:
                cols = base_by_month.get(month, [])
                name = f"BASE Spend ${month}"
            if not cols:
                missing.append(name)
            for col in cols:
                rolling = rolling + df[col]
        if missing:
            print(f"  AVISO (LE {le}): meses sem coluna -> {', '.join(missing)}")
        f = df[FIXED_COLS + ["_row_id"]].copy()
        f["LE"] = le
        f["Rolling"] = rolling
        frames.append(f)
    if not frames:
        return pd.DataFrame(columns=FIXED_COLS + ["_row_id", "LE", "Rolling"])
    return pd.concat(frames, ignore_index=True)

def main():
    sep = detect_separator(CSV_INPUT)
    print(f"Separador detectado: '{sep}'")

    df = pd.read_csv(CSV_INPUT, encoding=ENCODING, sep=sep, low_memory=False)
    df.columns = df.columns.str.strip()
    print(f"Linhas lidas: {len(df)}")
    print(f"Colunas: {len(df.columns)}")

    df = normalize_columns(df)

    for col in FIXED_COLS:
        if col not in df.columns:
            print(f"ERRO: coluna fixa '{col}' nao encontrada.")
            print(f"Colunas disponiveis: {list(df.columns[:30])}")
            sys.exit(1)

    # ── Detectar colunas de Spend, WAPT e BASE ──────────────
    spend_cols, wapt_cols, base_cols = {}, {}, {}
    for col in df.columns:
        m = SPEND_RE.match(col)
        if m:
            spend_cols[col] = (m.group(1), int(m.group(2))); continue
        m = WAPT_RE.match(col)
        if m:
            wapt_cols[col] = (m.group(1), int(m.group(2))); continue
        m = BASE_RE.match(col)
        if m:
            base_cols[col] = m.group(1)

    spend_by_key = defaultdict(list)
    for colname, key in spend_cols.items():
        spend_by_key[key].append(colname)
    base_by_month = defaultdict(list)
    for colname, month in base_cols.items():
        base_by_month[month].append(colname)

    print(f"Colunas de Spend (ACT/LE): {len(spend_cols)}")
    print(f"Colunas de WAPT  (ACT/LE): {len(wapt_cols)}")
    print(f"Colunas de BASE  (ano anterior): {len(base_cols)}")

    if not spend_cols:
        print("ERRO: nenhuma coluna de Spend encontrada.")
        sys.exit(1)

    for kw, found in (("BASE", base_cols), ("WAPT", wapt_cols)):
        odd = [c for c in df.columns if kw in c.upper() and c not in found]
        if odd:
            print(f"  AVISO: colunas com '{kw}' fora do padrao (ignoradas): "
                  f"{odd[:6]}{' ...' if len(odd) > 6 else ''}")

    if len(base_cols) < 12:
        print(f"  AVISO: so {len(base_cols)}/12 meses de BASE; rolling incompleto.")

    for col in list(spend_cols) + list(wapt_cols) + list(base_cols):
        df[col] = clean_numeric(df[col])

    df = df.copy()
    df["_row_id"] = df.index

    # ── Detectar LEs validos (filtrar LEs futuros sem dados) ──
    print("\nDetectando LEs com dados reais...")
    valid_les = detect_valid_les(df, spend_by_key, base_by_month)
    valid_set = set(valid_les)

    # Filtrar colunas para apenas LEs validos
    spend_cols = {k: v for k, v in spend_cols.items() if v[1] in valid_set}
    wapt_cols = {k: v for k, v in wapt_cols.items() if v[1] in valid_set}

    # Rebuild spend_by_key com apenas LEs validos
    spend_by_key = defaultdict(list)
    for colname, key in spend_cols.items():
        spend_by_key[key].append(colname)

    print(f"\nColunas filtradas para LEs validos:")
    print(f"  Spend: {len(spend_cols)}  |  WAPT: {len(wapt_cols)}")

    # ── Rolling spend por linha x LE ────────────────────────
    print("\nCalculando rolling spend...")
    df_rolling_long = build_rolling_long(df, spend_by_key, base_by_month)

    # ── Formato longo: Spend ────────────────────────────────
    df_spend = df.melt(
        id_vars=FIXED_COLS + ["_row_id"],
        value_vars=list(spend_cols.keys()),
        var_name="_col", value_name="Spend")
    df_spend["Forecast Month"] = df_spend["_col"].map(lambda c: spend_cols[c][0])
    df_spend["LE"] = df_spend["_col"].map(lambda c: spend_cols[c][1])
    df_spend = df_spend.drop(columns="_col")

    # ── Formato longo: WAPT + rolling (peso) ────────────────
    if wapt_cols:
        df_wapt = df.melt(
            id_vars=FIXED_COLS + ["_row_id"],
            value_vars=list(wapt_cols.keys()),
            var_name="_col", value_name="WAPT")
        df_wapt["Forecast Month"] = df_wapt["_col"].map(lambda c: wapt_cols[c][0])
        df_wapt["LE"] = df_wapt["_col"].map(lambda c: wapt_cols[c][1])
        df_wapt = df_wapt.drop(columns="_col")

        df_long = df_spend.merge(
            df_wapt.drop(columns=FIXED_COLS),
            on=["_row_id", "Forecast Month", "LE"], how="left")
        df_long["WAPT"] = df_long["WAPT"].fillna(0)

        df_long = df_long.merge(
            df_rolling_long[["_row_id", "LE", "Rolling"]],
            on=["_row_id", "LE"], how="left")
        df_long["Rolling"] = df_long["Rolling"].fillna(0)
        df_long["WeightedTerm"] = df_long["WAPT"] * df_long["Rolling"]
    else:
        df_long = df_spend.copy()
        df_long["WAPT"] = 0.0
        df_long["Rolling"] = 0.0
        df_long["WeightedTerm"] = 0.0
        print("AVISO: nenhuma coluna de WAPT. WAPT sera 0.")

    df_long = df_long.drop(columns=["_row_id"])

    # ── Agregar duplicatas ──
    group_cols = FIXED_COLS + ["Forecast Month", "LE"]
    df_agg = df_long.groupby(group_cols, as_index=False).agg({
        "Spend": "sum", "WeightedTerm": "sum", "Rolling": "sum"})

    df_agg["WAPT"] = 0.0
    mask = df_agg["Rolling"] > 0
    df_agg.loc[mask, "WAPT"] = df_agg.loc[mask, "WeightedTerm"] / df_agg.loc[mask, "Rolling"]
    df_agg = df_agg.drop(columns=["WeightedTerm", "Rolling"])

    df_agg["LE"] = df_agg["LE"].astype(int)
    df_agg["Spend"] = df_agg["Spend"].astype(float)
    df_agg["WAPT"] = df_agg["WAPT"].astype(float)

    # ── Saida 1: delta_may_june.csv ──────────────────────────
    df_agg.to_csv(CSV_LONG, index=False)
    print(f"\nOutput 1: {CSV_LONG}")
    print(f"  Linhas: {len(df_agg)}")
    print(f"  LEs unicos: {sorted(df_agg['LE'].unique().tolist())}")
    if wapt_cols:
        wapt_nonzero = df_agg[df_agg['WAPT'] > 0]
        if len(wapt_nonzero) > 0:
            print(f"  WAPT range: {wapt_nonzero['WAPT'].min():.1f} a "
                  f"{wapt_nonzero['WAPT'].max():.1f} dias")

    # ── Saida 2: rolling_spend.csv ──────────────────────────
    df_rolling = df_rolling_long.groupby(
        FIXED_COLS + ["LE"], as_index=False)["Rolling"].sum()
    df_rolling = df_rolling.rename(columns={"Rolling": "Rolling Spend"})
    df_rolling["LE"] = df_rolling["LE"].astype(int)
    df_rolling["Rolling Spend"] = df_rolling["Rolling Spend"].astype(float)
    df_rolling.to_csv(CSV_ROLLING, index=False)

    print(f"\nOutput 2: {CSV_ROLLING}")
    print(f"  Fornecedores x LE: {len(df_rolling)}")
    tot = df_rolling.groupby("LE")["Rolling Spend"].sum()
    for le in sorted(tot.index):
        print(f"  Rolling total LE {le}: {tot[le]:,.0f}")
    print("\nProximo passo: rode 'py build_payload.py' (Parte 2)")

if __name__ == "__main__":
    main()