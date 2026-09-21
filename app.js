var LEVELS = ["Category", "GPO Category", "Description", "Parent Company"];
var MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var N_MONTHS = MONTHS.length; // 9
var H2_START = 3; // Jul (índice 3 da base de 9 meses), H2 = Jul-Dez

/* Paleta: dourado nos destaques, verde/vermelho vivos */
var ABI = {
  ink: "#0F172A", muted: "#94A3B8", blue: "#E0A800",
  green: "#00C853", red: "#FF3B30", focus: "#FFC32D",
  total: "#FFDA6B", grey: "#CBD5E1", greyLight: "#EEF2F8"
};

var state = { payloadIndex: null, payloadTree: {}, selectedCountries: [], drillPath: [], focusMonth: "Jul", viewMode: "mensal", topN: 999999 };
var baseLEOverride = null;

/* LE naming usa meses do calendário (Abr=4, Mai=5, ..., Dez=12).
   leNum é 1-based (Abr=1, Mai=2, ..., Dez=9).
   Mês calendário = leNum + 3. Total = 12. */
function leName(n) { return (n + 3) + "+" + (9 - n); }

var drillTable = null;
var fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
var fmtDays = function(v) { return v.toFixed(1) + "d"; };

function showStatus(msg, isError) {
  var b = document.getElementById("statusBanner");
  if (!b) {
    b = document.createElement("div"); b.id = "statusBanner";
    b.style.cssText = "padding:12px 18px;margin:12px 16px;border-radius:8px;font-size:14px;font-family:sans-serif;white-space:pre-wrap;";
    document.body.prepend(b);
  }
  b.style.background = isError ? "#fff3cd" : "#d1e7dd";
  b.style.color = isError ? "#664d03" : "#0f5132";
  b.textContent = msg;
}
function clearStatus() { var b = document.getElementById("statusBanner"); if (b) b.remove(); }

function focusIdx() { return MONTHS.indexOf(state.focusMonth); }
function leCurrent() { return focusIdx() + 1; }
function lePrevious() { if (baseLEOverride !== null) return baseLEOverride; return focusIdx(); }
function isH2() { return state.viewMode === "h2"; }
function periodLabel() { return isH2() ? "H2" : state.focusMonth; }
function maxLE() {
  var list = state.payloadIndex && state.payloadIndex.le_list, m = N_MONTHS;
  if (list) { for (var i = 0; i < list.length; i++) { if (list[i] > m) m = list[i]; } }
  return m;
}

function getLEVal(node, leNum, monthIdx) {
  if (!node || !node.lm) return 0;
  var idx = leNum - 1;
  if (idx < 0 || idx >= node.lm.length) return 0;
  var row = node.lm[idx];
  if (!row) return 0;
  return row[monthIdx] || 0;
}
function getRolling(node, leNum) {
  if (!node || !node.rm) return 0;
  var idx = leNum - 1;
  if (idx < 0 || idx >= node.rm.length) return 0;
  return node.rm[idx] || 0;
}
function getWAPTVal(node, leNum, monthIdx) {
  if (!node || !node.rw || !node.rm) return 0;
  var idx = leNum - 1;
  if (idx < 0 || idx >= node.rw.length) return 0;
  var row = node.rw[idx];
  if (!row) return 0;
  var rolling = node.rm[idx] || 0;
  if (rolling <= 0) return 0;
  return (row[monthIdx] || 0) / rolling;
}
function getWAPTH2(node, leNum) {
  var sum = 0, count = 0;
  for (var i = H2_START; i < N_MONTHS; i++) { sum += getWAPTVal(node, leNum, i); count++; }
  return count > 0 ? sum / count : 0;
}
function getWAPTCM(node) { var leP = lePrevious(); return isH2() ? getWAPTH2(node, leP) : getWAPTVal(node, leP, focusIdx()); }
function getWAPTCY(node) { var leC = leCurrent(); return isH2() ? getWAPTH2(node, leC) : getWAPTVal(node, leC, focusIdx()); }
function getWAPTGap(node) { return getWAPTCY(node) - getWAPTCM(node); }

