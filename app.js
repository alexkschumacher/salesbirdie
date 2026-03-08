/* app.js — salesbirdie Sales Activity Tracker Logic */
(function () {
  "use strict";

  /* ========== COLUMN ORDER ==========
   * Internal data indices (stored per day as array[8]):
   *   0: Cold Calls (Growth)
   *   1: Meetings (Growth)
   *   2: Proposals (Growth)
   *   3: Close Meetings (Growth)
   *   4: Growth POs
   *   5: Existing Client Calls (Maintenance)
   *   6: Maintenance POs
   *   7: (unused, keep 0)
   *
   * Display order (left to right in table):
   *   Cold Calls(0), Meetings(1), Proposals(2), Close(3), Grw PO(4), Exist Call(5), Mnt PO(6)
   */
  var DISPLAY_ORDER = [0, 1, 2, 3, 4, 5, 6];

  // Short labels for table headers (in display order)
  var DISPLAY_LABELS = [
    "Cold Call", "Meeting", "Proposal", "Close", "Grw PO", "Exist Call", "Mnt PO"
  ];

  // Full names for pipeline targets table (in display order)
  var PIPELINE_NAMES = [
    "Cold Calls", "Meetings", "Proposals", "Close Meetings", "Growth POs", "Existing Client Calls", "Maintenance POs"
  ];

  // Aria labels (in display order)
  var ARIA_LABELS = [
    "Cold Calls", "Meetings", "Proposals", "Close Meetings", "Growth POs", "Existing Client Calls", "Maintenance POs"
  ];

  /* ========== SUPABASE CLIENT ========== */
  var SUPABASE_URL = "https://fpbcxfdllgqpwreyycgb.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwYmN4ZmRsbGdxcHdyZXl5Y2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTk0OTQsImV4cCI6MjA4ODQ5NTQ5NH0.nRNi_DUh4-T-8MGc2yDyr7FCLl0RD3IoIDF3Uoy0qmg";
  var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ========== AUTH STATE (local cache, populated from Supabase) ========== */
  var authState = {
    currentUser: null, // { email, name, title, isManager, teamId }
    users: [],         // [{ email, name, title, isManager, teamId, parentUserId }]
    teams: {}          // { teamId: { managerId: email, members: [email...] } }
  };

  /* ========== QUARTER CONSTANTS ========== */
  var WEEKS_PER_QUARTER = 12; // 4 weeks × 3 months

  function createEmptyQuarterWeeks() {
    var arr = [];
    for (var i = 0; i < WEEKS_PER_QUARTER; i++) arr.push(createEmptyWeek());
    return arr;
  }
  function createEmptyQuarterRevs() {
    var arr = [];
    for (var i = 0; i < WEEKS_PER_QUARTER; i++) arr.push(createEmptyRev());
    return arr;
  }

  /* ========== STATE ========== */
  var state = {
    quarterlyBudget: 0,
    avgSaleSize: 0,
    currentWeek: 0,
    dailyData: createEmptyQuarterWeeks(),
    growthRevData: createEmptyQuarterRevs(),
    maintRevData: createEmptyQuarterRevs(),
    convRates: [0.50, 0.50, 0.50, 0.50, 0.50],
    // New state for multi-page expansion
    activeView: "welcome",
    chartMode: "month",
    reminders: [],
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    selectedDate: null,
    teamPeriod: "week",
    growthPct: 0.20,
    maintPct: 0.80
  };

  var DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  // Maps display index to convRate index: -2 means no editable conversion (PO rows)
  var DISPLAY_CONV_MAP = [0, 1, 2, 3, -2, 4, -2];

  var MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  /* ========== CHART COLORS ========== */
  var CHART_COLORS = [
    "#2e7d32",  // green (primary)
    "#e57373",  // coral red
    "#64b5f6",  // sky blue
    "#ffb74d",  // amber
    "#8b5cf6",  // violet
    "#4dd0e1",  // teal
    "#f48fb1",  // pink
    "#a5d6a7",  // light green
    "#ce93d8",  // lavender
    "#fff176"   // yellow
  ];

  /* ========== CHART INSTANCES ========== */
  var trendChartInstance = null;
  var rankingsChartInstance = null;

  function createEmptyWeek() {
    var week = [];
    for (var d = 0; d < 5; d++) { week.push([0, 0, 0, 0, 0, 0, 0, 0]); }
    return week;
  }

  function createEmptyRev() {
    return [0, 0, 0, 0, 0];
  }

  /* ========== BUDGET SPLIT ========== */
  function getMonthlyBudget() { return state.quarterlyBudget / 3; }
  function getWeeklyBudget() { return getMonthlyBudget() / 4.33; }

  function getGrowthWeeklyBudget() { return getWeeklyBudget() * state.growthPct; }
  function getMaintWeeklyBudget() { return getWeeklyBudget() * state.maintPct; }
  function getGrowthMonthlyBudget() { return getMonthlyBudget() * state.growthPct; }
  function getMaintMonthlyBudget() { return getMonthlyBudget() * state.maintPct; }

  function getDealsPerQuarter() {
    if (state.avgSaleSize <= 0) return 0;
    return state.quarterlyBudget / state.avgSaleSize;
  }

  function getDealsPerMonth() { return getDealsPerQuarter() / 3; }
  function getDealsPerWeek() { return getDealsPerMonth() / 4.33; }

  /* ========== AUTO-COMPUTE CONVERSION RATES ========== */
  function computeConversionRates() {
    // Compute conversion rates from actual activity data.
    // Requires minimum 5 total "from" events before overriding default.
    var MIN_SAMPLE = 5;
    var totals = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
      for (var d = 0; d < 5; d++) {
        for (var a = 0; a < 8; a++) {
          totals[a] += state.dailyData[w][d][a];
        }
      }
    }
    // convRates indices: 0=CC->Mtg, 1=Mtg->Prop, 2=Prop->Close, 3=Close->PO, 4=ExistCall->PO
    var pairs = [
      { from: 0, to: 1 }, // Cold Calls -> Meetings
      { from: 1, to: 2 }, // Meetings -> Proposals
      { from: 2, to: 3 }, // Proposals -> Close
      { from: 3, to: 4 }, // Close -> Growth POs
      { from: 5, to: 6 }  // Existing Calls -> Maint POs
    ];
    for (var pi = 0; pi < pairs.length; pi++) {
      var fromTotal = totals[pairs[pi].from];
      var toTotal = totals[pairs[pi].to];
      if (fromTotal >= MIN_SAMPLE) {
        state.convRates[pi] = Math.min(toTotal / fromTotal, 1.0);
      }
      // else keep existing value (default 0.50)
    }
  }

  /* ========== PIPELINE TARGETS (variable conversions) ========== */
  function getPipelineTargets() {
    var c = state.convRates;
    // Growth path
    var growthDealsPerWeek = state.avgSaleSize > 0 ? getGrowthWeeklyBudget() / state.avgSaleSize : 0;
    var closeNeeded = c[3] > 0 ? growthDealsPerWeek / c[3] : 0;
    var proposalsNeeded = c[2] > 0 ? closeNeeded / c[2] : 0;
    var meetingsNeeded = c[1] > 0 ? proposalsNeeded / c[1] : 0;
    var coldCallsNeeded = c[0] > 0 ? meetingsNeeded / c[0] : 0;

    // Maint path
    var maintDealsPerWeek = state.avgSaleSize > 0 ? getMaintWeeklyBudget() / state.avgSaleSize : 0;
    var existCallsNeeded = c[4] > 0 ? maintDealsPerWeek / c[4] : 0;

    // Returns array: [coldCalls, meetings, proposals, closeMtgs, growthPOs, existCalls, maintPOs, unused]
    return [coldCallsNeeded, meetingsNeeded, proposalsNeeded, closeNeeded, growthDealsPerWeek, existCallsNeeded, maintDealsPerWeek, 0];
  }

  function getActualAvgSale() {
    var totalRev = 0;
    var totalPOs = 0;
    for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
      for (var d = 0; d < 5; d++) {
        totalRev += state.growthRevData[w][d] + state.maintRevData[w][d];
        totalPOs += state.dailyData[w][d][4] + state.dailyData[w][d][6]; // Growth POs + Maint POs
      }
    }
    if (totalPOs <= 0) return 0;
    return totalRev / totalPOs;
  }

  /* ========== FORMATTING ========== */
  function formatCurrency(val) {
    if (val === 0 || isNaN(val)) return "$0";
    var neg = val < 0;
    val = Math.abs(val);
    var s = val.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-$" : "$") + s;
  }

  function formatNumber(val, dec) {
    if (dec === undefined) dec = 2;
    if (val === 0 || isNaN(val)) return "0";
    return val.toFixed(dec).replace(/\.?0+$/, "");
  }

  function formatPct(val) {
    if (isNaN(val) || !isFinite(val)) return "0%";
    return Math.round(val) + "%";
  }

  function parseNum(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[^0-9.]/g, "")) || 0;
  }

  function fmtInput(val) {
    if (val === 0 || isNaN(val)) return "";
    return val.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatK(val) {
    if (val >= 1000) return "$" + (val / 1000).toFixed(0) + "k";
    return "$" + val.toFixed(0);
  }

  /* ========== QUARTER HELPERS ========== */
  function getQuarterStartMonth() {
    var m = new Date().getMonth();
    return Math.floor(m / 3) * 3; // 0, 3, 6, or 9
  }

  /** Which month within the quarter (0, 1, 2) does a given week index belong to? */
  function getMonthOfWeek(weekIndex) {
    return Math.floor(weekIndex / 4);
  }

  /** First Monday of a given month */
  function getFirstMondayOfMonth(year, month) {
    var firstDay = new Date(year, month, 1);
    var dow = firstDay.getDay();
    var off = dow === 0 ? 1 : (dow === 1 ? 0 : 8 - dow);
    return new Date(year, month, 1 + off);
  }

  /** Return the 4-week range for the month containing weekIndex */
  function getMonthWeekRange(weekIndex) {
    var start = Math.floor(weekIndex / 4) * 4;
    return { start: start, end: start + 4 };
  }

  /** Determine current week index in the quarter (0-11) based on today */
  function getCurrentQuarterWeekIndex() {
    var now = new Date();
    var year = now.getFullYear();
    var qStartMonth = getQuarterStartMonth();
    var monthInQ = now.getMonth() - qStartMonth;
    // Find which week (0-3) we're in within this month
    var firstMon = getFirstMondayOfMonth(year, now.getMonth());
    var diff = Math.floor((now - firstMon) / (7 * 24 * 60 * 60 * 1000));
    var weekInMonth = Math.max(0, Math.min(3, diff));
    return monthInQ * 4 + weekInMonth;
  }

  /* ========== WEEK DATES ========== */
  function getWeekDates(weekIndex) {
    var now = new Date();
    var year = now.getFullYear();
    var qStartMonth = getQuarterStartMonth();
    var monthOfWeek = getMonthOfWeek(weekIndex);
    var weekInMonth = weekIndex % 4;
    var targetMonth = qStartMonth + monthOfWeek;
    var firstMon = getFirstMondayOfMonth(year, targetMonth);
    var dates = [];
    for (var d = 0; d < 5; d++) {
      var dt = new Date(firstMon);
      dt.setDate(firstMon.getDate() + weekInMonth * 7 + d);
      var mm = dt.getMonth() + 1;
      var dd = dt.getDate();
      dates.push((mm < 10 ? "0" : "") + mm + "/" + (dd < 10 ? "0" : "") + dd);
    }
    return dates;
  }

  /* Returns Date objects for each weekday in a given week index (0-11) of current quarter */
  function getWeekDateObjects(weekIndex) {
    var now = new Date();
    var year = now.getFullYear();
    var qStartMonth = getQuarterStartMonth();
    var monthOfWeek = getMonthOfWeek(weekIndex);
    var weekInMonth = weekIndex % 4;
    var targetMonth = qStartMonth + monthOfWeek;
    var firstMon = getFirstMondayOfMonth(year, targetMonth);
    var dates = [];
    for (var d = 0; d < 5; d++) {
      var dt = new Date(firstMon);
      dt.setDate(firstMon.getDate() + weekInMonth * 7 + d);
      dates.push(dt);
    }
    return dates;
  }

  function getStatusClass(pct) {
    if (pct >= 100) return "status-green";
    if (pct >= 70) return "status-yellow";
    return "status-red";
  }

  /* ========== CSS VARIABLE READING (for Chart.js theming) ========== */
  function getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ========== HIERARCHY ========== */
  function getSubtree(email) {
    var result = [email];
    for (var i = 0; i < authState.users.length; i++) {
      if (authState.users[i].parentUserId === email) {
        result = result.concat(getSubtree(authState.users[i].email));
      }
    }
    return result;
  }

  function getTeamMembers() {
    if (!authState.currentUser || !authState.currentUser.teamId) return [];
    var teamId = authState.currentUser.teamId;
    var members = [];
    for (var i = 0; i < authState.users.length; i++) {
      if (authState.users[i].teamId === teamId) {
        members.push(authState.users[i]);
      }
    }
    return members;
  }

  /* ========== RENDER: KPI CARDS ========== */
  function renderKPIs() {
    var el = function (id) { return document.getElementById(id); };
    el("kpiMonthlyBudget").textContent = formatCurrency(getMonthlyBudget());
    el("kpiWeeklyBudget").textContent = formatCurrency(getWeeklyBudget());
    el("kpiGrowthBudget").textContent = formatCurrency(getGrowthWeeklyBudget());
    el("kpiMaintBudget").textContent = formatCurrency(getMaintWeeklyBudget());
    el("kpiDealsWeek").textContent = formatNumber(getDealsPerWeek());
    var actualAvg = getActualAvgSale();
    el("kpiActualAvgSale").textContent = actualAvg > 0 ? formatCurrency(actualAvg) : "\u2014";
    // Sync split inputs
    var gInput = el("growthPctInput");
    var mInput = el("maintPctInput");
    if (gInput && document.activeElement !== gInput) gInput.value = Math.round(state.growthPct * 100);
    if (mInput && document.activeElement !== mInput) mInput.value = Math.round(state.maintPct * 100);
  }

  /* ========== RENDER: PIPELINE TARGETS ========== */
  function renderPipeline() {
    var targets = getPipelineTargets();
    var tbody = document.getElementById("pipelineBody");

    var html = "";
    for (var di = 0; di < DISPLAY_ORDER.length; di++) {
      var intIdx = DISPLAY_ORDER[di];
      var weekly = targets[intIdx];
      var daily = weekly / 5;
      var convMapIdx = DISPLAY_CONV_MAP[di];

      html += "<tr>";
      html += "<td>" + PIPELINE_NAMES[di] + "</td>";
      html += "<td class=\"num-col\">" + formatNumber(weekly) + "</td>";
      html += "<td class=\"num-col\">" + formatNumber(daily) + "</td>";

      if (convMapIdx >= 0) {
        var pctVal = Math.round(state.convRates[convMapIdx] * 100);
        html += "<td class=\"num-col\"><div class=\"conv-input-wrap\"><input type=\"text\" class=\"conv-input\" data-conv=\"" + convMapIdx + "\" value=\"" + pctVal + "\" inputmode=\"numeric\" aria-label=\"" + PIPELINE_NAMES[di] + " conversion rate\"><span class=\"conv-suffix\">%</span></div></td>";
      } else {
        html += "<td class=\"num-col\"><span class=\"conv-placeholder\">--</span></td>";
      }

      html += "</tr>";
    }
    tbody.innerHTML = html;

    var convInputs = tbody.querySelectorAll(".conv-input");
    for (var ci = 0; ci < convInputs.length; ci++) {
      convInputs[ci].addEventListener("input", handleConvInput);
      convInputs[ci].addEventListener("focus", handleInputFocus);
    }
  }

  function handleConvInput(e) {
    var inp = e.target;
    var idx = parseInt(inp.getAttribute("data-conv"), 10);
    var val = parseInt(inp.value.replace(/[^0-9]/g, ""), 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > 100) val = 100;
    state.convRates[idx] = val / 100;
    renderPipeline();
    renderActivityFooter();
    renderMonthlySummary();
    markUnsaved();
    var newInp = document.querySelector(".conv-input[data-conv=\"" + idx + "\"]");
    if (newInp) {
      newInp.focus();
      newInp.setSelectionRange(newInp.value.length, newInp.value.length);
    }
  }

  /* ========== RENDER: DAILY ACTIVITY LOG ========== */
  function renderActivityLog() {
    var w = state.currentWeek;
    var wd = state.dailyData[w];
    var gr = state.growthRevData[w];
    var mr = state.maintRevData[w];
    var dates = getWeekDates(w);
    var tbody = document.getElementById("activityBody");

    var qMonth = getMonthOfWeek(w) + 1;
    var wInMonth = (w % 4) + 1;
    document.getElementById("weekLabel").textContent = "M" + qMonth + " W" + wInMonth;

    var html = "";
    for (var d = 0; d < 5; d++) {
      html += "<tr>";
      html += "<td class=\"day-cell\">" + DAYS[d] + "</td>";
      html += "<td class=\"date-cell\">" + dates[d] + "</td>";
      for (var di = 0; di < DISPLAY_ORDER.length; di++) {
        var intIdx = DISPLAY_ORDER[di];
        var v = wd[d][intIdx];
        html += "<td class=\"num-col\"><input type=\"text\" data-day=\"" + d + "\" data-act=\"" + intIdx + "\" value=\"" + (v || "") + "\" placeholder=\"0\" inputmode=\"numeric\" aria-label=\"" + DAYS[d] + " " + ARIA_LABELS[di] + "\"></td>";
      }
      html += "<td class=\"num-col\"><input type=\"text\" data-day=\"" + d + "\" data-grev=\"1\" value=\"" + (gr[d] ? fmtInput(gr[d]) : "") + "\" placeholder=\"0\" inputmode=\"numeric\" class=\"rev-input\" aria-label=\"" + DAYS[d] + " Growth Revenue\"></td>";
      html += "<td class=\"num-col\"><input type=\"text\" data-day=\"" + d + "\" data-mrev=\"1\" value=\"" + (mr[d] ? fmtInput(mr[d]) : "") + "\" placeholder=\"0\" inputmode=\"numeric\" class=\"rev-input\" aria-label=\"" + DAYS[d] + " Maint Revenue\"></td>";
      html += "</tr>";
    }
    tbody.innerHTML = html;

    renderActivityFooter();

    var inputs = tbody.querySelectorAll("input[type='text']");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("input", handleActivityInput);
      inputs[i].addEventListener("focus", handleInputFocus);
      inputs[i].addEventListener("blur", handleInputBlur);
    }
  }

  function renderActivityFooter() {
    var w = state.currentWeek;
    var wd = state.dailyData[w];
    var gr = state.growthRevData[w];
    var mr = state.maintRevData[w];
    var targets = getPipelineTargets();
    var tfoot = document.getElementById("activityFoot");

    var totals = [0, 0, 0, 0, 0, 0, 0, 0];
    var totalGrowthRev = 0;
    var totalMaintRev = 0;
    for (var d = 0; d < 5; d++) {
      for (var a = 0; a < 8; a++) { totals[a] += wd[d][a]; }
      totalGrowthRev += gr[d];
      totalMaintRev += mr[d];
    }

    var h = "";

    h += "<tr class=\"row-total\">";
    h += "<td colspan=\"2\">Total</td>";
    for (var di = 0; di < DISPLAY_ORDER.length; di++) {
      h += "<td class=\"num-col\">" + totals[DISPLAY_ORDER[di]] + "</td>";
    }
    h += "<td class=\"num-col\">" + formatCurrency(totalGrowthRev) + "</td>";
    h += "<td class=\"num-col\">" + formatCurrency(totalMaintRev) + "</td>";
    h += "</tr>";

    h += "<tr class=\"row-target\">";
    h += "<td colspan=\"2\">Target</td>";
    for (var di2 = 0; di2 < DISPLAY_ORDER.length; di2++) {
      h += "<td class=\"num-col\">" + formatNumber(targets[DISPLAY_ORDER[di2]]) + "</td>";
    }
    h += "<td class=\"num-col\">" + formatCurrency(getGrowthWeeklyBudget()) + "</td>";
    h += "<td class=\"num-col\">" + formatCurrency(getMaintWeeklyBudget()) + "</td>";
    h += "</tr>";

    h += "<tr class=\"row-pct\">";
    h += "<td colspan=\"2\">%</td>";
    for (var di3 = 0; di3 < DISPLAY_ORDER.length; di3++) {
      var idx = DISPLAY_ORDER[di3];
      var pct = targets[idx] > 0 ? (totals[idx] / targets[idx]) * 100 : 0;
      h += "<td class=\"num-col " + getStatusClass(pct) + "\">" + formatPct(pct) + "</td>";
    }
    var gPct = getGrowthWeeklyBudget() > 0 ? (totalGrowthRev / getGrowthWeeklyBudget()) * 100 : 0;
    h += "<td class=\"num-col " + getStatusClass(gPct) + "\">" + formatPct(gPct) + "</td>";
    var mPct = getMaintWeeklyBudget() > 0 ? (totalMaintRev / getMaintWeeklyBudget()) * 100 : 0;
    h += "<td class=\"num-col " + getStatusClass(mPct) + "\">" + formatPct(mPct) + "</td>";
    h += "</tr>";

    tfoot.innerHTML = h;
  }

  /* ========== RENDER: MONTHLY SUMMARY ========== */
  function renderMonthlySummary() {
    var tbody = document.getElementById("monthlyBody");
    var targets = getPipelineTargets();
    var range = getMonthWeekRange(state.currentWeek);

    var html = "";
    for (var di = 0; di < DISPLAY_ORDER.length; di++) {
      var intIdx = DISPLAY_ORDER[di];
      html += "<tr>";
      html += "<td>" + DISPLAY_LABELS[di] + "</td>";
      var monthTotal = 0;
      for (var w = range.start; w < range.end; w++) {
        var weekSum = 0;
        for (var d = 0; d < 5; d++) { weekSum += state.dailyData[w][d][intIdx]; }
        monthTotal += weekSum;
        html += "<td class=\"num-col\">" + (weekSum || "0") + "</td>";
      }
      html += "<td class=\"num-col total-col\">" + (monthTotal || "0") + "</td>";
      var mt = targets[intIdx] * 4.33;
      html += "<td class=\"num-col target-col\">" + formatNumber(mt) + "</td>";
      html += "</tr>";
    }

    var revMetrics = [
      { name: "Growth Rev", getData: function (w2, d2) { return state.growthRevData[w2][d2]; }, target: getGrowthMonthlyBudget() },
      { name: "Maint Rev", getData: function (w2, d2) { return state.maintRevData[w2][d2]; }, target: getMaintMonthlyBudget() },
      { name: "Total Rev", getData: function (w2, d2) { return state.growthRevData[w2][d2] + state.maintRevData[w2][d2]; }, target: getMonthlyBudget() }
    ];
    for (var ri = 0; ri < revMetrics.length; ri++) {
      var rm = revMetrics[ri];
      html += "<tr class=\"revenue-row\">";
      html += "<td>" + rm.name + "</td>";
      var revMonthTotal = 0;
      for (var w3 = range.start; w3 < range.end; w3++) {
        var revWeekSum = 0;
        for (var d3 = 0; d3 < 5; d3++) { revWeekSum += rm.getData(w3, d3); }
        revMonthTotal += revWeekSum;
        html += "<td class=\"num-col\">" + formatCurrency(revWeekSum) + "</td>";
      }
      html += "<td class=\"num-col total-col\">" + formatCurrency(revMonthTotal) + "</td>";
      html += "<td class=\"num-col target-col\">" + formatCurrency(rm.target) + "</td>";
      html += "</tr>";
    }

    tbody.innerHTML = html;
  }

  /* ========== TREND CHART (Chart.js) ========== */
  function getWeeklyRevenueTotals() {
    var totals = [];
    for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
      var weekRev = 0;
      for (var d = 0; d < 5; d++) {
        weekRev += state.growthRevData[w][d] + state.maintRevData[w][d];
      }
      totals.push(weekRev);
    }
    return totals;
  }

  /** Revenue totals for just the 4 weeks in the month containing weekIndex */
  function getMonthlyRevenueTotals(weekIndex) {
    var range = getMonthWeekRange(weekIndex || state.currentWeek);
    var totals = [];
    for (var w = range.start; w < range.end; w++) {
      var weekRev = 0;
      for (var d = 0; d < 5; d++) {
        weekRev += state.growthRevData[w][d] + state.maintRevData[w][d];
      }
      totals.push(weekRev);
    }
    return totals;
  }

  function getCumulativeValues(arr) {
    var cum = [];
    var running = 0;
    for (var i = 0; i < arr.length; i++) {
      running += arr[i];
      cum.push(running);
    }
    return cum;
  }

  /* Quarter mode: 12 weeks (3 months), cumulative budget + revenue */
  function getQuarterData() {
    var weeklyBudget = getWeeklyBudget();
    var weeklyRevTotals = getWeeklyRevenueTotals();
    var currentWeekIdx = getCurrentQuarterWeekIndex();
    var labels = [];
    var budgetCum = [];
    var revenueCum = [];
    var cumBudget = 0;
    var cumRevenue = 0;

    for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
      cumBudget += weeklyBudget;
      var mInQ = getMonthOfWeek(w) + 1;
      var wInM = (w % 4) + 1;
      labels.push("M" + mInQ + " W" + wInM);
      budgetCum.push(cumBudget);
      if (w <= currentWeekIdx) {
        cumRevenue += weeklyRevTotals[w];
        revenueCum.push(cumRevenue);
      } else {
        revenueCum.push(null);
      }
    }

    return { labels: labels, budget: budgetCum, revenue: revenueCum };
  }

  function renderTrendChart() {
    var canvas = document.getElementById("trendChart");
    if (!canvas) return;

    var textFaint = getCSSVar("--color-text-faint") || "#bab9b4";
    var textMuted = getCSSVar("--color-text-muted") || "#7a7974";
    var divider = getCSSVar("--color-divider") || "#dcd9d5";

    var labels, budgetData, revenueData;

    if (state.chartMode === "quarter") {
      var qd = getQuarterData();
      labels = qd.labels;
      budgetData = qd.budget;
      revenueData = qd.revenue;
    } else {
      var weeklyBudget = getWeeklyBudget();
      labels = ["Week 1", "Week 2", "Week 3", "Week 4"];
      budgetData = [weeklyBudget, weeklyBudget * 2, weeklyBudget * 3, weeklyBudget * 4];
      revenueData = getCumulativeValues(getMonthlyRevenueTotals(state.currentWeek));
    }

    // Determine revenue line color: green if at or above budget pace, red if behind
    var lastRevIdx = -1;
    for (var ri = revenueData.length - 1; ri >= 0; ri--) {
      if (revenueData[ri] != null && revenueData[ri] > 0) { lastRevIdx = ri; break; }
    }
    var revenueColor = "#d32f2f"; // default red
    if (lastRevIdx >= 0 && budgetData[lastRevIdx] != null) {
      revenueColor = revenueData[lastRevIdx] >= budgetData[lastRevIdx] ? "#2e7d32" : "#d32f2f";
    }

    var chartData = {
      labels: labels,
      datasets: [
        {
          label: "Budget Target",
          data: budgetData,
          borderColor: textFaint,
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: state.chartMode === "quarter" ? 2 : 3,
          pointBackgroundColor: textFaint,
          fill: false,
          tension: 0.1
        },
        {
          label: "Actual Revenue",
          data: revenueData,
          borderColor: revenueColor,
          borderWidth: 2.5,
          pointRadius: state.chartMode === "quarter" ? 3 : 4,
          pointBackgroundColor: revenueColor,
          fill: false,
          tension: 0.2,
          spanGaps: false
        }
      ]
    };

    var chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index"
      },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            boxWidth: 12,
            boxHeight: 2,
            padding: 16,
            font: { family: "Inter, system-ui, sans-serif", size: 11 },
            color: textMuted,
            usePointStyle: false
          }
        },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.8)",
          titleFont: { family: "Inter, system-ui, sans-serif", size: 12 },
          bodyFont: { family: "Inter, system-ui, sans-serif", size: 11 },
          padding: 8,
          callbacks: {
            label: function (ctx) {
              if (ctx.parsed.y === null) return null;
              return ctx.dataset.label + ": " + formatK(ctx.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: "Inter, system-ui, sans-serif", size: 11 },
            color: textMuted,
            maxRotation: state.chartMode === "quarter" ? 45 : 0
          },
          border: { color: divider }
        },
        y: {
          grid: {
            color: divider,
            drawBorder: false
          },
          ticks: {
            font: { family: "Inter, system-ui, sans-serif", size: 11 },
            color: textMuted,
            callback: function (value) { return formatK(value); },
            maxTicksLimit: 5
          },
          border: { display: false },
          beginAtZero: true
        }
      }
    };

    if (trendChartInstance) {
      trendChartInstance.data = chartData;
      trendChartInstance.options = chartOptions;
      trendChartInstance.update("none");
    } else {
      trendChartInstance = new Chart(canvas, {
        type: "line",
        data: chartData,
        options: chartOptions
      });
    }
  }

  function destroyTrendChart() {
    if (trendChartInstance) {
      trendChartInstance.destroy();
      trendChartInstance = null;
    }
  }

  /* ========== AUTH FUNCTIONS ========== */

  // Find user in local cache (for team/rankings features)
  function findUser(email) {
    for (var i = 0; i < authState.users.length; i++) {
      if (authState.users[i].email.toLowerCase() === email.toLowerCase()) {
        return authState.users[i];
      }
    }
    return null;
  }

  // Fetch profile from Supabase profiles table
  function fetchProfile(userId) {
    return supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single()
      .then(function (res) { return res.data; });
  }

  // Fetch all profiles for the same team (for rankings, team page, etc.)
  function fetchTeamProfiles(teamId) {
    if (!teamId) return Promise.resolve([]);
    return supabase
      .from("profiles")
      .select("*")
      .eq("team_id", teamId)
      .then(function (res) { return res.data || []; });
  }

  // Load a Supabase profile into authState.currentUser and cache
  function setCurrentUserFromProfile(profile) {
    authState.currentUser = {
      email: profile.email,
      name: profile.full_name,
      title: profile.title || "",
      isManager: profile.is_manager || false,
      teamId: profile.team_id || null
    };
    // Also add to users cache if not already there
    if (!findUser(profile.email)) {
      authState.users.push({
        email: profile.email,
        name: profile.full_name,
        title: profile.title || "",
        isManager: profile.is_manager || false,
        teamId: profile.team_id || null,
        parentUserId: profile.parent_user_id || null
      });
    }
  }

  // Load all team members into local cache
  function loadTeamCache(teamId) {
    return fetchTeamProfiles(teamId).then(function (profiles) {
      profiles.forEach(function (p) {
        if (!findUser(p.email)) {
          authState.users.push({
            email: p.email,
            name: p.full_name,
            title: p.title || "",
            isManager: p.is_manager || false,
            teamId: p.team_id || null,
            parentUserId: p.parent_user_id || null
          });
        }
      });
      // Build teams object
      if (teamId) {
        var manager = profiles.find(function (p) { return p.is_manager; });
        authState.teams[teamId] = {
          managerId: manager ? manager.email : "",
          members: profiles.map(function (p) { return p.email; })
        };
      }
    });
  }

  function handleSignIn(e) {
    e.preventDefault();
    var email = document.getElementById("signinEmail").value.trim();
    var password = document.getElementById("signinPassword").value;
    var errorEl = document.getElementById("signinError");
    var submitBtn = e.target.querySelector(".auth-submit");

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";
    errorEl.style.display = "none";

    supabase.auth.signInWithPassword({ email: email, password: password })
      .then(function (result) {
        if (result.error) {
          errorEl.textContent = result.error.message || "Invalid email or password.";
          errorEl.style.display = "";
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign In";
          return;
        }

        var user = result.data.user;
        return fetchProfile(user.id).then(function (profile) {
          if (!profile) {
            errorEl.textContent = "Account exists but profile not found. Please contact support.";
            errorEl.style.display = "";
            submitBtn.disabled = false;
            submitBtn.textContent = "Sign In";
            return;
          }
          setCurrentUserFromProfile(profile);
          return loadTeamCache(profile.team_id).then(function () {
            submitBtn.disabled = false;
            submitBtn.textContent = "Sign In";
            showApp();
          });
        });
      })
      .catch(function (err) {
        errorEl.textContent = err.message || "Something went wrong. Try again.";
        errorEl.style.display = "";
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In";
      });
  }

  function handleSignUp(e) {
    e.preventDefault();
    var name = document.getElementById("signupName").value.trim();
    var email = document.getElementById("signupEmail").value.trim();
    var password = document.getElementById("signupPassword").value;
    var title = (document.getElementById("signupTitle").value || "").trim();
    var isManager = document.getElementById("signupIsManager").checked;
    var errorEl = document.getElementById("signupError");
    var submitBtn = e.target.querySelector(".auth-submit");

    if (!title) {
      errorEl.textContent = "Title is required.";
      errorEl.style.display = "";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account...";
    errorEl.style.display = "none";

    // Sign up with Supabase Auth
    supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: name,
          title: title,
          is_manager: isManager
        }
      }
    })
      .then(function (result) {
        if (result.error) {
          errorEl.textContent = result.error.message || "Sign up failed.";
          errorEl.style.display = "";
          submitBtn.disabled = false;
          submitBtn.textContent = "Create Account";
          return;
        }

        var user = result.data.user;

        // Check if email confirmation is required
        if (user && !result.data.session) {
          errorEl.textContent = "Check your email for a confirmation link, then sign in.";
          errorEl.style.display = "";
          errorEl.style.color = "var(--color-success)";
          submitBtn.disabled = false;
          submitBtn.textContent = "Create Account";
          return;
        }

        // Check if there's a pending invite profile for this email
        return supabase
          .from("profiles")
          .select("*")
          .eq("email", email)
          .eq("is_pending", true)
          .single()
          .then(function (pendingResult) {
            var pending = pendingResult.data;

            if (pending) {
              // Invited user: update the pending profile with the real auth id
              return supabase
                .from("profiles")
                .update({
                  id: user.id,
                  full_name: name,
                  title: title || pending.title,
                  is_manager: pending.is_manager,
                  is_pending: false
                })
                .eq("email", email)
                .select()
                .single()
                .then(function (updateResult) {
                  var profile = updateResult.data || pending;
                  profile.id = user.id;
                  profile.is_pending = false;
                  setCurrentUserFromProfile(profile);
                  return loadTeamCache(profile.team_id).then(function () {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Create Account";
                    showApp();
                  });
                });
            }

            // No invite found: create a fresh profile
            var teamId = null;
            if (isManager) {
              teamId = "team_" + user.id.substring(0, 8);
            }

            return supabase
              .from("profiles")
              .insert({
                id: user.id,
                email: email,
                full_name: name,
                title: title,
                is_manager: isManager,
                team_id: teamId,
                parent_user_id: null,
                is_pending: false
              })
              .then(function (insertResult) {
                if (insertResult.error) {
                  console.error("Profile insert error:", insertResult.error);
                  return fetchProfile(user.id).then(function (profile) {
                    if (profile) {
                      setCurrentUserFromProfile(profile);
                      return loadTeamCache(profile.team_id).then(function () {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Create Account";
                        showApp();
                      });
                    }
                    errorEl.textContent = "Account created but profile setup failed. Please sign in.";
                    errorEl.style.display = "";
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Create Account";
                  });
                }

                setCurrentUserFromProfile({
                  email: email,
                  full_name: name,
                  title: title,
                  is_manager: isManager,
                  team_id: teamId,
                  parent_user_id: null
                });

                if (teamId) {
                  authState.teams[teamId] = {
                    managerId: email,
                    members: [email]
                  };
                }

                submitBtn.disabled = false;
                submitBtn.textContent = "Create Account";
                showApp();
              });
          });
      })
      .catch(function (err) {
        errorEl.textContent = err.message || "Something went wrong. Try again.";
        errorEl.style.display = "";
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
      });
  }

  /* ========== PER-USER STATE STORAGE (Supabase-backed) ========== */

  /** Get quarter key like "2026-Q1" for the current date */
  function getQuarterKey() {
    var now = new Date();
    var q = Math.floor(now.getMonth() / 3) + 1;
    return now.getFullYear() + "-Q" + q;
  }

  // Local cache for team members' state (populated when Team/Rankings views load)
  var teamStateCache = {}; // keyed by email

  // Cached access token for synchronous use (e.g. beforeunload)
  var _cachedAccessToken = null;

  /** Build the state blob to persist */
  function buildStateBlob() {
    return {
      quarterlyBudget: state.quarterlyBudget,
      avgSaleSize: state.avgSaleSize,
      currentWeek: state.currentWeek,
      dailyData: state.dailyData,
      growthRevData: state.growthRevData,
      maintRevData: state.maintRevData,
      convRates: state.convRates,
      reminders: state.reminders,
      chartMode: state.chartMode,
      growthPct: state.growthPct,
      maintPct: state.maintPct
    };
  }

  /** Refresh the cached access token for synchronous use */
  function refreshCachedToken() {
    supabase.auth.getSession().then(function (res) {
      if (res.data && res.data.session) {
        _cachedAccessToken = res.data.session.access_token;
      }
    });
  }

  /** Update local team cache (no Supabase write — that happens via Save button or flushSave) */
  function syncLocalCache() {
    if (!authState.currentUser) return;
    teamStateCache[authState.currentUser.email] = JSON.parse(JSON.stringify(buildStateBlob()));
  }

  /** Safety-net save on page unload (only fires if user has unsaved changes) */
  function flushSave() {
    if (!authState.currentUser) return;
    // _hasUnsavedChanges is set by markUnsaved(), defined later
    if (typeof _hasUnsavedChanges !== "undefined" && !_hasUnsavedChanges) return;
    var blob = buildStateBlob();
    var body = JSON.stringify({
      user_email: authState.currentUser.email,
      quarter_key: getQuarterKey(),
      state_data: blob,
      updated_at: new Date().toISOString()
    });
    // Use fetch with keepalive for reliable page-unload saves
    try {
      fetch(SUPABASE_URL + "/rest/v1/user_state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + (_cachedAccessToken || SUPABASE_ANON_KEY),
          "Prefer": "resolution=merge-duplicates"
        },
        body: body,
        keepalive: true
      });
    } catch (e) {
      // Fallback
      supabase
        .from("user_state")
        .upsert({
          user_email: authState.currentUser.email,
          quarter_key: getQuarterKey(),
          state_data: blob,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_email,quarter_key" });
    }
  }

  // Safety-net: save unsaved changes on page close
  window.addEventListener("beforeunload", function (e) {
    flushSave();
    if (typeof _hasUnsavedChanges !== "undefined" && _hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /** Load current user's state from Supabase. Returns a Promise<boolean>. */
  function loadUserState(email) {
    return supabase
      .from("user_state")
      .select("state_data")
      .eq("user_email", email)
      .eq("quarter_key", getQuarterKey())
      .single()
      .then(function (res) {
        if (res.data && res.data.state_data) {
          var saved = res.data.state_data;
          state.quarterlyBudget = saved.quarterlyBudget || 0;
          state.avgSaleSize = saved.avgSaleSize || 0;
          state.currentWeek = saved.currentWeek || 0;
          state.dailyData = saved.dailyData || createEmptyQuarterWeeks();
          state.growthRevData = saved.growthRevData || createEmptyQuarterRevs();
          state.maintRevData = saved.maintRevData || createEmptyQuarterRevs();
          state.convRates = saved.convRates || [0.50, 0.50, 0.50, 0.50, 0.50];
          state.reminders = saved.reminders || [];
          state.chartMode = saved.chartMode || "month";
          state.growthPct = saved.growthPct != null ? saved.growthPct : 0.20;
          state.maintPct = saved.maintPct != null ? saved.maintPct : 0.80;
          // Cache locally too
          teamStateCache[email] = JSON.parse(JSON.stringify(saved));
          return true;
        }
        return false;
      })
      .catch(function () {
        return false;
      });
  }

  /** Fetch all team members' state data from Supabase for team/rankings views */
  function loadTeamStateData() {
    if (!authState.currentUser || !authState.currentUser.teamId) {
      return Promise.resolve();
    }

    // Get all emails in this team
    var teamEmails = [];
    var members = getTeamMembers();
    for (var i = 0; i < members.length; i++) {
      teamEmails.push(members[i].email);
    }

    if (teamEmails.length === 0) return Promise.resolve();

    return supabase
      .from("user_state")
      .select("user_email, state_data")
      .eq("quarter_key", getQuarterKey())
      .in("user_email", teamEmails)
      .then(function (res) {
        if (res.data) {
          for (var j = 0; j < res.data.length; j++) {
            var row = res.data[j];
            teamStateCache[row.user_email] = row.state_data;
          }
        }
      })
      .catch(function (err) {
        console.error("Error loading team state:", err);
      });
  }

  function resetStateToDefaults() {
    state.quarterlyBudget = 0;
    state.avgSaleSize = 0;
    state.currentWeek = 0;
    state.dailyData = createEmptyQuarterWeeks();
    state.growthRevData = createEmptyQuarterRevs();
    state.maintRevData = createEmptyQuarterRevs();
    state.convRates = [0.50, 0.50, 0.50, 0.50, 0.50];
    state.reminders = [];
    state.chartMode = "month";
    state.selectedDate = null;
    state.growthPct = 0.20;
    state.maintPct = 0.80;
  }

  function handleLogout() {
    flushSave();
    authState.currentUser = null;
    authState.users = [];
    authState.teams = {};
    teamStateCache = {};
    supabase.auth.signOut().then(function () {
      showLanding();
    }).catch(function () {
      showLanding();
    });
  }

  function showLanding() {
    document.getElementById("landingPage").style.display = "";
    document.getElementById("appShell").style.display = "none";
    // Clear form inputs
    document.getElementById("signinEmail").value = "";
    document.getElementById("signinPassword").value = "";
    document.getElementById("signupName").value = "";
    document.getElementById("signupEmail").value = "";
    document.getElementById("signupPassword").value = "";
    document.getElementById("signupTitle").value = "";
    document.getElementById("signupIsManager").checked = false;
    document.getElementById("signinError").style.display = "none";
    document.getElementById("signupError").style.display = "none";
  }

  function showApp() {
    document.getElementById("landingPage").style.display = "none";
    document.getElementById("appShell").style.display = "";

    // Cache the access token for synchronous use in flushSave
    refreshCachedToken();

    // Load per-user state from Supabase (async)
    loadUserState(authState.currentUser.email).then(function (hasState) {
      if (!hasState) {
        resetStateToDefaults();
        state.currentWeek = getCurrentQuarterWeekIndex();
      }

      // Populate rep identity display from auth
      var repNameEl = document.getElementById("repName");
      var repTitleEl = document.getElementById("repTitle");
      if (repNameEl && authState.currentUser) {
        repNameEl.textContent = authState.currentUser.name;
      }
      if (repTitleEl && authState.currentUser) {
        repTitleEl.textContent = authState.currentUser.title || "";
      }

      // Show/hide Team tab based on manager status
      var teamTab = document.getElementById("teamNavTab");
      if (teamTab) {
        teamTab.style.display = authState.currentUser && authState.currentUser.isManager ? "" : "none";
      }

      // Init app
      initApp();
    });
  }

  function initAuthForms() {
    // Tab switching
    var authTabs = document.querySelectorAll("[data-auth-tab]");
    for (var t = 0; t < authTabs.length; t++) {
      authTabs[t].addEventListener("click", function () {
        var tab = this.getAttribute("data-auth-tab");
        var allTabs = document.querySelectorAll("[data-auth-tab]");
        for (var at = 0; at < allTabs.length; at++) {
          allTabs[at].classList.toggle("active", allTabs[at].getAttribute("data-auth-tab") === tab);
        }
        document.getElementById("signinForm").style.display = tab === "signin" ? "" : "none";
        document.getElementById("signupForm").style.display = tab === "signup" ? "" : "none";
        document.getElementById("signinError").style.display = "none";
        document.getElementById("signupError").style.display = "none";
      });
    }

    document.getElementById("signinForm").addEventListener("submit", handleSignIn);
    document.getElementById("signupForm").addEventListener("submit", handleSignUp);
  }

  /* ========== NAVIGATION ========== */
  function initNav() {
    var tabs = document.querySelectorAll(".nav-tab[data-page]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        switchView(this.getAttribute("data-page"));
      });
    }
  }

  function switchView(name) {
    // Don't allow team view for non-managers
    if (name === "team" && (!authState.currentUser || !authState.currentUser.isManager)) {
      name = "home";
    }

    state.activeView = name;

    // Update tabs
    var tabs = document.querySelectorAll(".nav-tab[data-page]");
    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i].getAttribute("data-page") === name;
      tabs[i].classList.toggle("active", isActive);
      if (isActive) {
        tabs[i].setAttribute("aria-current", "page");
      } else {
        tabs[i].removeAttribute("aria-current");
      }
    }

    // Toggle views
    var views = document.querySelectorAll("[data-view]");
    for (var j = 0; j < views.length; j++) {
      views[j].style.display = views[j].getAttribute("data-view") === name ? "" : "none";
    }

    // Render view-specific content
    if (name === "home") {
      renderWelcome();
    } else if (name === "dashboard") {
      renderTrendChart();
    } else if (name === "calendar") {
      renderCalendar();
      renderReminders();
    } else if (name === "rankings") {
      // Load team data from Supabase before rendering rankings
      loadTeamStateData().then(function () {
        renderRankings();
      });
    } else if (name === "chat") {
      renderChat();
    } else if (name === "team") {
      // Load team data from Supabase before rendering team views
      loadTeamStateData().then(function () {
        renderTeamSummary();
        renderCoachingInsights();
        renderTeamRoster();
      });
    }
  }

  /* ========== WELCOME PAGE ========== */
  function renderWelcome() {
    renderWelcomeHeading();
    renderWelcomeDate();
    renderWelcomeQuarterSummary();
    renderWelcomeCallTarget();
    renderPlaycard();
    renderFocusCard();
    renderWelcomeReminders();
  }

  function renderWelcomeDate() {
    var now = new Date();
    var dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var dateStr = dayNames[now.getDay()] + ", " + MONTH_NAMES[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
    var el = document.getElementById("welcomeDate");
    if (el) el.textContent = dateStr;
  }

  function renderWelcomeQuarterSummary() {
    var quarterRev = 0;
    for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
      for (var d = 0; d < 5; d++) {
        quarterRev += state.growthRevData[w][d] + state.maintRevData[w][d];
      }
    }
    var qBudget = state.quarterlyBudget;
    var el = document.getElementById("welQuarterSummary");
    if (el) {
      var pct = qBudget > 0 ? (quarterRev / qBudget) * 100 : 0;
      var revStyle = pct >= 70 ? "color:var(--color-success);font-weight:600" : "color:#e57373;font-weight:600";
      el.innerHTML = "Quarter revenue: <span style=\"" + revStyle + "\">" + formatCurrency(quarterRev) + "</span> of " + formatCurrency(qBudget) + " budget";
    }
  }

  function renderWelcomeCallTarget() {
    var targets = getPipelineTargets();
    var dailyColdCalls = targets[0] / 5;
    var el = document.getElementById("welCallTarget");
    if (el) {
      el.textContent = "Today's call target: " + formatNumber(dailyColdCalls, 0) + " cold calls";
    }
  }

  /* ========== PLAYCARD ========== */
  function renderPlaycard() {
    var container = document.getElementById("playcardList");
    if (!container) return;

    var targets = getPipelineTargets();
    var w = state.currentWeek;
    var wd = state.dailyData[w];

    // Compute weekly totals for each activity
    var weekTotals = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var d = 0; d < 5; d++) {
      for (var a = 0; a < 8; a++) { weekTotals[a] += wd[d][a]; }
    }

    // Build gaps for display order activities
    var gaps = [];
    for (var di = 0; di < DISPLAY_ORDER.length; di++) {
      var intIdx = DISPLAY_ORDER[di];
      var target = targets[intIdx];
      var actual = weekTotals[intIdx];
      var gap = target - actual;
      gaps.push({
        label: PIPELINE_NAMES[di],
        gap: gap,
        actual: actual,
        target: target,
        onTrack: actual >= target
      });
    }

    // Sort by largest positive gap
    gaps.sort(function (a, b) { return b.gap - a.gap; });

    // Take top 3 behind target
    var behindItems = [];
    for (var gi = 0; gi < gaps.length; gi++) {
      if (gaps[gi].gap > 0 && gaps[gi].target > 0) {
        behindItems.push(gaps[gi]);
        if (behindItems.length >= 3) break;
      }
    }

    if (behindItems.length === 0) {
      container.innerHTML = "<div class=\"playcard-item on-track\"><span class=\"playcard-number\">\u2713</span><span class=\"playcard-text\">You're on track \u2014 keep going!</span></div>";
      return;
    }

    var html = "";
    for (var pi = 0; pi < behindItems.length; pi++) {
      var item = behindItems[pi];
      var needed = Math.ceil(item.gap);
      html += "<div class=\"playcard-item\">";
      html += "<span class=\"playcard-number\">" + (pi + 1) + "</span>";
      html += "<span class=\"playcard-text\"><strong>" + needed + " more " + item.label + "</strong> (" + Math.round(item.actual) + " of " + formatNumber(item.target, 0) + " target)</span>";
      html += "</div>";
    }
    container.innerHTML = html;
  }

  /* ========== FOCUS / INSIGHT CARD ========== */
  function computeFocusInsights() {
    var activityTypes = [
      { name: "cold calls", label: "Cold Calls", idx: 0 },
      { name: "meetings", label: "Meetings", idx: 1 },
      { name: "proposals", label: "Proposals", idx: 2 },
      { name: "close meetings", label: "Close Meetings", idx: 3 },
      { name: "existing client calls", label: "Existing Client Calls", idx: 5 }
    ];

    // Gather all day-level data
    var totalsByType = {};
    var totalRev = 0;
    var daysWithActivity = 0;
    var totalDaysLogged = 0;
    var dailyRevenues = [];

    for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
      for (var d = 0; d < 5; d++) {
        var dayRev = state.growthRevData[w][d] + state.maintRevData[w][d];
        var dayHasAny = false;
        for (var ai = 0; ai < activityTypes.length; ai++) {
          var key = activityTypes[ai].idx;
          if (!totalsByType[key]) totalsByType[key] = 0;
          var v = state.dailyData[w][d][key];
          totalsByType[key] += v;
          if (v > 0) dayHasAny = true;
        }
        // Also check growth POs (4) and maint POs (6)
        if (state.dailyData[w][d][4] > 0 || state.dailyData[w][d][6] > 0) dayHasAny = true;
        if (dayHasAny) {
          daysWithActivity++;
          totalRev += dayRev;
          dailyRevenues.push(dayRev);
        }
        if (dayHasAny || dayRev > 0) totalDaysLogged++;
      }
    }

    if (daysWithActivity === 0) return null;

    var insights = [];

    // 1. Activity volume snapshot: which activity is highest/lowest
    var highest = null;
    var lowest = null;
    for (var ti = 0; ti < activityTypes.length; ti++) {
      var t = activityTypes[ti];
      var total = totalsByType[t.idx] || 0;
      if (total > 0) {
        if (!highest || total > highest.count) highest = { label: t.label, count: total };
        if (!lowest || total < lowest.count) lowest = { label: t.label, count: total };
      }
    }
    if (highest && lowest && highest.label !== lowest.label) {
      insights.push("Your top activity is <strong>" + highest.label + "</strong> (" + highest.count + " total). Consider increasing <strong>" + lowest.label + "</strong> (" + lowest.count + " total) to strengthen your pipeline.");
    } else if (highest) {
      insights.push("You've logged <strong>" + highest.count + " " + highest.label + "</strong> so far. Keep building momentum across all activity types.");
    }

    // 2. Conversion funnel insight (calls → meetings → proposals → closes)
    var calls = totalsByType[0] || 0;
    var meetings = totalsByType[1] || 0;
    var proposals = totalsByType[2] || 0;
    var closes = totalsByType[3] || 0;
    if (calls > 0 && meetings > 0) {
      var callToMeeting = Math.round((meetings / calls) * 100);
      if (callToMeeting < 30) {
        insights.push("Your call-to-meeting conversion is <strong>" + callToMeeting + "%</strong>. Aim for 30%+ by refining your opening pitch and qualifying leads faster.");
      } else {
        insights.push("Strong call-to-meeting conversion at <strong>" + callToMeeting + "%</strong>. Keep up the qualifying discipline.");
      }
    }
    if (meetings > 0 && proposals > 0) {
      var meetToProposal = Math.round((proposals / meetings) * 100);
      if (meetToProposal < 40) {
        insights.push("Meeting-to-proposal rate is <strong>" + meetToProposal + "%</strong>. Try to bring more prepared discovery questions to move deals forward faster.");
      }
    }
    if (proposals > 0 && closes > 0) {
      var proposalToClose = Math.round((closes / proposals) * 100);
      if (proposalToClose < 40) {
        insights.push("Proposal-to-close rate is <strong>" + proposalToClose + "%</strong>. Focus on handling objections and creating urgency in your proposals.");
      }
    }

    // 3. Revenue pacing
    if (state.quarterlyBudget > 0 && totalRev > 0) {
      var weeklyTarget = state.quarterlyBudget / 13;
      var weeksEquiv = daysWithActivity / 5;
      var expectedRev = weeklyTarget * weeksEquiv;
      var pace = Math.round((totalRev / expectedRev) * 100);
      if (pace < 80) {
        insights.push("Revenue is pacing at <strong>" + pace + "%</strong> of target. Focus on closing existing proposals and increasing daily activity volume.");
      } else if (pace >= 100) {
        insights.push("You're pacing at <strong>" + pace + "%</strong> of target. Great momentum \u2014 keep stacking deals.");
      }
    }

    // 4. Activity consistency
    var totalPossibleDays = 20; // 4 weeks x 5 days
    var consistency = Math.round((daysWithActivity / totalPossibleDays) * 100);
    if (daysWithActivity < totalPossibleDays && consistency < 60) {
      insights.push("You've logged activity on <strong>" + daysWithActivity + " of " + totalPossibleDays + " days</strong> (" + consistency + "%). Consistent daily effort compounds results.");
    }

    return insights.length > 0 ? insights : null;
  }

  function renderFocusCard() {
    var container = document.getElementById("focusCard");
    if (!container) return;

    var insights = computeFocusInsights();
    if (!insights) {
      container.innerHTML = "<p class=\"focus-insight\">Log activity data to see your insights.</p>";
      return;
    }

    var html = "";
    for (var i = 0; i < insights.length; i++) {
      html += "<p class=\"focus-insight\">" + insights[i] + "</p>";
    }
    container.innerHTML = html;
  }

  /* ========== WELCOME HEADING (progress-based messages) ========== */
  function renderWelcomeHeading() {
    var el = document.getElementById("welcomeHeading");
    if (!el) return;

    // Compute streak/slump
    var now = new Date();
    var todayDow = now.getDay();
    var weekdayIndex = todayDow - 1;
    if (weekdayIndex < 0) weekdayIndex = 4;

    var w = state.currentWeek;
    var wd = state.dailyData[w];

    var dayHasActivity = [];
    var daysToCheck = Math.min(weekdayIndex + 1, 5);
    for (var d = 0; d < daysToCheck; d++) {
      var hasAny = false;
      for (var a = 0; a < 8; a++) {
        if (wd[d][a] > 0) { hasAny = true; break; }
      }
      dayHasActivity.push(hasAny);
    }

    var streak = 0;
    for (var si = dayHasActivity.length - 1; si >= 0; si--) {
      if (dayHasActivity[si]) { streak++; } else { break; }
    }

    var slump = 0;
    for (var sli = dayHasActivity.length - 1; sli >= 0; sli--) {
      if (!dayHasActivity[sli]) { slump++; } else { break; }
    }

    state._streakCount = streak;
    state._slumpCount = slump;

    // Compute revenue pacing
    var quarterRev = 0;
    for (var qw = 0; qw < WEEKS_PER_QUARTER; qw++) {
      for (var qd = 0; qd < 5; qd++) {
        quarterRev += state.growthRevData[qw][qd] + state.maintRevData[qw][qd];
      }
    }
    var qBudget = state.quarterlyBudget;
    var pct = qBudget > 0 ? (quarterRev / qBudget) * 100 : 0;

    // Has any activity at all?
    var hasAnyActivity = false;
    for (var cw = 0; cw < WEEKS_PER_QUARTER; cw++) {
      for (var cd = 0; cd < 5; cd++) {
        for (var ca = 0; ca < 8; ca++) {
          if (state.dailyData[cw][cd][ca] > 0) { hasAnyActivity = true; break; }
        }
        if (hasAnyActivity) break;
      }
      if (hasAnyActivity) break;
    }

    // Build contextual message
    var msg;
    if (!hasAnyActivity) {
      // No data yet
      msg = "Let's get started. Happy hunting!";
    } else if (streak >= 5) {
      msg = streak + "-day streak \u2014 you're on fire. Happy hunting!";
    } else if (streak >= 3) {
      msg = streak + "-day streak \u2014 keep it rolling. Happy hunting!";
    } else if (pct >= 100) {
      msg = "Budget crushed. Keep stacking. Happy hunting!";
    } else if (pct >= 80) {
      msg = "Almost there \u2014 close it out. Happy hunting!";
    } else if (pct >= 50) {
      msg = "Solid progress. Stay aggressive. Happy hunting!";
    } else if (slump >= 3) {
      msg = "Time to reset. One call changes everything. Happy hunting!";
    } else if (slump >= 2) {
      msg = "One call can restart the engine. Happy hunting!";
    } else if (pct > 0 && pct < 30) {
      msg = "Early innings. Build the pipeline. Happy hunting!";
    } else {
      msg = "Happy hunting!";
    }

    el.textContent = msg;
  }

  /* ========== WELCOME REMINDERS ========== */
  function renderWelcomeReminders() {
    var container = document.getElementById("welcomeRemindersList");
    if (!container) return;

    var todayStr = formatDateKey(new Date());
    var todayReminders = state.reminders.filter(function (r) {
      return r.date === todayStr;
    });

    if (todayReminders.length === 0) {
      container.innerHTML = "<div class=\"cal-empty\">No reminders for today</div>";
      return;
    }

    var html = "";
    for (var i = 0; i < todayReminders.length; i++) {
      var r = todayReminders[i];
      html += "<div class=\"reminder-card\">";
      html += "<div class=\"reminder-info\">";
      html += "<div class=\"reminder-title\">" + escapeHTML(r.title) + " <span class=\"reminder-badge\" data-type=\"" + r.type + "\">" + r.type + "</span></div>";
      if (r.time) {
        html += "<div class=\"reminder-meta\">at " + r.time + "</div>";
      }
      if (r.notes) {
        html += "<div class=\"reminder-notes\">" + escapeHTML(r.notes) + "</div>";
      }
      html += "</div>";
      html += "<button class=\"reminder-done-btn\" data-reminder-id=\"" + r.id + "\">Done</button>";
      html += "</div>";
    }
    container.innerHTML = html;

    var btns = container.querySelectorAll(".reminder-done-btn");
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener("click", function () {
        clearReminder(parseInt(this.getAttribute("data-reminder-id"), 10));
        renderWelcomeReminders();
      });
    }
  }

  function clearAllTodayReminders() {
    var todayStr = formatDateKey(new Date());
    state.reminders = state.reminders.filter(function (r) {
      return r.date !== todayStr;
    });
    renderWelcomeReminders();
  }

  /* ========== CALENDAR ========== */
  function renderCalendar() {
    var year = state.calendarYear;
    var month = state.calendarMonth;

    document.getElementById("calMonthLabel").textContent = MONTH_NAMES[month] + " " + year;

    var grid = document.getElementById("calendarGrid");
    var firstDay = new Date(year, month, 1);
    var lastDay = new Date(year, month + 1, 0);
    var startDow = firstDay.getDay();
    var daysInMonth = lastDay.getDate();
    var today = new Date();

    var activityMap = buildActivityMap();

    var html = "";

    var prevMonthLast = new Date(year, month, 0).getDate();
    for (var p = startDow - 1; p >= 0; p--) {
      html += "<div class=\"calendar-cell cal-other-month\"><span class=\"cal-date-num\">" + (prevMonthLast - p) + "</span></div>";
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var dateObj = new Date(year, month, day);
      var dateKey = dateObj.getFullYear() + "-" + pad2(dateObj.getMonth() + 1) + "-" + pad2(dateObj.getDate());
      var isToday = dateObj.getFullYear() === today.getFullYear() &&
                    dateObj.getMonth() === today.getMonth() &&
                    dateObj.getDate() === today.getDate();
      var isSelected = state.selectedDate &&
                       state.selectedDate.getFullYear() === dateObj.getFullYear() &&
                       state.selectedDate.getMonth() === dateObj.getMonth() &&
                       state.selectedDate.getDate() === dateObj.getDate();
      var hasActivity = activityMap[dateKey];

      var classes = "calendar-cell";
      if (isToday) classes += " cal-today";
      if (isSelected) classes += " cal-selected";

      html += "<div class=\"" + classes + "\" data-cal-date=\"" + dateKey + "\">";
      html += "<span class=\"cal-date-num\">" + day + "</span>";
      if (hasActivity) {
        html += "<div class=\"cal-dot\"></div>";
      }
      html += "</div>";
    }

    var totalCells = startDow + daysInMonth;
    var remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (var tc = 1; tc <= remainingCells; tc++) {
      html += "<div class=\"calendar-cell cal-other-month\"><span class=\"cal-date-num\">" + tc + "</span></div>";
    }

    grid.innerHTML = html;

    var cells = grid.querySelectorAll(".calendar-cell:not(.cal-other-month)");
    for (var c = 0; c < cells.length; c++) {
      cells[c].addEventListener("click", handleCalendarDayClick);
    }

    if (state.selectedDate) {
      renderDayDetail();
    }
  }

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function buildActivityMap() {
    var map = {};
    for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
      var weekDates = getWeekDateObjects(w);
      for (var d = 0; d < 5; d++) {
        var dt = weekDates[d];
        var hasAny = false;
        for (var a = 0; a < 8; a++) {
          if (state.dailyData[w][d][a] > 0) { hasAny = true; break; }
        }
        if (!hasAny && (state.growthRevData[w][d] > 0 || state.maintRevData[w][d] > 0)) {
          hasAny = true;
        }
        if (hasAny) {
          var key = dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
          map[key] = true;
        }
      }
    }
    return map;
  }

  function handleCalendarDayClick(e) {
    var cell = e.currentTarget;
    var dateStr = cell.getAttribute("data-cal-date");
    if (!dateStr) return;
    var parts = dateStr.split("-");
    state.selectedDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));

    var reminderDateInput = document.getElementById("reminderDate");
    if (reminderDateInput) {
      reminderDateInput.value = dateStr;
    }

    renderCalendar();
  }

  function renderDayDetail() {
    var container = document.getElementById("calDayDetail");
    var titleEl = document.getElementById("calDayTitle");
    var contentEl = document.getElementById("calDayContent");

    if (!state.selectedDate) {
      container.style.display = "none";
      return;
    }

    container.style.display = "";
    var d = state.selectedDate;
    titleEl.textContent = MONTH_NAMES[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();

    var matchData = findDayData(d);

    if (!matchData) {
      contentEl.innerHTML = "<p class=\"cal-empty\">No activities logged</p>";
      return;
    }

    var activities = matchData.activities;
    var growthRev = matchData.growthRev;
    var maintRev = matchData.maintRev;

    var html = "<div class=\"cal-detail-grid\">";
    for (var di = 0; di < DISPLAY_ORDER.length; di++) {
      var val = activities[DISPLAY_ORDER[di]];
      html += "<div class=\"cal-detail-item\">";
      html += "<span class=\"cal-detail-label\">" + DISPLAY_LABELS[di] + "</span>";
      html += "<span class=\"cal-detail-value" + (val > 0 ? " has-value" : "") + "\">" + val + "</span>";
      html += "</div>";
    }
    html += "<div class=\"cal-detail-item\">";
    html += "<span class=\"cal-detail-label\">Growth Rev</span>";
    html += "<span class=\"cal-detail-value" + (growthRev > 0 ? " has-value" : "") + "\">" + formatCurrency(growthRev) + "</span>";
    html += "</div>";
    html += "<div class=\"cal-detail-item\">";
    html += "<span class=\"cal-detail-label\">Maint Rev</span>";
    html += "<span class=\"cal-detail-value" + (maintRev > 0 ? " has-value" : "") + "\">" + formatCurrency(maintRev) + "</span>";
    html += "</div>";
    html += "</div>";

    contentEl.innerHTML = html;
  }

  function findDayData(targetDate) {
    for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
      var weekDates = getWeekDateObjects(w);
      for (var d = 0; d < 5; d++) {
        var dt = weekDates[d];
        if (dt.getFullYear() === targetDate.getFullYear() &&
            dt.getMonth() === targetDate.getMonth() &&
            dt.getDate() === targetDate.getDate()) {
          return {
            activities: state.dailyData[w][d],
            growthRev: state.growthRevData[w][d],
            maintRev: state.maintRevData[w][d]
          };
        }
      }
    }
    return null;
  }

  /* ========== REMINDERS ========== */
  function addReminder() {
    var dateVal = document.getElementById("reminderDate").value;
    var timeVal = document.getElementById("reminderTime").value;
    var titleVal = (document.getElementById("reminderTitle").value || "").trim();
    var typeVal = document.getElementById("reminderType").value;
    var notesVal = (document.getElementById("reminderNotes").value || "").trim();

    if (!dateVal || !titleVal) return;

    state.reminders.push({
      id: Date.now(),
      date: dateVal,
      time: timeVal || "",
      title: titleVal,
      type: typeVal,
      notes: notesVal
    });

    state.reminders.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      return 0;
    });

    document.getElementById("reminderTime").value = "";
    document.getElementById("reminderTitle").value = "";
    document.getElementById("reminderNotes").value = "";

    renderReminders();
    markUnsaved();
  }

  function clearReminder(id) {
    state.reminders = state.reminders.filter(function (r) { return r.id !== id; });
    renderReminders();
    markUnsaved();
  }

  function clearAllReminders() {
    state.reminders = [];
    renderReminders();
    markUnsaved();
  }

  function renderReminders() {
    var container = document.getElementById("remindersList");
    if (!container) return;

    var todayStr = formatDateKey(new Date());
    var upcoming = state.reminders.filter(function (r) {
      return r.date >= todayStr;
    });

    if (upcoming.length === 0) {
      container.innerHTML = "<div class=\"cal-empty\">No upcoming reminders</div>";
      return;
    }

    var html = "";
    for (var i = 0; i < upcoming.length; i++) {
      var r = upcoming[i];
      html += "<div class=\"reminder-card\">";
      html += "<div class=\"reminder-info\">";
      html += "<div class=\"reminder-title\">" + escapeHTML(r.title) + " <span class=\"reminder-badge\" data-type=\"" + r.type + "\">" + r.type + "</span></div>";
      html += "<div class=\"reminder-meta\">" + formatReminderDate(r.date) + (r.time ? " at " + r.time : "") + "</div>";
      if (r.notes) {
        html += "<div class=\"reminder-notes\">" + escapeHTML(r.notes) + "</div>";
      }
      html += "</div>";
      html += "<button class=\"reminder-done-btn\" data-reminder-id=\"" + r.id + "\">Done</button>";
      html += "</div>";
    }
    container.innerHTML = html;

    var btns = container.querySelectorAll(".reminder-done-btn");
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener("click", function () {
        clearReminder(parseInt(this.getAttribute("data-reminder-id"), 10));
      });
    }
  }

  function formatDateKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function formatReminderDate(dateStr) {
    var parts = dateStr.split("-");
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return MONTH_NAMES[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function escapeHTML(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ========== RANKINGS ========== */
  function getUserLiveData(userEmail) {
    // Determine which data source to use:
    // - Current user: use live state object
    // - Team members: use teamStateCache (loaded from Supabase)
    var src = null;

    if (authState.currentUser && userEmail === authState.currentUser.email) {
      // Current user: read directly from live state
      src = {
        dailyData: state.dailyData,
        growthRevData: state.growthRevData,
        maintRevData: state.maintRevData,
        quarterlyBudget: state.quarterlyBudget
      };
    } else if (teamStateCache[userEmail]) {
      // Team member: read from cache (fetched from Supabase)
      var cached = teamStateCache[userEmail];
      src = {
        dailyData: cached.dailyData || createEmptyQuarterWeeks(),
        growthRevData: cached.growthRevData || createEmptyQuarterRevs(),
        maintRevData: cached.maintRevData || createEmptyQuarterRevs(),
        quarterlyBudget: cached.quarterlyBudget || 0
      };
    }

    if (src) {
      var weeklyRev = [];
      var totalCalls = 0;
      var totalMeetings = 0;
      var totalProposals = 0;
      var totalPOs = 0;

      for (var w = 0; w < WEEKS_PER_QUARTER; w++) {
        var weekRev = 0;
        for (var d = 0; d < 5; d++) {
          if (src.growthRevData[w]) weekRev += (src.growthRevData[w][d] || 0);
          if (src.maintRevData[w]) weekRev += (src.maintRevData[w][d] || 0);
          if (src.dailyData[w] && src.dailyData[w][d]) {
            totalCalls += src.dailyData[w][d][0] || 0;
            totalMeetings += src.dailyData[w][d][1] || 0;
            totalProposals += src.dailyData[w][d][2] || 0;
            totalPOs += (src.dailyData[w][d][4] || 0) + (src.dailyData[w][d][6] || 0);
          }
        }
        weeklyRev.push(weekRev);
      }

      return {
        weeklyRev: weeklyRev,
        calls: totalCalls,
        meetings: totalMeetings,
        proposals: totalProposals,
        pos: totalPOs,
        budget: src.quarterlyBudget || 0
      };
    }

    // No data available for this user
    var emptyRev = [];
    for (var ew = 0; ew < WEEKS_PER_QUARTER; ew++) emptyRev.push(0);
    return {
      weeklyRev: emptyRev,
      calls: 0,
      meetings: 0,
      proposals: 0,
      pos: 0,
      budget: 0
    };
  }

  function getTeamData() {
    var members = getTeamMembers();
    if (members.length === 0 && authState.currentUser) {
      // Fallback: just show current user
      members = [authState.currentUser];
    }

    var data = [];
    for (var i = 0; i < members.length; i++) {
      var member = members[i];
      var live = getUserLiveData(member.email);
      data.push({
        name: member.name,
        email: member.email,
        budget: live.budget,
        weeklyRev: live.weeklyRev,
        calls: live.calls,
        meetings: live.meetings,
        proposals: live.proposals,
        pos: live.pos,
        color: CHART_COLORS[i % CHART_COLORS.length]
      });
    }
    return data;
  }

  function renderRankings() {
    renderRankingsChart();
    renderRankingsTable();
  }

  function renderRankingsChart() {
    var canvas = document.getElementById("rankingsChart");
    if (!canvas) return;

    var team = getTeamData();
    var textFaint = getCSSVar("--color-text-faint") || "#bab9b4";
    var textMuted = getCSSVar("--color-text-muted") || "#7a7974";
    var divider = getCSSVar("--color-divider") || "#dcd9d5";

    var avgBudget = 0;
    for (var b = 0; b < team.length; b++) { avgBudget += team[b].budget; }
    avgBudget = team.length > 0 ? avgBudget / team.length : 0;
    var monthlyTarget = avgBudget / 3;
    var weeklyTarget = monthlyTarget / 4.33;
    var budgetLine = [weeklyTarget, weeklyTarget * 2, weeklyTarget * 3, weeklyTarget * 4];

    var datasets = [];

    datasets.push({
      label: "Budget Target (Avg)",
      data: budgetLine,
      borderColor: textFaint,
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 2,
      pointBackgroundColor: textFaint,
      fill: false,
      tension: 0.1
    });

    for (var i = 0; i < team.length; i++) {
      var rep = team[i];
      var cumRev = getCumulativeValues(rep.weeklyRev);
      datasets.push({
        label: rep.name,
        data: cumRev,
        borderColor: rep.color,
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: rep.color,
        fill: false,
        tension: 0.2
      });
    }

    var chartData = {
      labels: (function () {
        var l = [];
        for (var wi = 0; wi < WEEKS_PER_QUARTER; wi++) l.push("M" + (getMonthOfWeek(wi) + 1) + " W" + ((wi % 4) + 1));
        return l;
      })(),
      datasets: datasets
    };

    var chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index"
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.8)",
          titleFont: { family: "Inter, system-ui, sans-serif", size: 12 },
          bodyFont: { family: "Inter, system-ui, sans-serif", size: 11 },
          padding: 8,
          callbacks: {
            label: function (ctx) {
              return ctx.dataset.label + ": " + formatK(ctx.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: "Inter, system-ui, sans-serif", size: 11 },
            color: textMuted
          },
          border: { color: divider }
        },
        y: {
          grid: {
            color: divider,
            drawBorder: false
          },
          ticks: {
            font: { family: "Inter, system-ui, sans-serif", size: 11 },
            color: textMuted,
            callback: function (value) { return formatK(value); },
            maxTicksLimit: 5
          },
          border: { display: false },
          beginAtZero: true
        }
      }
    };

    if (rankingsChartInstance) {
      rankingsChartInstance.data = chartData;
      rankingsChartInstance.options = chartOptions;
      rankingsChartInstance.update("none");
    } else {
      rankingsChartInstance = new Chart(canvas, {
        type: "line",
        data: chartData,
        options: chartOptions
      });
    }

    var legendEl = document.getElementById("rankingsLegend");
    var legendHtml = "";
    legendHtml += "<div class=\"rankings-legend-item\"><span class=\"rankings-legend-line\"></span> Budget Target</div>";
    for (var li = 0; li < team.length; li++) {
      var lRep = team[li];
      var isMe = authState.currentUser && lRep.email === authState.currentUser.email;
      legendHtml += "<div class=\"rankings-legend-item\"><span class=\"rankings-legend-dot\" style=\"background:" + lRep.color + "\"></span> " + escapeHTML(lRep.name) + (isMe ? " (You)" : "") + "</div>";
    }
    legendEl.innerHTML = legendHtml;
  }

  function renderRankingsTable() {
    var tbody = document.getElementById("rankingsBody");
    if (!tbody) return;

    var team = getTeamData();
    var html = "";

    for (var i = 0; i < team.length; i++) {
      var rep = team[i];
      var totalRev = 0;
      for (var w = 0; w < rep.weeklyRev.length; w++) { totalRev += rep.weeklyRev[w]; }
      var monthlyBudget = rep.budget / 3;
      var pctBudget = monthlyBudget > 0 ? (totalRev / monthlyBudget) * 100 : 0;
      var isMe = authState.currentUser && rep.email === authState.currentUser.email;

      html += "<tr>";
      html += "<td>" + escapeHTML(rep.name) + (isMe ? " <span style=\"font-size:10px;color:var(--color-primary);font-weight:600;\">(You)</span>" : "") + "</td>";
      html += "<td class=\"num-col\">" + rep.calls + "</td>";
      html += "<td class=\"num-col\">" + rep.meetings + "</td>";
      html += "<td class=\"num-col\">" + rep.pos + "</td>";
      html += "<td class=\"num-col\">" + formatCurrency(totalRev) + "</td>";
      html += "<td class=\"num-col " + getStatusClass(pctBudget) + " budget-pct\">" + formatPct(pctBudget) + "</td>";
      html += "</tr>";
    }

    tbody.innerHTML = html;
  }

  /* ========== TEAM SUMMARY (Manager only) ========== */
  function renderTeamSummary() {
    var tbody = document.getElementById("teamSummaryBody");
    if (!tbody) return;

    var team = getTeamData();
    var period = state.teamPeriod;
    var html = "";

    for (var i = 0; i < team.length; i++) {
      var rep = team[i];
      var totalRev = 0;
      for (var w = 0; w < rep.weeklyRev.length; w++) { totalRev += rep.weeklyRev[w]; }

      // Period scaling: data covers full quarter (12 weeks)
      var periodCalls, periodMeetings, periodProposals, periodPOs, periodRev;
      if (period === "week") {
        periodCalls = Math.round(rep.calls / WEEKS_PER_QUARTER);
        periodMeetings = Math.round(rep.meetings / WEEKS_PER_QUARTER);
        periodProposals = Math.round(rep.proposals / WEEKS_PER_QUARTER);
        periodPOs = Math.round(rep.pos / WEEKS_PER_QUARTER);
        periodRev = totalRev / WEEKS_PER_QUARTER;
      } else if (period === "month") {
        periodCalls = Math.round(rep.calls / 3);
        periodMeetings = Math.round(rep.meetings / 3);
        periodProposals = Math.round(rep.proposals / 3);
        periodPOs = Math.round(rep.pos / 3);
        periodRev = totalRev / 3;
      } else {
        // quarter — raw totals
        periodCalls = rep.calls;
        periodMeetings = rep.meetings;
        periodProposals = rep.proposals;
        periodPOs = rep.pos;
        periodRev = totalRev;
      }

      var qBudget = rep.budget;
      var pctBudget = qBudget > 0 ? (periodRev / (period === "week" ? qBudget / 13 : period === "month" ? qBudget / 3 : qBudget)) * 100 : 0;
      var isMe = authState.currentUser && rep.email === authState.currentUser.email;

      html += "<tr>";
      html += "<td>" + escapeHTML(rep.name) + (isMe ? " <span style=\"font-size:10px;color:var(--color-primary);font-weight:600;\">(You)</span>" : "") + "</td>";
      html += "<td class=\"num-col\">" + periodCalls + "</td>";
      html += "<td class=\"num-col\">" + periodMeetings + "</td>";
      html += "<td class=\"num-col\">" + periodProposals + "</td>";
      html += "<td class=\"num-col\">" + periodPOs + "</td>";
      html += "<td class=\"num-col\">" + formatCurrency(periodRev) + "</td>";
      html += "<td class=\"num-col " + getStatusClass(pctBudget) + " budget-pct\">" + formatPct(pctBudget) + "</td>";
      html += "</tr>";
    }

    tbody.innerHTML = html;
  }

  function initTeam() {
    // Period selector
    var periodBtns = document.querySelectorAll(".team-period-btn");
    for (var p = 0; p < periodBtns.length; p++) {
      periodBtns[p].addEventListener("click", function () {
        var period = this.getAttribute("data-team-period");
        state.teamPeriod = period;
        var allBtns = document.querySelectorAll(".team-period-btn");
        for (var ab = 0; ab < allBtns.length; ab++) {
          allBtns[ab].classList.toggle("active", allBtns[ab].getAttribute("data-team-period") === period);
        }
        renderTeamSummary();
        renderCoachingInsights();
      });
    }

    // Team export dropdown
    var teamExportBtn = document.getElementById("teamExportBtn");
    if (teamExportBtn) {
      teamExportBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var dd = document.getElementById("teamExportDropdown");
        dd.style.display = dd.style.display === "none" ? "" : "none";
      });
    }
    var teamExportOptions = document.querySelectorAll("#teamExportDropdown .export-option");
    for (var teo = 0; teo < teamExportOptions.length; teo++) {
      teamExportOptions[teo].addEventListener("click", function () {
        var period = this.getAttribute("data-export-period");
        document.getElementById("teamExportDropdown").style.display = "none";
        exportTeamCSV(period);
      });
    }

    // Invite rep
    var inviteBtn = document.getElementById("inviteRepBtn");
    if (inviteBtn) {
      inviteBtn.addEventListener("click", handleInviteRep);
    }
  }

  function handleInviteRep() {
    var nameInput = document.getElementById("inviteRepName");
    var titleInput = document.getElementById("inviteRepTitle");
    var emailInput = document.getElementById("inviteRepEmail");
    var managerCheck = document.getElementById("inviteIsManager");
    var msgEl = document.getElementById("inviteMsg");
    var name = (nameInput.value || "").trim();
    var title = (titleInput.value || "").trim();
    var email = (emailInput.value || "").trim();
    var grantManager = managerCheck ? managerCheck.checked : false;

    if (!name || !email || !title) {
      msgEl.textContent = "Please enter name, title, and email.";
      msgEl.style.display = "";
      msgEl.style.color = "var(--color-error)";
      return;
    }

    // Check if already exists in local cache
    if (findUser(email)) {
      msgEl.textContent = "A user with this email already exists.";
      msgEl.style.display = "";
      msgEl.style.color = "var(--color-error)";
      return;
    }

    var teamId = authState.currentUser ? authState.currentUser.teamId : null;
    var parentEmail = authState.currentUser ? authState.currentUser.email : null;

    // Insert a pending profile in Supabase (no auth account yet)
    // The invited person will create their own account via Sign Up,
    // and will be linked to this team when their email matches.
    supabase
      .from("profiles")
      .insert({
        id: crypto.randomUUID(),
        email: email,
        full_name: name,
        title: title,
        is_manager: grantManager,
        team_id: teamId,
        parent_user_id: parentEmail,
        is_pending: true
      })
      .then(function (result) {
        if (result.error) {
          // Might be a duplicate email
          msgEl.textContent = result.error.message || "Could not invite this user.";
          msgEl.style.display = "";
          msgEl.style.color = "var(--color-error)";
          return;
        }

        // Add to local cache
        authState.users.push({
          email: email,
          name: name,
          title: title,
          isManager: grantManager,
          teamId: teamId,
          parentUserId: parentEmail
        });
        if (teamId && authState.teams[teamId]) {
          authState.teams[teamId].members.push(email);
        }

        msgEl.textContent = "Invited " + name + " (" + email + "). They can sign up to join your team.";
        msgEl.style.display = "";
        msgEl.style.color = "var(--color-success)";

        nameInput.value = "";
        titleInput.value = "";
        emailInput.value = "";
        if (managerCheck) managerCheck.checked = false;

        renderTeamRoster();
        renderTeamSummary();
        renderCoachingInsights();
      });
  }

  /* ========== TEAM ROSTER ========== */
  function renderTeamRoster() {
    var container = document.getElementById("teamRoster");
    if (!container) return;

    var members = getTeamMembers();
    if (members.length === 0) {
      container.innerHTML = "<div class=\"cal-empty\">No team members yet.</div>";
      return;
    }

    var currentEmail = authState.currentUser ? authState.currentUser.email : "";
    var html = "";

    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      var isSelf = m.email.toLowerCase() === currentEmail.toLowerCase();

      html += "<div class=\"roster-card" + (isSelf ? " roster-self" : "") + "\">";
      html += "<div class=\"roster-info\">";
      html += "<div class=\"roster-name\">" + escapeHTML(m.name);
      if (m.isManager) {
        html += "<span class=\"roster-badge roster-badge-manager\">Manager</span>";
      }
      if (isSelf) {
        html += "<span class=\"roster-badge\">You</span>";
      }
      html += "</div>";
      html += "<div class=\"roster-meta\">" + escapeHTML(m.title || "") + " &middot; " + escapeHTML(m.email) + "</div>";
      html += "</div>";

      // Actions (only for non-self members)
      if (!isSelf) {
        html += "<div class=\"roster-actions\">";
        html += "<label class=\"roster-toggle\">";
        html += "<input type=\"checkbox\" data-roster-mgr=\"" + escapeHTML(m.email) + "\"" + (m.isManager ? " checked" : "") + ">";
        html += "<span>Manager</span>";
        html += "</label>";
        html += "<button class=\"roster-remove\" data-roster-remove=\"" + escapeHTML(m.email) + "\" title=\"Remove from team\">";
        html += "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg>";
        html += "</button>";
        html += "</div>";
      }

      html += "</div>";
    }

    container.innerHTML = html;

    // Bind toggle manager events
    var toggles = container.querySelectorAll("[data-roster-mgr]");
    for (var ti = 0; ti < toggles.length; ti++) {
      toggles[ti].addEventListener("change", handleToggleManager);
    }

    // Bind remove events
    var removes = container.querySelectorAll("[data-roster-remove]");
    for (var ri = 0; ri < removes.length; ri++) {
      removes[ri].addEventListener("click", handleRemoveRep);
    }
  }

  function handleToggleManager(e) {
    var email = e.target.getAttribute("data-roster-mgr");
    var user = findUser(email);
    if (user) {
      user.isManager = e.target.checked;
      // Update in Supabase too
      supabase
        .from("profiles")
        .update({ is_manager: e.target.checked })
        .eq("email", email)
        .then(function () { /* silent */ });
    }
    renderTeamRoster();
  }

  function handleRemoveRep(e) {
    var btn = e.currentTarget;
    var email = btn.getAttribute("data-roster-remove");
    if (!email) return;

    // Remove from users array
    for (var i = authState.users.length - 1; i >= 0; i--) {
      if (authState.users[i].email.toLowerCase() === email.toLowerCase()) {
        authState.users.splice(i, 1);
        break;
      }
    }

    // Remove from team members
    var teamId = authState.currentUser ? authState.currentUser.teamId : null;
    if (teamId && authState.teams[teamId]) {
      var members = authState.teams[teamId].members;
      for (var j = members.length - 1; j >= 0; j--) {
        if (members[j].toLowerCase() === email.toLowerCase()) {
          members.splice(j, 1);
          break;
        }
      }
    }

    // Remove from local team state cache
    if (teamStateCache[email]) {
      delete teamStateCache[email];
    }

    // Remove from Supabase (clear team assignment)
    supabase
      .from("profiles")
      .update({ team_id: null, parent_user_id: null })
      .eq("email", email)
      .then(function () { /* silent */ });

    renderTeamRoster();
    renderTeamSummary();
    renderCoachingInsights();
  }

  /* ========== COACHING INSIGHTS (Manager) ========== */
  function renderCoachingInsights() {
    var container = document.getElementById("coachingInsights");
    if (!container) return;

    var team = getTeamData();
    // Only show coaching for reps (not the manager themselves, unless solo)
    var reps = [];
    for (var i = 0; i < team.length; i++) {
      reps.push(team[i]);
    }

    if (reps.length === 0) {
      container.innerHTML = "<div class=\"cal-empty\">Add team members to see coaching insights.</div>";
      return;
    }

    var html = "";
    for (var ri = 0; ri < reps.length; ri++) {
      var rep = reps[ri];
      var totalRev = 0;
      for (var wr = 0; wr < rep.weeklyRev.length; wr++) { totalRev += rep.weeklyRev[wr]; }
      var calls = rep.calls;
      var meetings = rep.meetings;
      var pos = rep.pos;
      var budget = rep.budget || 500000;

      var items = [];

      // Funnel analysis
      if (calls > 0 && meetings > 0) {
        var ctm = Math.round((meetings / calls) * 100);
        if (ctm < 25) {
          items.push({ icon: "\u26A0", text: "Call-to-meeting conversion is <strong>" + ctm + "%</strong>. Coach on opener scripts, qualifying questions, and tonality to book more meetings from calls." });
        } else if (ctm >= 40) {
          items.push({ icon: "\u2705", text: "Strong call-to-meeting rate at <strong>" + ctm + "%</strong>. Reinforce current approach and consider sharing techniques with the team." });
        }
      }

      // Activity volume
      if (calls === 0 && meetings === 0 && pos === 0) {
        items.push({ icon: "\u26A0", text: "No activity logged yet. Start with a daily call block and set a minimum of 10 cold calls per day to build pipeline." });
      } else {
        // Weekly call volume
        var avgWeeklyCalls = calls / 4;
        if (avgWeeklyCalls < 15 && calls > 0) {
          items.push({ icon: "\u26A0", text: "Averaging <strong>" + Math.round(avgWeeklyCalls) + " calls/week</strong>. Increasing to 25+ calls/week would significantly expand top-of-funnel opportunities." });
        }
        // Meeting volume
        var avgWeeklyMeetings = meetings / 4;
        if (avgWeeklyMeetings < 3 && meetings > 0) {
          items.push({ icon: "\u26A0", text: "Averaging <strong>" + Math.round(avgWeeklyMeetings) + " meetings/week</strong>. Aim for 5+ to keep the pipeline healthy." });
        }
      }

      // Revenue pacing
      var pctBudget = budget > 0 ? (totalRev / budget) * 100 : 0;
      if (totalRev > 0 && pctBudget < 20) {
        items.push({ icon: "\u26A0", text: "At <strong>" + Math.round(pctBudget) + "%</strong> of quarterly budget. Focus coaching on closing existing proposals and shortening the sales cycle." });
      } else if (pctBudget >= 80) {
        items.push({ icon: "\u2705", text: "Pacing at <strong>" + Math.round(pctBudget) + "%</strong> of budget. Excellent \u2014 keep the momentum and push for stretch targets." });
      }

      // PO production
      if (meetings > 5 && pos === 0) {
        items.push({ icon: "\u26A0", text: "<strong>" + meetings + " meetings</strong> but no POs yet. Review proposal quality and closing technique \u2014 consider ride-alongs to observe meetings firsthand." });
      }

      // If no specific issues, give general encouragement
      if (items.length === 0) {
        items.push({ icon: "\u2705", text: "Performing well across the board. Keep driving consistent daily activity and look for stretch opportunities." });
      }

      // Find the user object to get title
      var repUser = findUser(rep.email);
      var repTitle = repUser ? repUser.title : "";

      html += "<div class=\"coaching-card\">";
      html += "<div class=\"coaching-rep-name\">" + escapeHTML(rep.name) + "</div>";
      if (repTitle) {
        html += "<div class=\"coaching-rep-title\">" + escapeHTML(repTitle) + "</div>";
      }
      for (var ci = 0; ci < items.length; ci++) {
        html += "<div class=\"coaching-item\">";
        html += "<span class=\"coaching-icon\">" + items[ci].icon + "</span>";
        html += "<span class=\"coaching-text\">" + items[ci].text + "</span>";
        html += "</div>";
      }
      html += "</div>";
    }

    container.innerHTML = html;
  }

  /* ========== CHAT ========== */
  var PICKER_EMOJIS = ["\uD83D\uDC4D", "\u2764\uFE0F", "\uD83D\uDE00", "\uD83D\uDE02", "\uD83C\uDFAF", "\u2705", "\uD83D\uDD25", "\uD83C\uDF89", "\uD83D\uDCAA", "\uD83D\uDE4C", "\uD83D\uDE0E", "\uD83D\uDE22", "\uD83D\uDE31", "\uD83E\uDD14", "\uD83D\uDC40", "\uD83C\uDF1F", "\uD83D\uDCA1", "\uD83D\uDC4F"];

  var chatMessages = [
    { id: 1, sender: "salesbirdie", text: "Welcome to team chat. Say hello!", time: "now", reactions: {}, image: null }
  ];
  var chatNextId = 2;
  var openPickerMsgId = null;

  function getCurrentUserName() {
    return authState.currentUser ? authState.currentUser.name : "User";
  }

  function getRepInitials(name) {
    var parts = name.split(" ");
    return parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0][0];
  }

  function getRepColor(name) {
    // Assign color based on name hash
    if (name === "salesbirdie") return "#2e7d32";
    var hash = 0;
    for (var i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash * 31) | 0);
    }
    return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length];
  }

  function renderChat() {
    var container = document.getElementById("chatMessages");
    if (!container) return;

    var currentUserName = getCurrentUserName();

    var html = "";
    for (var i = 0; i < chatMessages.length; i++) {
      var msg = chatMessages[i];
      var isMe = msg.sender === currentUserName;
      var isSystem = msg.sender === "salesbirdie";
      var color = getRepColor(msg.sender);

      html += "<div class=\"chat-msg" + (isMe ? " chat-msg-me" : "") + "\">";
      html += "<div class=\"chat-avatar\" style=\"background:" + color + "\">" + getRepInitials(msg.sender) + "</div>";
      html += "<div class=\"chat-msg-body\">";
      html += "<div class=\"chat-msg-header\">";
      html += "<span class=\"chat-msg-sender\">" + escapeHTML(msg.sender) + (isMe ? " (You)" : "") + (isSystem ? " \uD83E\uDD16" : "") + "</span>";
      html += "<span class=\"chat-msg-time\">" + msg.time + "</span>";
      html += "</div>";
      html += "<div class=\"chat-msg-text\">" + escapeHTML(msg.text) + "</div>";
      if (msg.image) {
        html += "<div class=\"chat-msg-image\"><img src=\"" + msg.image + "\" alt=\"Attached image\"></div>";
      }

      /* Reaction pills — only show emojis that have been reacted to */
      var reactionKeys = Object.keys(msg.reactions);
      if (reactionKeys.length > 0) {
        html += "<div class=\"chat-reactions\">";
        for (var rk = 0; rk < reactionKeys.length; rk++) {
          var rEmoji = reactionKeys[rk];
          var rUsers = msg.reactions[rEmoji];
          if (rUsers && rUsers.length > 0) {
            var iReacted = rUsers.indexOf(currentUserName) !== -1;
            html += "<button class=\"chat-react-btn has-reactions" + (iReacted ? " my-reaction" : "") + "\" data-msg-id=\"" + msg.id + "\" data-emoji=\"" + rEmoji + "\" title=\"" + rUsers.join(", ") + "\">" + rEmoji + " <span>" + rUsers.length + "</span></button>";
          }
        }
        html += "</div>";
      }

      /* React trigger button */
      if (!isSystem) {
        var isPickerOpen = openPickerMsgId === msg.id;
        html += "<div class=\"chat-react-wrapper\">";
        html += "<button class=\"chat-react-trigger" + (isPickerOpen ? " picker-open" : "") + "\" data-msg-id=\"" + msg.id + "\" title=\"Add reaction\">";
        html += "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M8 14s1.5 2 4 2 4-2 4-2\"/><line x1=\"9\" y1=\"9\" x2=\"9.01\" y2=\"9\"/><line x1=\"15\" y1=\"9\" x2=\"15.01\" y2=\"9\"/></svg>";
        html += " React</button>";

        /* Emoji picker popover if open */
        if (isPickerOpen) {
          html += "<div class=\"emoji-picker-popover\">";
          for (var pe = 0; pe < PICKER_EMOJIS.length; pe++) {
            html += "<button data-msg-id=\"" + msg.id + "\" data-pick-emoji=\"" + PICKER_EMOJIS[pe] + "\">" + PICKER_EMOJIS[pe] + "</button>";
          }
          html += "</div>";
        }
        html += "</div>"; /* end chat-react-wrapper */
      }

      html += "</div>"; /* end chat-msg-body */
      html += "</div>"; /* end chat-msg */
    }
    container.innerHTML = html;

    container.scrollTop = container.scrollHeight;

    /* Bind reaction pill click — toggle own reaction */
    var reactBtns = container.querySelectorAll(".chat-react-btn");
    for (var rb = 0; rb < reactBtns.length; rb++) {
      reactBtns[rb].addEventListener("click", handleChatReaction);
    }

    /* Bind React trigger buttons */
    var triggerBtns = container.querySelectorAll(".chat-react-trigger");
    for (var tb = 0; tb < triggerBtns.length; tb++) {
      triggerBtns[tb].addEventListener("click", handleReactTrigger);
    }

    /* Bind emoji picker selections */
    var pickBtns = container.querySelectorAll("[data-pick-emoji]");
    for (var pb = 0; pb < pickBtns.length; pb++) {
      pickBtns[pb].addEventListener("click", handlePickEmoji);
    }
  }

  function handleChatReaction(e) {
    e.stopPropagation();
    var btn = e.currentTarget;
    var msgId = parseInt(btn.getAttribute("data-msg-id"), 10);
    var emoji = btn.getAttribute("data-emoji");
    var userName = getCurrentUserName();
    for (var i = 0; i < chatMessages.length; i++) {
      if (chatMessages[i].id === msgId) {
        var users = chatMessages[i].reactions[emoji];
        if (!users) users = [];
        var idx = users.indexOf(userName);
        if (idx !== -1) {
          users.splice(idx, 1);
        } else {
          users.push(userName);
        }
        if (users.length === 0) {
          delete chatMessages[i].reactions[emoji];
        } else {
          chatMessages[i].reactions[emoji] = users;
        }
        break;
      }
    }
    renderChat();
  }

  function handleReactTrigger(e) {
    e.stopPropagation();
    var msgId = parseInt(e.currentTarget.getAttribute("data-msg-id"), 10);
    openPickerMsgId = openPickerMsgId === msgId ? null : msgId;
    renderChat();
  }

  function handlePickEmoji(e) {
    e.stopPropagation();
    var btn = e.currentTarget;
    var msgId = parseInt(btn.getAttribute("data-msg-id"), 10);
    var emoji = btn.getAttribute("data-pick-emoji");
    var userName = getCurrentUserName();
    for (var i = 0; i < chatMessages.length; i++) {
      if (chatMessages[i].id === msgId) {
        if (!chatMessages[i].reactions[emoji]) {
          chatMessages[i].reactions[emoji] = [];
        }
        var users = chatMessages[i].reactions[emoji];
        var idx = users.indexOf(userName);
        if (idx !== -1) {
          users.splice(idx, 1);
          if (users.length === 0) delete chatMessages[i].reactions[emoji];
        } else {
          users.push(userName);
        }
        break;
      }
    }
    openPickerMsgId = null;
    renderChat();
  }

  /* Close picker when clicking outside */
  document.addEventListener("click", function (e) {
    if (openPickerMsgId !== null && !e.target.closest(".chat-react-wrapper")) {
      openPickerMsgId = null;
      renderChat();
    }
  });

  function sendChatMessage(text, imageUrl) {
    if (!text && !imageUrl) return;
    var now = new Date();
    var hours = now.getHours();
    var mins = now.getMinutes();
    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    var timeStr = hours + ":" + (mins < 10 ? "0" : "") + mins + " " + ampm;

    var senderName = getCurrentUserName();

    chatMessages.push({
      id: chatNextId++,
      sender: senderName,
      text: text || "",
      time: timeStr,
      reactions: {},
      image: imageUrl || null
    });
    renderChat();
  }

  function initChat() {
    var input = document.getElementById("chatInput");
    var sendBtn = document.getElementById("chatSendBtn");
    var imageInput = document.getElementById("chatImageInput");

    if (!input || !sendBtn) return;

    function doSend() {
      var text = (input.value || "").trim();
      if (text) {
        sendChatMessage(text, null);
        input.value = "";
      }
    }

    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        doSend();
      }
    });

    if (imageInput) {
      imageInput.addEventListener("change", function () {
        var file = this.files && this.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          sendChatMessage("", ev.target.result);
        };
        reader.readAsDataURL(file);
        this.value = "";
      });
    }

  }

  /* ========== RENDER ALL ========== */
  function renderAll() {
    renderKPIs();
    renderPipeline();
    renderActivityLog();
    renderMonthlySummary();
    if (state.activeView === "dashboard") {
      renderTrendChart();
    }
  }

  /* ========== EVENT HANDLERS ========== */
  function handleActivityInput(e) {
    var inp = e.target;
    var day = parseInt(inp.getAttribute("data-day"), 10);
    var isGrev = inp.getAttribute("data-grev");
    var isMrev = inp.getAttribute("data-mrev");

    if (isGrev) {
      state.growthRevData[state.currentWeek][day] = parseNum(inp.value);
    } else if (isMrev) {
      state.maintRevData[state.currentWeek][day] = parseNum(inp.value);
    } else {
      var act = parseInt(inp.getAttribute("data-act"), 10);
      state.dailyData[state.currentWeek][day][act] = parseInt(inp.value.replace(/[^0-9]/g, ""), 10) || 0;
    }
    // Re-compute conversion rates when activity changes
    computeConversionRates();
    renderActivityFooter();
    renderMonthlySummary();
    renderPipeline();
    var actualAvg = getActualAvgSale();
    document.getElementById("kpiActualAvgSale").textContent = actualAvg > 0 ? formatCurrency(actualAvg) : "\u2014";

    if (state.activeView === "dashboard") {
      renderTrendChart();
    }

    markUnsaved();
  }

  function handleInputFocus(e) { e.target.select(); }

  function handleInputBlur(e) {
    var inp = e.target;
    var day = parseInt(inp.getAttribute("data-day"), 10);
    var isGrev = inp.getAttribute("data-grev");
    var isMrev = inp.getAttribute("data-mrev");
    if (isGrev) {
      var gv = state.growthRevData[state.currentWeek][day];
      inp.value = gv ? fmtInput(gv) : "";
    } else if (isMrev) {
      var v = state.maintRevData[state.currentWeek][day];
      inp.value = v ? fmtInput(v) : "";
    } else {
      var act = parseInt(inp.getAttribute("data-act"), 10);
      var val = state.dailyData[state.currentWeek][day][act];
      inp.value = val || "";
    }
  }

  function handleBudgetInput() {
    state.quarterlyBudget = parseNum(document.getElementById("quarterlyBudget").value);
    state.avgSaleSize = parseNum(document.getElementById("avgSaleSize").value);
    renderAll();
    markUnsaved();
  }

  function formatBudgetInput(e) {
    var val = parseNum(e.target.value);
    if (val > 0) { e.target.value = fmtInput(val); }
  }

  function handleWeekNav(dir) {
    var nw = state.currentWeek + dir;
    if (nw >= 0 && nw < WEEKS_PER_QUARTER) {
      state.currentWeek = nw;
      renderActivityLog();
    }
  }

  /* ========== MANUAL SAVE ========== */
  var _hasUnsavedChanges = false;

  function markUnsaved() {
    _hasUnsavedChanges = true;
    var btn = document.getElementById("saveBtn");
    if (btn) btn.classList.remove("saved");
  }

  function saveAllChanges() {
    if (!authState.currentUser) return;
    var btn = document.getElementById("saveBtn");
    if (btn) btn.classList.add("saving");

    // Update local team cache
    teamStateCache[authState.currentUser.email] = JSON.parse(JSON.stringify(buildStateBlob()));

    var blob = buildStateBlob();
    supabase
      .from("user_state")
      .upsert({
        user_email: authState.currentUser.email,
        quarter_key: getQuarterKey(),
        state_data: blob,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_email,quarter_key" })
      .then(function (res) {
        if (btn) btn.classList.remove("saving");
        if (res.error) {
          console.error("Save error:", res.error);
          showSaveToast("Save failed — try again", true);
        } else {
          _hasUnsavedChanges = false;
          if (btn) btn.classList.add("saved");
          showSaveToast("All changes saved", false);
          refreshCachedToken();
          // Remove saved class after 3s
          setTimeout(function () {
            if (btn) btn.classList.remove("saved");
          }, 3000);
        }
      });
  }

  function showSaveToast(msg, isError) {
    var existing = document.querySelector(".save-toast");
    if (existing) existing.remove();
    var toast = document.createElement("div");
    toast.className = "save-toast";
    toast.textContent = msg;
    if (isError) toast.style.background = "var(--color-error, #d32f2f)";
    document.body.appendChild(toast);
    // Trigger reflow then show
    void toast.offsetWidth;
    toast.classList.add("show");
    setTimeout(function () {
      toast.classList.remove("show");
      setTimeout(function () { toast.remove(); }, 300);
    }, 2200);
  }

  /* ========== THEME TOGGLE ========== */
  function initTheme() {
    var toggle = document.getElementById("menuThemeToggle");
    var root = document.documentElement;
    var theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.setAttribute("data-theme", theme);

    function updateIcon() {
      if (!toggle) return;
      toggle.innerHTML = theme === "dark"
        ? "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><path d=\"M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42\"/></svg>"
        : "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z\"/></svg>";
    }
    updateIcon();
    if (toggle) {
      toggle.addEventListener("click", function () {
        theme = theme === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", theme);
        toggle.setAttribute("aria-label", "Switch to " + (theme === "dark" ? "light" : "dark") + " mode");
        updateIcon();
        if (state.activeView === "dashboard") {
          destroyTrendChart();
          renderTrendChart();
        } else if (state.activeView === "rankings") {
          if (rankingsChartInstance) {
            rankingsChartInstance.destroy();
            rankingsChartInstance = null;
          }
          renderRankingsChart();
        }
      });
    }
  }

  /* ========== CSV EXPORT ========== */
  function escapeCSV(val) {
    var str = String(val);
    if (str.indexOf(",") !== -1 || str.indexOf("\"") !== -1 || str.indexOf("\n") !== -1) {
      return "\"" + str.replace(/"/g, "\"\"") + "\"";
    }
    return str;
  }

  function exportCSV(period) {
    var repName = authState.currentUser ? authState.currentUser.name : "Sales Rep";
    var now = new Date();
    var dateStr = (now.getMonth() + 1) + "/" + now.getDate() + "/" + now.getFullYear();
    var targets = getPipelineTargets();
    var csvRows = [];

    var csvActLabels = ["Cold Calls", "Meetings", "Proposals", "Close Mtg", "Growth POs", "Exist Calls", "Maint POs"];

    // Determine week range based on period
    var weekStart, weekEnd;
    if (period === "week") {
      weekStart = state.currentWeek;
      weekEnd = state.currentWeek + 1;
    } else if (period === "month") {
      var monthStart = Math.floor(state.currentWeek / 4) * 4;
      weekStart = monthStart;
      weekEnd = monthStart + 4;
    } else {
      weekStart = 0;
      weekEnd = WEEKS_PER_QUARTER;
    }

    csvRows.push(["salesbirdie Sales Activity Report"]);
    csvRows.push(["Rep: " + repName]);
    csvRows.push(["Exported: " + dateStr]);
    csvRows.push([
      "Quarterly Budget: " + formatCurrency(state.quarterlyBudget),
      "Avg Sale: " + formatCurrency(state.avgSaleSize),
      "Actual Avg Sale: " + formatCurrency(getActualAvgSale()),
      "Growth (" + Math.round(state.growthPct * 100) + "%): " + formatCurrency(state.quarterlyBudget * state.growthPct),
      "Maint (" + Math.round(state.maintPct * 100) + "%): " + formatCurrency(state.quarterlyBudget * state.maintPct)
    ]);
    csvRows.push([]);

    for (var w = weekStart; w < weekEnd; w++) {
      var wd = state.dailyData[w];
      var gr = state.growthRevData[w];
      var mr = state.maintRevData[w];
      var dates = getWeekDates(w);

      csvRows.push(["M" + (getMonthOfWeek(w) + 1) + " WEEK " + ((w % 4) + 1)]);
      var headerRow = ["Day", "Date"];
      for (var hi = 0; hi < csvActLabels.length; hi++) { headerRow.push(csvActLabels[hi]); }
      headerRow.push("Growth Rev", "Maint Rev", "Total Rev");
      csvRows.push(headerRow);

      var wTotals = [0, 0, 0, 0, 0, 0, 0, 0];
      var wGrowthRev = 0;
      var wMaintRev = 0;

      for (var d = 0; d < 5; d++) {
        var gRev = gr[d];
        var mRev = mr[d];
        wGrowthRev += gRev;
        wMaintRev += mRev;
        var row = [DAYS[d], dates[d]];
        for (var di = 0; di < DISPLAY_ORDER.length; di++) {
          var idx = DISPLAY_ORDER[di];
          row.push(wd[d][idx]);
          wTotals[idx] += wd[d][idx];
        }
        row.push(formatCurrency(gRev));
        row.push(formatCurrency(mRev));
        row.push(formatCurrency(gRev + mRev));
        csvRows.push(row);
      }

      var totRow = ["Total", ""];
      for (var di2 = 0; di2 < DISPLAY_ORDER.length; di2++) { totRow.push(wTotals[DISPLAY_ORDER[di2]]); }
      totRow.push(formatCurrency(wGrowthRev));
      totRow.push(formatCurrency(wMaintRev));
      totRow.push(formatCurrency(wGrowthRev + wMaintRev));
      csvRows.push(totRow);

      var tgtRow = ["Target", ""];
      for (var di3 = 0; di3 < DISPLAY_ORDER.length; di3++) { tgtRow.push(formatNumber(targets[DISPLAY_ORDER[di3]])); }
      tgtRow.push(formatCurrency(getGrowthWeeklyBudget()));
      tgtRow.push(formatCurrency(getMaintWeeklyBudget()));
      tgtRow.push(formatCurrency(getWeeklyBudget()));
      csvRows.push(tgtRow);

      var pctRow = ["% to Target", ""];
      for (var di4 = 0; di4 < DISPLAY_ORDER.length; di4++) {
        var pidx = DISPLAY_ORDER[di4];
        var pct2 = targets[pidx] > 0 ? (wTotals[pidx] / targets[pidx]) * 100 : 0;
        pctRow.push(formatPct(pct2));
      }
      var gP = getGrowthWeeklyBudget() > 0 ? (wGrowthRev / getGrowthWeeklyBudget()) * 100 : 0;
      pctRow.push(formatPct(gP));
      var mP = getMaintWeeklyBudget() > 0 ? (wMaintRev / getMaintWeeklyBudget()) * 100 : 0;
      pctRow.push(formatPct(mP));
      var tP = getWeeklyBudget() > 0 ? ((wGrowthRev + wMaintRev) / getWeeklyBudget()) * 100 : 0;
      pctRow.push(formatPct(tP));
      csvRows.push(pctRow);
      csvRows.push([]);
    }

    // Monthly summaries: skip for "week", only current month for "month", all 3 for "quarter"
    if (period !== "week") {
      var monthSummaryStart = 0;
      var monthSummaryEnd = 3;
      if (period === "month") {
        monthSummaryStart = Math.floor(state.currentWeek / 4);
        monthSummaryEnd = monthSummaryStart + 1;
      }
      for (var qm = monthSummaryStart; qm < monthSummaryEnd; qm++) {
        var mStart = qm * 4;
        var mEnd = mStart + 4;
        var qsm = getQuarterStartMonth();
        var mNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        csvRows.push(["MONTHLY SUMMARY \u2014 " + mNames[qsm + qm] + " " + now.getFullYear()]);
        csvRows.push(["Metric", "Week 1", "Week 2", "Week 3", "Week 4", "Monthly Total", "Monthly Target", "% to Target"]);

        for (var mdi = 0; mdi < DISPLAY_ORDER.length; mdi++) {
          var mIntIdx = DISPLAY_ORDER[mdi];
          var mRow = [csvActLabels[mdi]];
          var mTotal = 0;
          for (var wk = mStart; wk < mEnd; wk++) {
            var wSum = 0;
            for (var dy = 0; dy < 5; dy++) { wSum += state.dailyData[wk][dy][mIntIdx]; }
            mTotal += wSum;
            mRow.push(wSum);
          }
          mRow.push(mTotal);
          var mTgt = targets[mIntIdx] * 4.33;
          mRow.push(formatNumber(mTgt));
          var mPct = mTgt > 0 ? (mTotal / mTgt) * 100 : 0;
          mRow.push(formatPct(mPct));
          csvRows.push(mRow);
        }

        var revRows = [
          { name: "Growth Revenue", get: function (wk2, dy2) { return state.growthRevData[wk2][dy2]; }, tgt: getGrowthMonthlyBudget() },
          { name: "Maint Revenue", get: function (wk2, dy2) { return state.maintRevData[wk2][dy2]; }, tgt: getMaintMonthlyBudget() },
          { name: "Total Revenue", get: function (wk2, dy2) { return state.growthRevData[wk2][dy2] + state.maintRevData[wk2][dy2]; }, tgt: getMonthlyBudget() }
        ];
        for (var rri = 0; rri < revRows.length; rri++) {
          var rr = revRows[rri];
          var rrRow = [rr.name];
          var rrTotal = 0;
          for (var rwk = mStart; rwk < mEnd; rwk++) {
            var rwSum = 0;
            for (var rdy = 0; rdy < 5; rdy++) { rwSum += rr.get(rwk, rdy); }
            rrTotal += rwSum;
            rrRow.push(formatCurrency(rwSum));
          }
          rrRow.push(formatCurrency(rrTotal));
          rrRow.push(formatCurrency(rr.tgt));
          var rrPct = rr.tgt > 0 ? (rrTotal / rr.tgt) * 100 : 0;
          rrRow.push(formatPct(rrPct));
          csvRows.push(rrRow);
        }
        csvRows.push([]);
      }
    }

    var csvStr = csvRows.map(function (row) { return row.map(escapeCSV).join(","); }).join("\n");
    var bom = "\uFEFF";
    var blob = new Blob([bom + csvStr], { type: "text/csv;charset=utf-8;" });
    var blobUrl = URL.createObjectURL(blob);
    var link = document.createElement("a");
    var safeName = repName.replace(/[^a-zA-Z0-9]/g, "_");
    var fileDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    link.href = blobUrl;
    link.download = "salesbirdie_Sales_" + safeName + "_" + fileDate + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }

  /* ========== TEAM CSV EXPORT ========== */
  function exportTeamCSV(period) {
    var team = getTeamData();
    var csvRows = [];
    var now = new Date();

    csvRows.push(["salesbirdie Team Report"]);
    csvRows.push(["Period: " + (period === "week" ? "Weekly" : period === "month" ? "Monthly" : "Full Quarter")]);
    csvRows.push(["Exported: " + (now.getMonth() + 1) + "/" + now.getDate() + "/" + now.getFullYear()]);
    csvRows.push([]);
    csvRows.push(["Rep Name", "Calls", "Meetings", "Proposals", "POs", "Revenue", "Budget", "% to Budget"]);

    for (var i = 0; i < team.length; i++) {
      var rep = team[i];
      var totalRev = 0;
      for (var w = 0; w < rep.weeklyRev.length; w++) { totalRev += rep.weeklyRev[w]; }

      var pCalls, pMeetings, pProposals, pPOs, pRev, pBudget;
      if (period === "week") {
        pCalls = Math.round(rep.calls / WEEKS_PER_QUARTER);
        pMeetings = Math.round(rep.meetings / WEEKS_PER_QUARTER);
        pProposals = Math.round(rep.proposals / WEEKS_PER_QUARTER);
        pPOs = Math.round(rep.pos / WEEKS_PER_QUARTER);
        pRev = totalRev / WEEKS_PER_QUARTER;
        pBudget = rep.budget / 13;
      } else if (period === "month") {
        pCalls = Math.round(rep.calls / 3);
        pMeetings = Math.round(rep.meetings / 3);
        pProposals = Math.round(rep.proposals / 3);
        pPOs = Math.round(rep.pos / 3);
        pRev = totalRev / 3;
        pBudget = rep.budget / 3;
      } else {
        pCalls = rep.calls;
        pMeetings = rep.meetings;
        pProposals = rep.proposals;
        pPOs = rep.pos;
        pRev = totalRev;
        pBudget = rep.budget;
      }

      var pctBudget = pBudget > 0 ? (pRev / pBudget) * 100 : 0;
      csvRows.push([rep.name, pCalls, pMeetings, pProposals, pPOs, formatCurrency(pRev), formatCurrency(pBudget), formatPct(pctBudget)]);
    }

    var csvStr = csvRows.map(function (row) { return row.map(escapeCSV).join(","); }).join("\n");
    var bom = "\uFEFF";
    var blob = new Blob([bom + csvStr], { type: "text/csv;charset=utf-8;" });
    var blobUrl = URL.createObjectURL(blob);
    var link = document.createElement("a");
    var fileDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    link.href = blobUrl;
    link.download = "salesbirdie_Team_" + fileDate + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }

  /* ========== INIT APP (after auth) ========== */
  var appInitialized = false;

  function initApp() {
    if (appInitialized) {
      // Re-login: update budget inputs from restored state and re-render
      var qi = document.getElementById("quarterlyBudget");
      var ai = document.getElementById("avgSaleSize");
      qi.value = state.quarterlyBudget > 0 ? fmtInput(state.quarterlyBudget) : "";
      ai.value = state.avgSaleSize > 0 ? fmtInput(state.avgSaleSize) : "";
      computeConversionRates();
      destroyTrendChart();
      if (rankingsChartInstance) { rankingsChartInstance.destroy(); rankingsChartInstance = null; }
      renderAll();
      switchView("home");
      return;
    }
    appInitialized = true;

    initTheme();
    initNav();
    initTeam();

    var qInput = document.getElementById("quarterlyBudget");
    var aInput = document.getElementById("avgSaleSize");

    // Set budget inputs from state (per-user state already loaded)
    if (state.quarterlyBudget > 0) {
      qInput.value = fmtInput(state.quarterlyBudget);
    } else {
      qInput.value = "";
    }
    if (state.avgSaleSize > 0) {
      aInput.value = fmtInput(state.avgSaleSize);
    } else {
      aInput.value = "";
    }

    qInput.addEventListener("input", handleBudgetInput);
    aInput.addEventListener("input", handleBudgetInput);
    qInput.addEventListener("blur", formatBudgetInput);
    aInput.addEventListener("blur", formatBudgetInput);

    // Growth / Maintenance split inputs
    var growthInput = document.getElementById("growthPctInput");
    var maintInput = document.getElementById("maintPctInput");
    function handleSplitChange(src) {
      var g = parseInt(growthInput.value, 10);
      var m = parseInt(maintInput.value, 10);
      if (isNaN(g)) g = 0;
      if (isNaN(m)) m = 0;
      if (g < 0) g = 0; if (g > 100) g = 100;
      if (m < 0) m = 0; if (m > 100) m = 100;
      if (src === "growth") { m = 100 - g; maintInput.value = m; }
      else { g = 100 - m; growthInput.value = g; }
      state.growthPct = g / 100;
      state.maintPct = m / 100;
      markUnsaved();
      renderKPIs();
      renderPipeline();
      renderMonthlySummary();
    }
    growthInput.addEventListener("input", function () { handleSplitChange("growth"); });
    maintInput.addEventListener("input", function () { handleSplitChange("maint"); });

    document.getElementById("prevWeekBtn").addEventListener("click", function () { handleWeekNav(-1); });
    document.getElementById("nextWeekBtn").addEventListener("click", function () { handleWeekNav(1); });
    document.getElementById("saveBtn").addEventListener("click", saveAllChanges);
    // Export dropdown toggle
    document.getElementById("exportBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      var dd = document.getElementById("exportDropdown");
      dd.style.display = dd.style.display === "none" ? "" : "none";
    });
    var exportOptions = document.querySelectorAll("#exportDropdown .export-option");
    for (var eo = 0; eo < exportOptions.length; eo++) {
      exportOptions[eo].addEventListener("click", function () {
        var period = this.getAttribute("data-export-period");
        document.getElementById("exportDropdown").style.display = "none";
        exportCSV(period);
      });
    }
    // Close dropdowns and hamburger on outside click
    document.addEventListener("click", function () {
      var dd = document.getElementById("exportDropdown");
      if (dd) dd.style.display = "none";
      var tdd = document.getElementById("teamExportDropdown");
      if (tdd) tdd.style.display = "none";
      var hm = document.getElementById("hamburgerMenu");
      if (hm) hm.style.display = "none";
    });
    document.getElementById("menuLogout").addEventListener("click", handleLogout);

    // Hamburger menu toggle
    document.getElementById("hamburgerBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      var menu = document.getElementById("hamburgerMenu");
      menu.style.display = menu.style.display === "none" ? "" : "none";
    });
    // Close hamburger on any item click
    var hItems = document.querySelectorAll(".hamburger-item");
    for (var hi = 0; hi < hItems.length; hi++) {
      hItems[hi].addEventListener("click", function () {
        document.getElementById("hamburgerMenu").style.display = "none";
      });
    }
    // Delete account handler
    document.getElementById("menuDeleteAccount").addEventListener("click", function () {
      if (!confirm("Are you sure you want to delete your account? This cannot be undone.")) return;
      var email = authState.currentUser ? authState.currentUser.email : null;
      if (!email) return;
      supabase.from("user_state").delete().eq("user_email", email).then(function () {
        return supabase.from("profiles").delete().eq("email", email);
      }).then(function () {
        return supabase.auth.signOut();
      }).then(function () {
        authState.currentUser = null;
        authState.users = [];
        authState.teams = {};
        teamStateCache = {};
        resetStateToDefaults();
        showLanding();
      }).catch(function (err) {
        console.error("Delete account error:", err);
        alert("Error deleting account. Please try again.");
      });
    });

    // Calendar nav
    document.getElementById("prevMonthBtn").addEventListener("click", function () {
      state.calendarMonth--;
      if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear--; }
      state.selectedDate = null;
      renderCalendar();
    });
    document.getElementById("nextMonthBtn").addEventListener("click", function () {
      state.calendarMonth++;
      if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear++; }
      state.selectedDate = null;
      renderCalendar();
    });

    // Reminder form
    document.getElementById("addReminderBtn").addEventListener("click", addReminder);
    document.getElementById("clearAllRemindersBtn").addEventListener("click", clearAllReminders);

    var welClearBtn = document.getElementById("welClearAllTodayBtn");
    if (welClearBtn) {
      welClearBtn.addEventListener("click", clearAllTodayReminders);
    }

    var todayKey = formatDateKey(new Date());
    document.getElementById("reminderDate").value = todayKey;

    // Auto-compute conversion rates from activity data
    computeConversionRates();

    renderAll();

    initChat();

    // Chart mode toggle
    var chartToggleBtns = document.querySelectorAll(".chart-toggle-btn:not(.team-period-btn)");
    for (var ct = 0; ct < chartToggleBtns.length; ct++) {
      chartToggleBtns[ct].addEventListener("click", function () {
        var mode = this.getAttribute("data-chart-mode");
        if (!mode) return;
        state.chartMode = mode;
        var allBtns = document.querySelectorAll(".chart-toggle-btn:not(.team-period-btn)");
        for (var ab = 0; ab < allBtns.length; ab++) {
          allBtns[ab].classList.toggle("active", allBtns[ab].getAttribute("data-chart-mode") === mode);
        }
        destroyTrendChart();
        renderTrendChart();
      });
    }

    // Hash-based view switching
    var hash = window.location.hash.replace("#", "");
    if (hash === "dashboard" || hash === "calendar" || hash === "rankings" || hash === "chat" || hash === "team") {
      switchView(hash);
    } else {
      switchView("home");
    }
    window.addEventListener("hashchange", function () {
      var h = window.location.hash.replace("#", "");
      if (h === "home" || h === "dashboard" || h === "calendar" || h === "rankings" || h === "chat" || h === "team") {
        switchView(h);
      }
    });
  }

  /* ========== GLOBAL INIT ========== */
  function init() {
    initAuthForms();

    // Check for existing Supabase session (auto-login returning users)
    supabase.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (session && session.user) {
        fetchProfile(session.user.id).then(function (profile) {
          if (profile) {
            setCurrentUserFromProfile(profile);
            loadTeamCache(profile.team_id).then(function () {
              showApp();
            });
          } else {
            showLanding();
          }
        }).catch(function () {
          showLanding();
        });
      } else {
        showLanding();
      }
    }).catch(function () {
      showLanding();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
