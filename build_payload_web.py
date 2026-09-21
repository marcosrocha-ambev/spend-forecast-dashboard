# build_payload_web.py
# Gera a pasta web/ pronta para o GitHub Pages.
# Divide o payload por pais, arredonda os valores e mantem 4 niveis
# de drill: Category, GPO Category, Description, Parent Company.
# O nivel Supplier e removido para caber no limite de 25 MB.
#
# Uso: py build_payload_web.py

import json
import os
import re
import shutil
import sys
import unicodedata
from collections import defaultdict

SRC = "payload.json"
WEB = "web"
PAYLOADS = os.path.join(WEB, "payloads")
INDEX_HTML = "index.html"
NDIGITS = 0  # 0 = valores inteiros

# Niveis de drill mantidos abaixo do pais.
# 4 = Category, GPO Category, Description, Parent Company.
# Supplier (nivel 5) e removido.
MAX_DRILL_LEVELS = 4

FALLBACK_ASSETS = [
    "index.html", "style.css", "app.js",
    "plotly.min.js", "tabulator.min.js", "tabulator.min.css",
    "bootstrap.min.css", "bootstrap.bundle.min.js"
]

MB = 1024.0 * 1024.0

src_counts = defaultdict(int)
out_counts = defaultdict(int)


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    if f != f or f in (float("inf"), float("-inf")):
        return 0
    r = round(f, NDIGITS)
    return int(r) if NDIGITS == 0 else r


def dense_matrix(mat):
    if not mat:
        return None
    return [[num(v) for v in row] for row in mat if row]


def dense_vector(vec):
    if not vec:
        return None
    return [num(v) for v in vec]


def count_source(node, depth):
    if not node:
        return
    src_counts[depth] += 1
    children = node.get("children") or {}
    for key, child in children.items():
        count_source(child, depth + 1)


def walk(node, depth):
    if not node:
        return None
    out_counts[depth] += 1

    out = {}
    lm = dense_matrix(node.get("lm"))
    rw = dense_matrix(node.get("rw"))
    rm = dense_vector(node.get("rm"))
    if lm is not None:
        out["lm"] = lm
    if rw is not None:
        out["rw"] = rw
    if rm is not None:
        out["rm"] = rm

    children = node.get("children") or {}
    if children and depth < MAX_DRILL_LEVELS:
        kept = {}
        for key, child in children.items():
            name = key.strip()
            if not name or name in ("0", ""):
                continue
            s = walk(child, depth + 1)
            if s is not None:
                kept[name] = s
        if kept:
            out["children"] = kept

    return out or None


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "pais"


def reset_folder(path):
    locked = []
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)
        return locked
    for name in os.listdir(path):
        p = os.path.join(path, name)
        try:
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
                if os.path.exists(p):
                    locked.append(p)
            else:
                os.remove(p)
        except OSError:
            locked.append(p)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as e:
        print("Nao consegui preparar a pasta %s (%s)." % (path, e))
        print("Feche o servidor local, o Explorer e o VS Code nessa pasta e rode de novo.")
        sys.exit(1)
    return locked