function getCMVal(node) {
  var leP = lePrevious(), fi = focusIdx();
  if (isH2()) { var s = 0; for (var i = H2_START; i < N_MONTHS; i++) s += getLEVal(node, leP, i); return s / (N_MONTHS - H2_START); }
  return getLEVal(node, leP, fi);
}
function getCYVal(node) {
  var leC = leCurrent(), fi = focusIdx();
  if (isH2()) { var s = 0; for (var i = H2_START; i < N_MONTHS; i++) s += getLEVal(node, leC, i); return s / (N_MONTHS - H2_START); }
  return getLEVal(node, leC, fi);
}
function getDeltaVal(node) { return getCYVal(node) - getCMVal(node); }

function getLabels() {
  var pl = periodLabel(), leC = leCurrent(), leP = lePrevious();
  var leCn = leName(leC), lePn = leName(leP);
  var h2Range = MONTHS[H2_START] + "-" + MONTHS[N_MONTHS - 1];
  if (!isH2()) {
    return {
      cm: "LE-1 (LE " + lePn + ")", cy: "Actual (LE " + leCn + ")", delta: "Delta",
      cmCol: "LE-1 (LE " + lePn + ")", cyCol: "Actual (LE " + leCn + ")",
      cmSub: pl + " LE " + lePn, cySub: pl + " LE " + leCn, deltaSub: pl,
      waptCMCol: "WAPT LE-1", waptCYCol: "WAPT Actual", waptGapCol: "Gap WAPT",
      waptCMSub: pl + " LE " + lePn + " (dias)", waptCYSub: pl + " LE " + leCn + " (dias)", waptGapSub: pl + " (dias)"
    };
  }
  return {
    cm: "LE-1 H2 (LE " + lePn + ")", cy: "Actual H2 (LE " + leCn + ")", delta: "Delta H2",
    cmCol: "LE-1 H2", cyCol: "Actual H2",
    cmSub: "Média " + h2Range + " LE " + lePn, cySub: "Média " + h2Range + " LE " + leCn, deltaSub: "H2",
    waptCMCol: "WAPT LE-1 H2", waptCYCol: "WAPT Actual H2", waptGapCol: "Gap WAPT H2",
    waptCMSub: "Média " + h2Range + " LE " + lePn + " (dias)", waptCYSub: "Média " + h2Range + " LE " + leCn + " (dias)", waptGapSub: "H2 (dias)"
  };
}

function selectedRootNodes() {
  var t = state.payloadTree;
  if (!state.selectedCountries.length) return Object.keys(t).map(function(s) { return t[s]; }).filter(Boolean);
  return state.selectedCountries.map(function(s) { return t[s]; }).filter(Boolean);
}
function drillNodes() {
  var nodes = selectedRootNodes();
  for (var i = 0; i < state.drillPath.length; i++) {
    var d = state.drillPath[i];
    nodes = nodes.map(function(n) { return n && n.children ? n.children[d.value] : null; }).filter(Boolean);
  }
  return nodes;
}
function aggregateNodes(nodes) {
  var mle = maxLE();
  var lm = []; for (var i = 0; i < mle; i++) lm.push(new Array(N_MONTHS).fill(0));
  var rm = []; for (var i = 0; i < mle; i++) rm.push(0);
  var rw = []; for (var i = 0; i < mle; i++) rw.push(new Array(N_MONTHS).fill(0));
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.lm) { for (var j = 0; j < n.lm.length && j < mle; j++) { var r = n.lm[j]; if (!r) continue; for (var m = 0; m < N_MONTHS; m++) lm[j][m] += r[m] || 0; } }
    if (n.rm) { for (var j = 0; j < n.rm.length && j < mle; j++) rm[j] += n.rm[j] || 0; }
    if (n.rw) { for (var j = 0; j < n.rw.length && j < mle; j++) { var r2 = n.rw[j]; if (!r2) continue; for (var m = 0; m < N_MONTHS; m++) rw[j][m] += r2[m] || 0; } }
  }
  return { lm: lm, rm: rm, rw: rw };
}
function mergeChildren(nodes) {
  var map = new Map();
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i], entries = n.children ? Object.entries(n.children) : [];
    for (var j = 0; j < entries.length; j++) {
      var key = entries[j][0], child = entries[j][1];
      if (!key || key.trim() === "0" || key.trim() === "") continue;
      if (!map.has(key)) map.set(key, { key: key, lm: null, rm: null, rw: null, children: {} });
      var a = map.get(key);
      if (child.lm) {
        if (!a.lm) { a.lm = []; for (var k = 0; k < child.lm.length; k++) a.lm.push(new Array(N_MONTHS).fill(0)); }
        for (var k = 0; k < child.lm.length; k++) { if (!a.lm[k]) a.lm[k] = new Array(N_MONTHS).fill(0); for (var m = 0; m < N_MONTHS; m++) a.lm[k][m] += child.lm[k][m] || 0; }
      }
      if (child.rm) {
        if (!a.rm) { a.rm = []; for (var k = 0; k < child.rm.length; k++) a.rm.push(0); }
        for (var k = 0; k < child.rm.length; k++) { if (!a.rm[k]) a.rm[k] = 0; a.rm[k] += child.rm[k] || 0; }
      }
      if (child.rw) {
        if (!a.rw) { a.rw = []; for (var k = 0; k < child.rw.length; k++) a.rw.push(new Array(N_MONTHS).fill(0)); }
        for (var k = 0; k < child.rw.length; k++) { if (!a.rw[k]) a.rw[k] = new Array(N_MONTHS).fill(0); for (var m = 0; m < N_MONTHS; m++) a.rw[k][m] += child.rw[k][m] || 0; }
      }
    }
  }
  return Array.from(map.values());
}
function nextLevel() { return LEVELS[state.drillPath.length]; }
function isLeaf() { return state.drillPath.length >= LEVELS.length; }

