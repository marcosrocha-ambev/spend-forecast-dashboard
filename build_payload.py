#!/usr/bin/env python
# -*- coding: latin-1 -*-
"""
build_payload.py - Constrói a árvore hierárquica pré-agregada.
Etapa 2 do pipeline do Spend Forecast Dashboard.

Lê:
  - delta_may_june.csv (formato longo: Spend + WAPT por fornecedor/mês/LE)
  - rolling_spend.csv  (rolling spend por fornecedor/LE)

Cada nó da árvore tem 3 acumuladores:
  lm[le-1][mês]  = spend (para KPIs de spend, waterfall, ranking)
  rm[le-1]       = rolling spend (peso do WAPT, sem dimensão de mês)
  rw[le-1][mês]  = rolling x wapt (numerador do WAPT)

WAPT em qualquer nível = rw / rm (média ponderada pelo rolling)

Saída: payload.json
"""

import pandas as pd
import json
import os

CSV_DELTA   = "delta_may_june.csv"
CSV_ROLLING = "rolling_spend.csv"
JSON_OUTPUT = "payload.json"

FIXED_COLS = ["Country", "Category", "GPO Category", "Description",
              "Parent Company", "Supplier"]

MONTHS = ["Jan","Feb","Mar","Apr","May","Jun",
          "Jul","Aug","Sep","Oct","Nov","Dec"]

def make_node(key, max_le):
    """Cria um nó com matrizes lm, rm e rw inicializadas em zero."""
    return {
        "key": key,
        "lm": [[0.0]*12 for _ in range(max_le)],
        "rm": [0.0]*max_le,
        "rw": [[0.0]*12 for _ in range(max_le)],
        "suppliers": 0,
        "children": {}
    }

def clean_key(s):
    if s is None or pd.isna(s):
        return ""
    s = str(s).strip()
    if s == "0" or s == "":
        return ""
    return s

def count_suppliers(node):
    if not node["children"]:
        node["suppliers"] = 1
        return 1
    total = 0
    for child in node["children"].values():
        total += count_suppliers(child)
    node["suppliers"] = total
    return total

