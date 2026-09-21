/* ============================================================
   le-flex.js — Comparação flexível de LEs (seletor "Comparar com")
   ------------------------------------------------------------
   Instalação: no index.html, logo DEPOIS de app.js:
       <script src="app.js"></script>
       <script src="le-flex.js"></script>

   Funcionalidade:
   - Cria o filtro "Comparar com" na row de filtros, ao lado do Mês de Foco
   - Permite escolher qualquer LE como base (CM): ex. LE 7 vs LE 5, LE 4 vs LE 1
   - Nomenclatura: LE n → "n+(12-n)"  (1+11, 2+10, 3+9, ..., 12+0)
   - Reescreve na tela os labels "LE X" para o formato novo
   - Não altera transform.py nem build_payload.py
   ============================================================ */
(function () {
  "use strict";

  /* ── Estado ─────────────────────────────────────────────── */
  var baseLE = null; /* null = LE anterior (comportamento original) */

  /* LE n → "n+(12-n)": 1 → "1+11", 7 → "7+5", 12 → "12+0" */
  function leName(n) { return n + "+" + (12 - n); }

  function setBase(v) {
    baseLE = v;
    window.baseLEOverride = v; /* espelha para o plano B (app.js editado) */
  }

  /* ── Helpers (tolerantes a payload ainda não carregado) ── */
  function currentLE() {
    try {
      if (typeof window.leCurrent === "function") return window.leCurrent();
      if (typeof window.focusIdx === "function") return window.focusIdx() + 1;
    } catch (e) {}
    return 7;
  }

  function leCount() {
    try {
      if (typeof window.drillNodes === "function") {
        var nodes = window.drillNodes();
        if (nodes && nodes.length && nodes[0] && nodes[0].lm && nodes[0].lm.length) {
          return nodes[0].lm.length;
        }
      }
    } catch (e) {}
    return 12;
  }

  /* ── 1. Interceptar lePrevious (o CM passa a ser o selecionado) ── */
  if (typeof window.lePrevious === "function") {
    var origLePrevious = window.lePrevious;
    window.lePrevious = function () {
      if (baseLE !== null) return baseLE;
      return origLePrevious();
    };
  }

  /* ── 2. Interceptar renderAll para sincronizar a UI ── */
  var origRenderAll = (typeof window.renderAll === "function") ? window.renderAll : null;
  if (origRenderAll) {
    window.renderAll = function () {
      if (baseLE !== null && baseLE === currentLE()) setBase(null);
      var r = origRenderAll.apply(this, arguments);
      syncUI();
      return r;
    };
  }

  /* ── 3. Dropdown "Comparar com" ────────────────────────── */
  function findAnchorCol() {
    var labels = document.querySelectorAll("label");
    for (var i = 0; i < labels.length; i++) {
      var t = (labels[i].textContent || "").toLowerCase();
      if (t.indexOf("mês") > -1 || t.indexOf("foco") > -1 || t.indexOf("visualiza") > -1) {
        var col = labels[i].closest('[class*="col"]');
        if (col && col.parentNode) return col;
      }
    }
    return null;
  }

  function ensureDropdown() {
    if (document.getElementById("baseLESelect")) return;
    var col = document.createElement("div");
    col.className = "col-auto";
    col.innerHTML =
      '<label class="form-label small fw-semibold mb-1" for="baseLESelect">Comparar com</label>' +
      '<select id="baseLESelect" class="form-select" style="min-width:160px"></select>';
    var anchor = findAnchorCol();
    if (anchor) {
      anchor.parentNode.insertBefore(col, anchor.nextSibling);
    } else {
      var row = document.querySelector(".row");
      if (row) row.appendChild(col); else return;
    }
    document.getElementById("baseLESelect").addEventListener("change", function () {
      setBase(this.value === "" ? null : parseInt(this.value, 10));
      if (typeof window.renderAll === "function") window.renderAll();
      else syncUI();
    });
  }

  function populateDropdown() {
    var sel = document.getElementById("baseLESelect");
    if (!sel) return;
    var cur = currentLE(), n = leCount();
    var html = '<option value="">LE anterior (padrão)</option>';
    for (var i = 1; i <= n; i++) {
      if (i === cur) continue; /* não oferece o próprio LE atual como base */
      html += '<option value="' + i + '">LE ' + leName(i) + '</option>';
    }
    sel.innerHTML = html;
    sel.value = baseLE === null ? "" : String(baseLE);
  }

  /* ── 4. Nomenclatura "n+(12-n)" nos textos da tela ───────── */
  /* Idempotente: o lookahead (?!\+) não reconverte "LE 7+5"   */
  var LE_RE = /LE\s*(\d+)(?!\+)/g;

  function applyNaming() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var txt = node.nodeValue;
      if (!txt || txt.indexOf("LE") === -1) continue;
      if (node.parentElement && node.parentElement.closest("#baseLESelect")) continue;
      LE_RE.lastIndex = 0;
      if (!LE_RE.test(txt)) continue;
      LE_RE.lastIndex = 0;
      var out = "", last = 0, m;
      while ((m = LE_RE.exec(txt))) {
        out += txt.slice(last, m.index) + "LE " + leName(parseInt(m[1], 10));
        last = m.index + m[0].length;
      }
      out += txt.slice(last);
      node.nodeValue = out;
    }
  }

  /* ── 5. Sincronização geral ─────────────────────────────── */
  function syncUI() {
    if (baseLE !== null && baseLE === currentLE()) {
      setBase(null);
      if (origRenderAll) origRenderAll(); /* re-render já com a base corrigida */
    }
    ensureDropdown();
    populateDropdown();
    applyNaming();
  }

  /* ── 6. Boot: cobre DOM pronto, payload carregado e reloads ── */
  function boot() { syncUI(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("load", function () { setTimeout(syncUI, 300); });
  setTimeout(syncUI, 1500);

  /* Qualquer mudança de filtro (mês, visualização, países) re-sincroniza */
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "baseLESelect") return;
    setTimeout(syncUI, 50);
  }, true);
})();