function populateBaseLE() {
  var sel = document.getElementById("baseLESelect");
  if (!sel || !state.payloadIndex) return;
  var cur = leCurrent(), nLE = maxLE();
  if (baseLEOverride !== null && (baseLEOverride < 1 || baseLEOverride > nLE)) baseLEOverride = null;
  if (baseLEOverride !== null && baseLEOverride === cur) baseLEOverride = null;
  var html = '<option value="">LE anterior (padrão)</option>';
  for (var i = 1; i <= nLE; i++) { if (i === cur) continue; html += '<option value="' + i + '">LE ' + leName(i) + '</option>'; }
  sel.innerHTML = html;
  sel.value = baseLEOverride === null ? "" : String(baseLEOverride);
}

function renderAll() {
  populateBaseLE();
  var nodes = drillNodes(), agg = aggregateNodes(nodes);
  renderKPIs(agg); renderWAPTKPIs(agg); renderWaterfall(agg); renderWAPTWaterfall(agg);
  renderRanking(nodes); renderWAPTRanking(nodes); renderTopLists(nodes); renderBreadcrumb(); renderDrillTable(nodes, agg);
}

function renderKPIs(agg) {
  var pl = periodLabel(), cmVal = getCMVal(agg), cyVal = getCYVal(agg);
  var deltaVal = cyVal - cmVal, pctVal = cmVal !== 0 ? (deltaVal / Math.abs(cmVal)) * 100 : 0;
  var labels = getLabels(), leC = leCurrent(), leP = lePrevious(), badge = isH2() ? "H2" : pl;
  document.getElementById("kpiCM").textContent = fmtUSD.format(cmVal);
  document.getElementById("kpiCY").textContent = fmtUSD.format(cyVal);
  document.getElementById("kpiDelta").textContent = fmtUSD.format(deltaVal);
  document.getElementById("kpiDelta").className = "kpi-value " + (deltaVal > 0 ? "positive" : deltaVal < 0 ? "negative" : "");
  document.getElementById("kpiPct").textContent = (pctVal >= 0 ? "+" : "") + pctVal.toFixed(1) + "%";
  document.getElementById("kpiPct").className = "kpi-value " + (pctVal > 0 ? "positive" : pctVal < 0 ? "negative" : "");
  document.getElementById("kpiCMLabel").innerHTML = labels.cm + ' <span class="badge text-bg-secondary">' + badge + '</span>';
  document.getElementById("kpiCYLabel").innerHTML = labels.cy + ' <span class="badge text-bg-warning">' + badge + '</span>';
  document.getElementById("kpiDeltaLabel").innerHTML = labels.delta + ' <span class="badge text-bg-warning">' + badge + '</span>';
  document.getElementById("kpiPctLabel").innerHTML = 'Variação % <span class="badge text-bg-warning">' + badge + '</span>';
  var eCM = document.getElementById("kpiCMSub"); if (eCM) eCM.textContent = labels.cmSub;
  var eCY = document.getElementById("kpiCYSub"); if (eCY) eCY.textContent = labels.cySub;
  var eD = document.getElementById("kpiDeltaSub"); if (eD) eD.textContent = labels.deltaSub;
  var ti = document.getElementById("topIncLabel"); if (ti) ti.textContent = "(" + pl + ")";
  var td = document.getElementById("topDecLabel"); if (td) td.textContent = "(" + pl + ")";
  var sub = document.getElementById("subtitle");
  if (sub) {
    sub.textContent = isH2()
      ? "LE " + leName(leC) + " vs LE " + leName(leP) + " · H2 (Média " + MONTHS[H2_START] + "-" + MONTHS[N_MONTHS - 1] + ") · USD"
      : "LE " + leName(leC) + " vs LE " + leName(leP) + " · " + pl + " · USD";
  }
}