def main():
    # ── Ler arquivos de entrada ─────────────────────────────
    df_delta = pd.read_csv(CSV_DELTA)
    print(f"delta_may_june.csv: {len(df_delta)} linhas")

    df_rolling = pd.read_csv(CSV_ROLLING)
    print(f"rolling_spend.csv: {len(df_rolling)} linhas")

    le_list = sorted(df_delta["LE"].unique().tolist())
    max_le = max(le_list) if le_list else 12
    countries = sorted(df_delta["Country"].dropna().unique().tolist())

    print(f"LEs: {le_list}")
    print(f"Países: {len(countries)}")

    # ── Lookup de rolling: (dims, LE) -> rolling ────────────
    rolling_lookup = {}
    for _, row in df_rolling.iterrows():
        key = tuple(clean_key(row[c]) for c in FIXED_COLS) + (int(row["LE"]),)
        rolling_lookup[key] = float(row["Rolling Spend"])
    print(f"Rolling lookup: {len(rolling_lookup)} entradas")

    tree = {}

    # ── Pass 1: delta → acumular lm (spend) e rw (rolling×wapt) ──
    print("\nPass 1: acumulando spend e rolling×wapt...")
    for _, row in df_delta.iterrows():
        country = clean_key(row["Country"])
        if not country:
            continue

        month_idx = MONTHS.index(row["Forecast Month"]) if row["Forecast Month"] in MONTHS else -1
        if month_idx < 0:
            continue

        le_idx = int(row["LE"]) - 1
        if le_idx < 0 or le_idx >= max_le:
            continue

        spend = float(row.get("Spend", 0))
        wapt = float(row.get("WAPT", 0))

        # Lookup do rolling para este (fornecedor, LE)
        dims_key = tuple(clean_key(row[c]) for c in FIXED_COLS) + (int(row["LE"]),)
        rolling = rolling_lookup.get(dims_key, 0.0)

        # Nó do país
        if country not in tree:
            tree[country] = make_node(country, max_le)
        country_node = tree[country]
        country_node["lm"][le_idx][month_idx] += spend
        country_node["rw"][le_idx][month_idx] += rolling * wapt

        # Navegar hierarquia: Category → GPO → Description → Parent → Supplier
        path_values = [
            clean_key(row.get("Category", "")),
            clean_key(row.get("GPO Category", "")),
            clean_key(row.get("Description", "")),
            clean_key(row.get("Parent Company", "")),
            clean_key(row.get("Supplier", "")),
        ]

        current = country_node
        for key in path_values:
            if not key:
                break
            if key not in current["children"]:
                current["children"][key] = make_node(key, max_le)
            current = current["children"][key]
            current["lm"][le_idx][month_idx] += spend
            current["rw"][le_idx][month_idx] += rolling * wapt

    # ── Pass 2: rolling → acumular rm (rolling spend) ──────
    print("Pass 2: acumulando rolling spend (rm)...")
    for _, row in df_rolling.iterrows():
        country = clean_key(row["Country"])
        if not country:
            continue

        le_idx = int(row["LE"]) - 1
        if le_idx < 0 or le_idx >= max_le:
            continue

        rolling = float(row["Rolling Spend"])

        # Nó do país
        if country not in tree:
            tree[country] = make_node(country, max_le)
        country_node = tree[country]
        country_node["rm"][le_idx] += rolling

        # Navegar hierarquia
        path_values = [
            clean_key(row.get("Category", "")),
            clean_key(row.get("GPO Category", "")),
            clean_key(row.get("Description", "")),
            clean_key(row.get("Parent Company", "")),
            clean_key(row.get("Supplier", "")),
        ]

        current = country_node
        for key in path_values:
            if not key:
                break
            if key not in current["children"]:
                current["children"][key] = make_node(key, max_le)
            current = current["children"][key]
            current["rm"][le_idx] += rolling

    # ── Propagar contagem de fornecedores (bottom-up) ──────
    print("Contando fornecedores...")
    for country_node in tree.values():
        count_suppliers(country_node)

    # ── Construir payload ──────────────────────────────────
    payload = {
        "tree": tree,
        "countries": countries,
        "le_list": le_list
    }

    with open(JSON_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(payload, f)

    size_mb = os.path.getsize(JSON_OUTPUT) / (1024*1024)
    print(f"\nOutput: {JSON_OUTPUT}")
    print(f"Tamanho: {size_mb:.1f} MB")
    print(f"LEs: {le_list}")

    # ── Verificação: totais por LE no nível raiz ────────────
    print("\nVerificação (nível raiz, todos os países):")
    total_lm = [[0.0]*12 for _ in range(max_le)]
    total_rm = [0.0]*max_le
    total_rw = [[0.0]*12 for _ in range(max_le)]
    for cn in tree.values():
        for j in range(max_le):
            total_rm[j] += cn["rm"][j]
            for m in range(12):
                total_lm[j][m] += cn["lm"][j][m]
                total_rw[j][m] += cn["rw"][j][m]

    for le in le_list:
        j = le - 1
        rolling = total_rm[j]
        spend_jul = total_lm[j][6]  # Jul = índice 6
        # WAPT de Jul = rw[j][6] / rm[j]
        wapt_jul = total_rw[j][6] / rolling if rolling > 0 else 0
        print(f"  LE {le}: Rolling={rolling:,.0f}  "
              f"Spend Jul={spend_jul:,.0f}  WAPT Jul={wapt_jul:.1f}d")

    print("\nCada nó tem lm (spend), rm (rolling) e rw (rolling×wapt).")
    print("WAPT = rw / rm em qualquer nível.")
    print("\nProximo passo: cole o index.html (Parte 3) e o app.js (Parte 4)")

if __name__ == "__main__":
    main()