def local_assets():
    if not os.path.exists(INDEX_HTML):
        return list(FALLBACK_ASSETS)

    with open(INDEX_HTML, "r", encoding="utf-8", errors="ignore") as f:
        html = f.read()

    refs = re.findall(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', html)
    assets = [INDEX_HTML]
    for ref in refs:
        r = ref.strip()
        if not r:
            continue
        low = r.lower()
        if low.startswith(("http://", "https://", "//", "data:", "mailto:", "#")):
            continue
        r = r.split("?")[0].split("#")[0]
        if r and r not in assets:
            assets.append(r)
    return assets


def main():
    if not os.path.exists(SRC):
        print("Nao encontrei %s. Rode este script na pasta do dashboard." % SRC)
        sys.exit(1)

    src_size = os.path.getsize(SRC) / MB
    print("Lendo %s (%.1f MB, pode levar alguns segundos)..." % (SRC, src_size))
    with open(SRC, "r", encoding="utf-8") as f:
        data = json.load(f)

    tree = data.get("tree") or {}
    le_list = data.get("le_list") or []
    countries = data.get("countries") or list(tree.keys())

    for name in countries:
        node = tree.get(name)
        if node is not None:
            count_source(node, 0)

    locked = reset_folder(PAYLOADS)

    print("Niveis de drill mantidos: %d (Category, GPO Category, Description, Parent Company)" % MAX_DRILL_LEVELS)

    used_slugs = defaultdict(int)
    written = set()
    entries = []

    for name in countries:
        node = tree.get(name)
        if node is None:
            continue
        compact = walk(node, 0)
        if compact is None:
            continue
        slug = slugify(name)
        if used_slugs[slug]:
            slug = slug + "-" + str(used_slugs[slug] + 1)
        used_slugs[slug] += 1

        file_path = os.path.join(PAYLOADS, slug + ".json")
        payload_country = {
            "format": "dense-v1",
            "name": name,
            "node": compact
        }
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(payload_country, f, separators=(",", ":"), ensure_ascii=False)
        except OSError as e:
            print("Falha ao escrever %s (%s)." % (file_path, e))
            print("Feche o programa que esta usando esse arquivo e rode de novo.")
            sys.exit(1)

        written.add(slug + ".json")
        size_mb = os.path.getsize(file_path) / MB
        entries.append({"slug": slug, "name": name, "size_mb": size_mb})

    index = {
        "format": "dense-v1",
        "le_list": le_list,
        "countries": [{"slug": e["slug"], "name": e["name"]} for e in entries]
    }
    index_path = os.path.join(WEB, "payload_index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"), ensure_ascii=False)

    copied = []
    missing = []
    for fname in local_assets():
        if os.path.exists(fname):
            try:
                dest = os.path.join(WEB, fname)
                dest_dir = os.path.dirname(dest)
                if dest_dir:
                    os.makedirs(dest_dir, exist_ok=True)
                shutil.copy2(fname, dest)
                copied.append(fname)
            except OSError as e:
                print("Nao consegui copiar %s (%s)." % (fname, e))
        else:
            missing.append(fname)

    print("")
    print("Arquivos por pais em %s:" % PAYLOADS)
    total = 0.0
    worst = None
    for e in sorted(entries, key=lambda x: -x["size_mb"]):
        total += e["size_mb"]
        flag = ""
        if e["size_mb"] > 25:
            flag = "  !!! ACIMA DE 25 MB"
            worst = e
        print("  %-22s %8.1f MB%s" % (e["name"], e["size_mb"], flag))

    print("")
    print("Indice: %s" % index_path)
    print("Total:  %.1f MB" % total)
    print("Maior arquivo: %.1f MB" % max((e["size_mb"] for e in entries), default=0))

    print("")
    print("Contagem de nos por nivel (origem -> gerado):")
    max_depth = max(list(src_counts.keys()) + list(out_counts.keys()), default=0)
    for d in range(max_depth + 1):
        s = src_counts.get(d, 0)
        o = out_counts.get(d, 0)
        status = "OK" if o == s else ("DIFERENTE" if o < s else "EXTRA")
        print("  nivel %d: %8d -> %8d  (%s)" % (d, s, o, status))

    if copied:
        print("")
        print("Copiados para web/: %s" % ", ".join(copied))
    if missing:
        print("")
        print("AVISO: o index.html referencia arquivos que nao existem na pasta:")
        print("  %s" % ", ".join(missing))

    sobra = []
    if os.path.exists(PAYLOADS):
        for name in os.listdir(PAYLOADS):
            if name.endswith(".json") and name not in written:
                sobra.append(name)
    if sobra:
        print("")
        print("AVISO: sobraram arquivos antigos em payloads/: %s" % ", ".join(sorted(sobra)))

    if locked:
        print("")
        print("AVISO: nao consegui remover: %s" % ", ".join(locked))

    if worst:
        print("")
        print("ATENCAO: %s passou de 25 MB. Reduza MAX_DRILL_LEVELS para 3 e rode de novo." % worst["name"])
    else:
        print("")
        print("Todos os arquivos estao abaixo de 25 MB. Pronto para subir.")


if __name__ == "__main__":
    main()