function renderWAPTKPIs(agg) {
  var pl = periodLabel(), labels = getLabels(), badge = isH2() ? "H2" : pl;
  var cmW = getWAPTCM(agg), cyW = getWAPTCY(agg), gapW = cyW - cmW;
  var pctW = cmW !== 0 ? (gapW / Math.abs(cmW)) * 100 : 0;
  var e;
  e = document.getElementById("waptCM"); if (e) e.textContent = fmtDays(cmW);
  e = document.getElementById("waptCY"); if (e) e.textContent = fmtDays(cyW);
  e = document.getElementById("waptGap"); if (e) { e.textContent = (gapW >= 0 ? "+" : "") + fmtDays(gapW); e.className = "kpi-value " + (gapW > 0 ? "positive" : gapW < 0 ? "negative" : ""); }
  e = document.getElementById("waptPct"); if (e) { e.textContent = (pctW >= 0 ? "+" : "") + pctW.toFixed(1) + "%"; e.className = "kpi-value " + (pctW > 0 ? "positive" : pctW < 0 ? "negative" : ""); }
  e = document.getElementById("waptCMLabel"); if (e) e.innerHTML = labels.waptCMCol + ' <span class="badge text-bg-secondary">' + badge + '</span>';
  e = document.getElementById("waptCYLabel"); if (e) e.innerHTML = labels.waptCYCol + ' <span class="badge text-bg-warning">' + badge + '</span>';
  e = document.getElementById("waptGapLabel"); if (e) e.innerHTML = labels.waptGapCol + ' <span class="badge text-bg-warning">' + badge + '</span>';
  e = document.getElementById("waptPctLabel"); if (e) e.innerHTML = 'Var. WAPT % <span class="badge text-bg-warning">' + badge + '</span>';
  e = document.getElementById("waptCMSub"); if (e) e.textContent = labels.waptCMSub;
  e = document.getElementById("waptCYSub"); if (e) e.textContent = labels.waptCYSub;
  e = document.getElementById("waptGapSub"); if (e) e.textContent = labels.waptGapSub;
}

function renderWaterfall(agg) {
  var fi = focusIdx(), leC = leCurrent(), leP = lePrevious();
  var chartMonths, displayDeltas, total;
  if (isH2()) {
    chartMonths = MONTHS.slice(H2_START);
    displayDeltas = [];
    for (var i = H2_START; i < N_MONTHS; i++) {
      displayDeltas.push(getLEVal(agg, leC, i) - getLEVal(agg, leP, i));
    }
  } else {
    chartMonths = MONTHS.slice();
    displayDeltas = [];
    for (var i = 0; i < N_MONTHS; i++) {
      displayDeltas.push(getLEVal(agg, leC, i) - getLEVal(agg, leP, i));
    }
  }
  total = displayDeltas.reduce(function(a, b) { return a + b; }, 0);
  var colors = displayDeltas.map(function(d, i) {
    var monthIdx = isH2() ? i + H2_START : i;
    return monthIdx === fi ? ABI.focus : (d >= 0 ? ABI.green : ABI.red);
  });
  colors.push(ABI.total);
  var xLabels = chartMonths.concat(["Total"]), yValues = displayDeltas.concat([total]);
  var textLabels = yValues.map(function(v) { return Math.abs(v) < 1 ? "" : fmtUSD.format(v); });
  Plotly.react("waterfall", [{
    type: "waterfall", x: xLabels, y: yValues,
    measure: chartMonths.map(function() { return "relative"; }).concat(["total"]),
    connector: { line: { color: ABI.grey, width: 1 } }, marker: { color: colors },
    text: textLabels, textposition: "outside", textfont: { size: 9, color: ABI.ink, family: "Segoe UI, Arial, sans-serif" },
    hovertemplate: "%{x}: %{text}<extra></extra>", cliponaxis: false
  }], {
    margin: { l: 80, r: 40, t: 30, b: 60 }, showlegend: false,
    yaxis: { title: { text: "Delta (USD)", font: { size: 11 } }, tickformat: "$,.0f", automargin: true, tickfont: { size: 9 }, gridcolor: ABI.greyLight },
    xaxis: { type: "category", tickangle: -45, automargin: true, tickfont: { size: 10 } },
    paper_bgcolor: "transparent", plot_bgcolor: "transparent", font: { family: "Segoe UI, Arial, sans-serif", color: ABI.ink }
  }, { displayModeBar: false });
}

function renderWAPTWaterfall(agg) {
  var fi = focusIdx(), leC = leCurrent(), leP = lePrevious();
  var chartMonths, displayDeltas;
  if (isH2()) {
    chartMonths = MONTHS.slice(H2_START);
    displayDeltas = [];
    for (var i = H2_START; i < N_MONTHS; i++) {
      displayDeltas.push(getWAPTVal(agg, leC, i) - getWAPTVal(agg, leP, i));
    }
  } else {
    chartMonths = MONTHS.slice();
    displayDeltas = [];
    for (var i = 0; i < N_MONTHS; i++) {
      displayDeltas.push(getWAPTVal(agg, leC, i) - getWAPTVal(agg, leP, i));
    }
  }
  var colors = displayDeltas.map(function(d, i) {
    var monthIdx = isH2() ? i + H2_START : i;
    return monthIdx === fi ? ABI.focus : (d >= 0 ? ABI.green : ABI.red);
  });
  var textLabels = displayDeltas.map(function(v) { return Math.abs(v) < 0.1 ? "" : (v >= 0 ? "+" : "") + fmtDays(v); });
  var wfCard = document.getElementById("waptWaterfall");
  if (wfCard) { var card = wfCard.closest(".card"); if (card) { var span = card.querySelector(".card-header span.text-muted"); if (span) span.textContent = "(Delta WAPT: Actual - LE-1, em dias)"; } }
  Plotly.react("waptWaterfall", [{
    type: "bar", x: chartMonths, y: displayDeltas, marker: { color: colors },
    text: textLabels, textposition: "outside", cliponaxis: false, textfont: { size: 9, color: ABI.ink, family: "Segoe UI, Arial, sans-serif" },
    hovertemplate: "%{x}: %{text}<extra></extra>"
  }], {
    margin: { l: 60, r: 60, t: 30, b: 60 }, showlegend: false,
    yaxis: { title: { text: "Delta WAPT (dias)", font: { size: 11 } }, automargin: true, tickfont: { size: 9 }, gridcolor: ABI.greyLight, zeroline: true, zerolinewidth: 1, zerolinecolor: ABI.grey },
    xaxis: { type: "category", tickangle: -45, automargin: true, tickfont: { size: 10 } },
    paper_bgcolor: "transparent", plot_bgcolor: "transparent", font: { family: "Segoe UI, Arial, sans-serif", color: ABI.ink }
  }, { displayModeBar: false });
}

function renderRanking(nodes) {
  var pl = periodLabel();
  var byCat = mergeChildren(nodes).map(function(d) { return { key: d.key, delta: getDeltaVal(d) }; }).sort(function(a, b) { return b.delta - a.delta; }).slice(0, state.topN);
  Plotly.react("categoryRanking", [{
    type: "bar", orientation: "h",
    x: byCat.map(function(d) { return d.delta; }), y: byCat.map(function(d) { return d.key; }),
    marker: { color: byCat.map(function(d) { return d.delta >= 0 ? ABI.green : ABI.red; }) },
    text: byCat.map(function(d) { return fmtUSD.format(d.delta); }), textposition: "auto", insidetextanchor: "middle",
    textfont: { size: 10, color: ABI.ink }, automargin: true, hovertemplate: "%{y}: %{text}<extra></extra>", cliponaxis: false
  }], {
    margin: { l: 160, r: 140, t: 15, b: 60 }, showlegend: false,
    xaxis: { title: { text: "Delta " + pl + " (USD)", font: { size: 11 } }, tickformat: "$,.0f", automargin: true, tickfont: { size: 9 }, gridcolor: ABI.greyLight },
    yaxis: { type: "category", automargin: true, tickfont: { size: 10 } },
    paper_bgcolor: "transparent", plot_bgcolor: "transparent", font: { family: "Segoe UI, Arial, sans-serif", color: ABI.ink }
  }, { displayModeBar: false });
}

function renderWAPTRanking(nodes) {
  var pl = periodLabel();
  var byCat = mergeChildren(nodes).map(function(d) { return { key: d.key, gap: getWAPTGap(d) }; }).sort(function(a, b) { return b.gap - a.gap; }).slice(0, state.topN);
  Plotly.react("waptCategoryRanking", [{
    type: "bar", orientation: "h",
    x: byCat.map(function(d) { return d.gap; }), y: byCat.map(function(d) { return d.key; }),
    marker: { color: byCat.map(function(d) { return d.gap >= 0 ? ABI.green : ABI.red; }) },
    text: byCat.map(function(d) { return (d.gap >= 0 ? "+" : "") + fmtDays(d.gap); }), textposition: "auto", insidetextanchor: "middle",
    textfont: { size: 10, color: ABI.ink }, automargin: true, hovertemplate: "%{y}: %{text}<extra></extra>", cliponaxis: false
  }], {
    margin: { l: 160, r: 160, t: 15, b: 60 }, showlegend: false,
    xaxis: { title: { text: "Gap WAPT " + pl + " (dias)", font: { size: 11 } }, automargin: true, tickfont: { size: 9 }, gridcolor: ABI.greyLight, zeroline: true, zerolinewidth: 1, zerolinecolor: ABI.grey },
    yaxis: { type: "category", automargin: true, tickfont: { size: 10 } },
    paper_bgcolor: "transparent", plot_bgcolor: "transparent", font: { family: "Segoe UI, Arial, sans-serif", color: ABI.ink }
  }, { displayModeBar: false });
}

function renderTopLists(nodes) {
  var dim = nextLevel();
  var children = mergeChildren(nodes).map(function(d) { return { key: d.key, delta: getDeltaVal(d) }; });
  var inc = children.filter(function(d) { return d.delta > 0; }).sort(function(a, b) { return b.delta - a.delta; }).slice(0, state.topN);
  var dec = children.filter(function(d) { return d.delta < 0; }).sort(function(a, b) { return a.delta - b.delta; }).slice(0, state.topN);
  document.getElementById("topIncreases").innerHTML = listHTML(inc, dim, "Sem dispersões positivas.");
  document.getElementById("topReductions").innerHTML = listHTML(dec, dim, "Sem dispersões negativas.");
  bindTopClicks();
}
function listHTML(items, dim, emptyMsg) {
  if (!items.length) return '<div class="p-3 text-muted">' + emptyMsg + '</div>';
  return '<div class="top-list">' + items.map(function(it) {
    return '<div class="top-item" data-dim="' + dim + '" data-value="' + escapeHtml(it.key) + '">' +
      '<span class="name">' + escapeHtml(it.key) + '</span>' +
      '<span class="delta ' + (it.delta >= 0 ? 'positive' : 'negative') + '">' + fmtUSD.format(it.delta) + '</span></div>';
  }).join("") + '</div>';
}
function bindTopClicks() {
  document.querySelectorAll(".top-item").forEach(function(el) { el.addEventListener("click", function() { drillInto(el.dataset.dim, el.dataset.value); }); });
}
function renderBreadcrumb() {
  var el = document.getElementById("breadcrumb");
  var cl = state.selectedCountries.length === 1 ? labelOf(state.selectedCountries[0]) : state.selectedCountries.length > 1 ? state.selectedCountries.length + " países" : "Todos os países";
  var html = '<nav class="breadcrumb mb-0">';
  html += '<span class="breadcrumb-item"><a onclick="resetDrill()">' + escapeHtml(cl) + '</a></span>';
  state.drillPath.forEach(function(d, i) {
    if (i === state.drillPath.length - 1) html += '<span class="breadcrumb-item active">' + escapeHtml(d.value) + '</span>';
    else html += '<span class="breadcrumb-item"><a onclick="drillBackTo(' + i + ')">' + escapeHtml(d.value) + '</a></span>';
  });
  html += '</nav>'; el.innerHTML = html;
}
function labelOf(slug) { var cs = state.payloadIndex && state.payloadIndex.countries; for (var i = 0; i < cs.length; i++) { if (cs[i].slug === slug) return cs[i].name; } return slug; }

function renderDrillTable(nodes, agg) {
  var leaf = isLeaf(), dim = nextLevel(), labels = getLabels();
  var fi = focusIdx(), leC = leCurrent(), leP = lePrevious();
  document.getElementById("tableTitle").textContent = leaf ? "Detalhamento por Mês" : "Detalhamento por " + dim + " - " + labels.delta;
  var plainMoney = function(c) { return '<span style="font-weight:600;color:' + ABI.ink + ';">' + fmtUSD.format(c.getValue()) + '</span>'; };
  var deltaMoney = function(c) { var val = c.getValue(); var color = val > 0 ? ABI.green : (val < 0 ? ABI.red : ABI.muted); return '<span style="font-weight:800;color:' + color + ';">' + fmtUSD.format(val) + '</span>'; };
  var waptFmt = function(c) { return '<span style="font-weight:600;color:' + ABI.blue + ';">' + fmtDays(c.getValue()) + '</span>'; };
  var waptGapFmt = function(c) { var val = c.getValue(); var color = val > 0 ? ABI.green : (val < 0 ? ABI.red : ABI.muted); return '<span style="font-weight:800;color:' + color + ';">' + (val >= 0 ? "+" : "") + fmtDays(val) + '</span>'; };
  var rows, cols;
  if (leaf) {
    if (isH2()) {
      rows = [];
      for (var i = H2_START; i < N_MONTHS; i++) {
        rows.push({ month: MONTHS[i], delta: getLEVal(agg, leC, i) - getLEVal(agg, leP, i) });
      }
    } else {
      rows = MONTHS.map(function(m, i) {
        return { month: m, delta: getLEVal(agg, leC, i) - getLEVal(agg, leP, i) };
      });
    }
    cols = [{ title: "Forecast Month", field: "month" }, { title: "Delta", field: "delta", formatter: deltaMoney, hozAlign: "right" }];
  } else {
    rows = mergeChildren(nodes).map(function(d) {
      return { key: d.key, cm: getCMVal(d), cy: getCYVal(d), delta: getDeltaVal(d), waptCM: getWAPTCM(d), waptCY: getWAPTCY(d), waptGap: getWAPTGap(d) };
    }).sort(function(a, b) { return b.delta - a.delta; });
    cols = [
      { title: dim, field: "key", formatter: function(c) { return '<span class="drill-cell">' + escapeHtml(c.getValue()) + '</span>'; } },
      { title: labels.cmCol, field: "cm", formatter: plainMoney, hozAlign: "right" },
      { title: labels.cyCol, field: "cy", formatter: plainMoney, hozAlign: "right" },
      { title: labels.delta, field: "delta", formatter: deltaMoney, hozAlign: "right" },
      { title: labels.waptCMCol, field: "waptCM", formatter: waptFmt, hozAlign: "right" },
      { title: labels.waptCYCol, field: "waptCY", formatter: waptFmt, hozAlign: "right" },
      { title: labels.waptGapCol, field: "waptGap", formatter: waptGapFmt, hozAlign: "right" }
    ];
  }
  if (drillTable) drillTable.destroy();
  drillTable = new Tabulator("#drillTable", {
    data: rows, columns: cols, layout: "fitColumns",
    pagination: !leaf, paginationSize: 15, paginationSizeSelector: [10, 15, 25, 50],
    rowClick: function(e, row) { if (!leaf) drillInto(dim, row.getData().key); }, placeholder: "Sem dados."
  });
}

function drillInto(level, value) { if (isLeaf()) return; state.drillPath.push({ level: level, value: value }); renderAll(); }
function resetDrill() { state.drillPath = []; renderAll(); }
function drillBackTo(index) { state.drillPath = state.drillPath.slice(0, index + 1); renderAll(); }

function buildCountryFilter() {
  var list = document.getElementById("countryList");
  var cs = state.payloadIndex.countries;
  list.innerHTML = cs.map(function(c, i) {
    return '<div class="form-check">' +
      '<input class="form-check-input country-cb" type="checkbox" value="' + escapeHtml(c.slug) + '" id="cb-' + i + '" checked>' +
      '<label class="form-check-label small" for="cb-' + i + '">' + escapeHtml(c.name) + '</label></div>';
  }).join("");
  var all = document.getElementById("countryAll");
  all.addEventListener("change", function() { document.querySelectorAll(".country-cb").forEach(function(cb) { cb.checked = all.checked; }); applyCountrySelection(); });
  document.querySelectorAll(".country-cb").forEach(function(cb) {
    cb.addEventListener("change", function() {
      var anyUn = Array.from(document.querySelectorAll(".country-cb")).some(function(c) { return !c.checked; });
      all.checked = !anyUn; applyCountrySelection();
    });
  });
}
function applyCountrySelection() {
  var checked = Array.from(document.querySelectorAll(".country-cb")).filter(function(cb) { return cb.checked; }).map(function(cb) { return cb.value; });
  var allChecked = checked.length === state.payloadIndex.countries.length;
  state.selectedCountries = allChecked ? [] : checked;
  document.getElementById("countryBtn").textContent = allChecked ? "Todos" : checked.length + " países";
  state.drillPath = []; renderAll();
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function(c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

function init() {
  var fm = document.getElementById("focusMonth");
  fm.innerHTML = MONTHS.map(function(m) { return '<option value="' + m + '" ' + (m === state.focusMonth ? "selected" : "") + '">' + m + '</option>'; }).join("");
  fm.addEventListener("change", function() { state.focusMonth = fm.value; renderAll(); });
  var vm = document.getElementById("viewMode");
  if (vm) vm.addEventListener("change", function() { state.viewMode = vm.value; renderAll(); });
  var bl = document.getElementById("baseLESelect");
  if (bl) bl.addEventListener("change", function() {
    baseLEOverride = bl.value === "" ? null : parseInt(bl.value, 10);
    if (baseLEOverride !== null && baseLEOverride === leCurrent()) { baseLEOverride = null; bl.value = ""; }
    renderAll();
  });
  var rb = document.getElementById("resetBtn");
  if (rb) rb.addEventListener("click", function() { resetDrill(); });
  buildCountryFilter(); renderAll();
  var rankingEl = document.getElementById("categoryRanking");
  if (rankingEl && typeof rankingEl.on === "function") rankingEl.on("plotly_click", function(evt) { drillInto("Category", evt.points[0].y); });
  var waptRankingEl = document.getElementById("waptCategoryRanking");
  if (waptRankingEl && typeof waptRankingEl.on === "function") waptRankingEl.on("plotly_click", function(evt) { drillInto("Category", evt.points[0].y); });
}

async function loadData() {
  try {
    showStatus("Carregando dados...", false);
    var idxRes = await fetch("payload_index.json");
    if (!idxRes.ok) throw new Error("payload_index.json HTTP " + idxRes.status);
    state.payloadIndex = await idxRes.json();
    var cs = state.payloadIndex && state.payloadIndex.countries;
    if (!cs || !cs.length) throw new Error("payload_index.json vazio. Rode: py build_payload_web.py");
    var urls = cs.map(function(c) { return "payloads/" + c.slug + ".json"; });
    var results = await Promise.all(urls.map(function(u) { return fetch(u).then(function(r) { if (!r.ok) throw new Error(u + " HTTP " + r.status); return r.json(); }); }));
    for (var i = 0; i < cs.length; i++) { var p = results[i]; if (p && p.node) state.payloadTree[cs[i].slug] = p.node; }
    clearStatus(); init();
  } catch (e) {
    console.error(e);
    showStatus("ERRO:\n" + e.message + "\nRode: py build_payload_web.py e suba a pasta web/.", true);
  }
}

loadData();