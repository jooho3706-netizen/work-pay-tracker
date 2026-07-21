// app.js — 화면 조립(SPA). 계산은 domain.js, 저장은 storage.js, 이벤트는 analytics.js.
// 경계 문구(legal.js)는 금액이 보이는 모든 화면에 노출. 광고 자리는 규칙 위치에만(플래그).

import {
  workedMinutes, simpleAmount, dayCompare, shiftWarnings,
  shiftsInPeriod, payPeriodTotals, displayWon, formatHM, hasSegment,
} from './domain.js';
import * as store from './storage.js';
import { track, EVENTS, getSummary } from './analytics.js';
import { measureOnce, measureVisit, isOptedOut, setOptedOut } from './measure.js';
import { LEGAL_FULL, LEGAL_SHORT } from './legal.js';

// ---------- 상태 ----------
const S = {
  route: 'home',
  data: store.emptyState(),
  corrupt: false,
  adsPreview: false,          // 광고 자리 표시자 플래그(기본 OFF). 켜도 핵심 퍼널 완주 가능.
  editingId: null,            // 근무 수정 중 id
  detailId: null,
  period: null,               // { start, end }
  draft: null,                // 입력 화면 임시값
};

// ---------- 유틸 ----------
const $ = (sel, root = document) => root.querySelector(sel);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtWon(x) {
  if (x == null) return '미입력';
  return Math.round(x).toLocaleString('ko-KR') + '원';
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function monthRange(iso) {
  const [y, m] = iso.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start: first, end: last };
}
function saveData() { store.save(S.data); }
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------- 공통 조각 ----------
function legalShort() {
  return `<p class="legal-short">${esc(LEGAL_SHORT)} <a data-action="legal-expand">전문 보기</a></p>`;
}
// 광고 자리(표시자만). 허용 위치에서만 호출한다. 입력/온보딩 화면에서는 호출하지 않음.
function adSlot(where) {
  if (!S.adsPreview) return '';
  track(EVENTS.AD_SLOT_VIEW);
  return `<div class="ad-slot" role="complementary" data-adwhere="${esc(where)}">
    <span class="ad-tag">광고 영역(예시)</span>
    <button data-action="dismiss-ad">닫기</button>
  </div>`;
}
function diffClass(v) { return v > 0 ? 'diff-pos' : v < 0 ? 'diff-neg' : 'diff-zero'; }
function signWord(sign) { return sign === '>' ? '많음' : sign === '<' ? '적음' : '같음'; }

// ---------- 앱 셸 ----------
const NAV = [
  { key: 'home', ic: '🏠', label: '홈' },
  { key: 'input', ic: '✏️', label: '입력' },
  { key: 'list', ic: '📋', label: '목록' },
  { key: 'period', ic: '💰', label: '급여기간' },
  { key: 'settings', ic: '⚙️', label: '설정' },
];
function bottomNav() {
  return `<nav class="bottomnav">${NAV.map((n) => (
    `<button data-nav="${n.key}" class="${S.route === n.key ? 'active' : ''}">
       <span class="ic">${n.ic}</span>${n.label}</button>`
  )).join('')}</nav>`;
}
function appbar(title, withBack) {
  return `<header class="appbar">
    ${withBack ? '<button class="back" data-action="back">‹ 뒤로</button>' : ''}
    <h1>${esc(title)}</h1></header>`;
}

// ---------- 라우팅 ----------
function go(route) { S.route = route; render(); window.scrollTo(0, 0); }

function render() {
  const root = $('#app');
  if (!S.data.meta.onboarded) { root.innerHTML = renderOnboarding(); return; }
  let html = '';
  switch (S.route) {
    case 'home': html = renderHome(); break;
    case 'input': html = renderInput(); break;
    case 'list': html = renderList(); break;
    case 'detail': html = renderDetail(); break;
    case 'period': html = renderPeriod(); break;
    case 'settings': html = renderSettings(); break;
    default: html = renderHome();
  }
  root.innerHTML = html + bottomNav();
  if (S.route === 'input') wireInput();
  if (S.route === 'period') wirePeriod();
}

// ---------- 온보딩(경계 문구 1회) ----------
function renderOnboarding() {
  return `${appbar('근무·급여 오차 추적기', false)}
  <div class="screen stack">
    <div class="card">
      <h2>예정 → 실제 → 입금, 어디서 차이가 났는지</h2>
      <p class="muted small">이 앱은 예정 근무·실제 근무·실제 입금액을 <b>비교해 기록</b>하는 개인용 도구입니다.
      가입 없이 시작하고, 근무·급여 기록은 이 기기에만 저장됩니다. 서비스 개선을 위해 <b>개인정보가 없는 익명 사용
      단계와 발생 시각</b>(어느 화면까지 도달했는지)만 서버에 집계되며 — 금액·시간·근무지·이름·메모는 전송하지
      않습니다. 이 익명 통계로는 개인의 급여 기록을 볼 수 없고, 설정에서 끌 수 있습니다.</p>
    </div>
    <div class="card">
      <h2>먼저 알아두세요</h2>
      <p class="legal-full">${esc(LEGAL_FULL)}</p>
    </div>
    <button class="btn big" data-action="onboard-start">가입 없이 시작하기</button>
    <p class="tiny muted center">시작하면 위 안내를 확인한 것으로 봅니다.</p>
  </div>`;
}

// ---------- 홈 ----------
function currentPeriodTotals() {
  const iso = todayISO();
  const p = S.period || (S.data.payPeriods[S.data.payPeriods.length - 1]
    ? { start: S.data.payPeriods[S.data.payPeriods.length - 1].start, end: S.data.payPeriods[S.data.payPeriods.length - 1].end }
    : monthRange(iso));
  const pp = findPeriod(p.start, p.end);
  const inP = shiftsInPeriod(S.data.shifts, p.start, p.end);
  const totals = payPeriodTotals(inP, S.data.workplace.wage, pp ? pp.deposit : null);
  return { p, totals };
}
function renderHome() {
  const wageSet = S.data.workplace.wage != null && S.data.workplace.wage !== '';
  const { p, totals } = currentPeriodTotals();
  const recent = [...S.data.shifts].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
  return `${appbar('근무·급여 오차 추적기', false)}
  <div class="screen">
    ${S.corrupt ? `<div class="card"><p class="warn">저장된 데이터를 읽지 못했습니다. 기존 기록을 덮어쓰지 않았습니다.
       화면에는 빈 상태만 표시됩니다. 이 기기의 데이터를 그대로 두려면 이 앱을 지우지 마세요.</p></div>` : ''}
    ${!wageSet ? `<div class="card"><p class="small">먼저 <b>근무지·기본시급</b>을 설정하면 예상액이 계산됩니다.</p>
       <button class="btn secondary" data-nav="settings">설정으로 이동</button></div>` : ''}
    <button class="btn big" data-action="quick-add">＋ 근무 1건 빠르게 추가</button>
    <div class="card" style="margin-top:14px">
      <h2>이번 급여기간 총차이</h2>
      <p class="small muted">${esc(p.start)} ~ ${esc(p.end)}</p>
      ${totals.hasDeposit
        ? `<p class="amount ${diffClass(totals.delta)}">${totals.delta > 0 ? '+' : ''}${fmtWon(totals.delta)}</p>
           <p class="small muted">실제 기준 단순 총예상액 ${fmtWon(totals.eActual)} · 실제 입금액 ${fmtWon(totals.deposit)} ·
           입금액이 단순 총예상액보다 ${signWord(totals.sign)}</p>`
        : `<p class="muted small">실제 입금액을 입력하면 총차이가 표시됩니다. (단순 총예상액 ${fmtWon(totals.eActual)})</p>`}
      <button class="btn ghost" data-nav="period" style="margin-top:10px">급여기간 화면 열기</button>
      ${legalShort()}
    </div>
    <div class="card">
      <h2>최근 근무</h2>
      ${recent.length ? recent.map(shiftItemHTML).join('') : '<p class="muted small">아직 근무 기록이 없습니다.</p>'}
      ${S.data.shifts.length > 3 ? '<button class="btn ghost" data-nav="list">전체 목록 보기</button>' : ''}
    </div>
    ${adSlot('home_bottom')}
  </div>`;
}

// ---------- 근무 입력(핵심) ----------
function blankDraft(date) {
  return { date: date || todayISO(), sStart: '', sEnd: '', sBreak: '', aStart: '', aEnd: '', aBreak: '' };
}
function draftFromShift(sh) {
  const s = sh.scheduled || {}; const a = sh.actual || {};
  return {
    date: sh.date,
    sStart: s.start || '', sEnd: s.end || '', sBreak: s.breakMin ?? '',
    aStart: a.start || '', aEnd: a.end || '', aBreak: a.breakMin ?? '',
  };
}
function renderInput() {
  if (!S.draft) S.draft = blankDraft();
  const d = S.draft;
  const editing = !!S.editingId;
  return `${appbar(editing ? '근무 수정' : '근무 입력', true)}
  <div class="screen">
    <div class="card">
      <div class="field">
        <label>날짜</label>
        <input type="date" id="f-date" value="${esc(d.date)}" />
      </div>
      <h2>예정 근무 <span class="muted tiny">(아는 것만)</span></h2>
      <div class="grid3">
        <div><label>시작</label><input type="time" id="f-sStart" value="${esc(d.sStart)}"></div>
        <div><label>종료</label><input type="time" id="f-sEnd" value="${esc(d.sEnd)}"></div>
        <div><label>휴게(분)</label><input type="number" inputmode="numeric" id="f-sBreak" value="${esc(d.sBreak)}" min="0"></div>
      </div>
      <hr class="hr">
      <h2>실제 근무 <span class="muted tiny">(아는 것만)</span></h2>
      <div class="grid3">
        <div><label>시작</label><input type="time" id="f-aStart" value="${esc(d.aStart)}"></div>
        <div><label>종료</label><input type="time" id="f-aEnd" value="${esc(d.aEnd)}"></div>
        <div><label>휴게(분)</label><input type="number" inputmode="numeric" id="f-aBreak" value="${esc(d.aBreak)}" min="0"></div>
      </div>
      <div id="calc-result" class="result" style="margin-top:14px"></div>
      ${legalShort()}
    </div>
    <button class="btn" data-action="save-shift">${editing ? '수정 저장' : '저장'}</button>
    ${editing ? '' : '<button class="btn secondary" data-action="save-next" style="margin-top:10px">저장하고 다음 날짜 추가</button>'}
  </div>`;
}
function readInputFields() {
  const g = (id) => ($('#' + id) ? $('#' + id).value : '');
  return {
    date: g('f-date'),
    sStart: g('f-sStart'), sEnd: g('f-sEnd'), sBreak: g('f-sBreak'),
    aStart: g('f-aStart'), aEnd: g('f-aEnd'), aBreak: g('f-aBreak'),
  };
}
function draftToShift(d) {
  const sched = (d.sStart && d.sEnd) ? { start: d.sStart, end: d.sEnd, breakMin: Number(d.sBreak) || 0 } : null;
  const act = (d.aStart && d.aEnd) ? { start: d.aStart, end: d.aEnd, breakMin: Number(d.aBreak) || 0 } : null;
  return { scheduled: sched, actual: act };
}
function updateCalcResult() {
  const node = $('#calc-result'); if (!node) return;
  const d = readInputFields();
  const { scheduled, actual } = draftToShift(d);
  const wage = S.data.workplace.wage;
  const dc = dayCompare(scheduled, actual, wage);
  const warn = [...shiftWarnings(scheduled), ...shiftWarnings(actual)];
  const lines = [];
  lines.push(`<div class="row spread"><span class="muted small">예정 근무시간</span><b>${dc.hasScheduled ? formatHM(dc.schedMin) : '미입력'}</b></div>`);
  lines.push(`<div class="row spread"><span class="muted small">실제 근무시간</span><b>${dc.hasActual ? formatHM(dc.actMin) : '미입력'}</b></div>`);
  if (dc.minDiff != null) {
    lines.push(`<div class="row spread"><span class="muted small">시간 차이(실제−예정)</span><b class="${diffClass(dc.minDiff)}">${dc.minDiff > 0 ? '+' : ''}${formatHM(Math.abs(dc.minDiff))}${dc.minDiff < 0 ? ' 적음' : dc.minDiff > 0 ? ' 많음' : ''}</b></div>`);
  }
  if (wage == null || wage === '') {
    lines.push(`<p class="warn small">기본시급이 없어 금액은 계산하지 않습니다. 설정에서 시급을 입력하세요.</p>`);
  } else {
    lines.push(`<div class="row spread"><span class="muted small">예정 단순액</span><b>${dc.schedAmt != null ? fmtWon(dc.schedAmt) : '미입력'}</b></div>`);
    lines.push(`<div class="row spread"><span class="muted small">실제 단순액</span><b>${dc.actAmt != null ? fmtWon(dc.actAmt) : '미입력'}</b></div>`);
    if (dc.amtDiff != null) {
      lines.push(`<div class="row spread"><span class="muted small">금액 차이(실제−예정)</span><b class="${diffClass(dc.amtDiff)}">${dc.amtDiff > 0 ? '+' : ''}${fmtWon(dc.amtDiff)}</b></div>`);
    }
  }
  if (warn.includes('BREAK_GE_WORK')) lines.push('<p class="warn small">휴게가 근무시간 이상입니다 → 근무시간 0으로 계산합니다.</p>');
  if (warn.includes('ZERO_LENGTH')) lines.push('<p class="warn small">시작과 종료가 같습니다 → 근무시간 0으로 저장됩니다.</p>');
  node.innerHTML = lines.join('');
}
function wireInput() {
  ['f-date', 'f-sStart', 'f-sEnd', 'f-sBreak', 'f-aStart', 'f-aEnd', 'f-aBreak']
    .forEach((id) => { const n = $('#' + id); if (n) n.addEventListener('input', updateCalcResult); });
  updateCalcResult();
}
function commitShift(advanceDate) {
  const d = readInputFields();
  if (!d.date) { toast('날짜를 선택하세요'); return; }
  const { scheduled, actual } = draftToShift(d);
  if (!scheduled && !actual) { toast('예정 또는 실제 중 하나는 시작·종료가 필요합니다'); return; }
  const isBackfill = d.date < todayISO();
  if (S.editingId) {
    const sh = S.data.shifts.find((x) => x.id === S.editingId);
    if (sh) { sh.date = d.date; sh.scheduled = scheduled; sh.actual = actual; }
    saveData();
    track(EVENTS.SHIFT_SAVED, { kind: scheduled && actual ? 'both' : actual ? 'actual' : 'scheduled' });
    S.editingId = null; S.draft = null; toast('수정 저장됨'); go('list'); return;
  }
  const shift = { id: store.newId(), date: d.date, scheduled, actual };
  S.data.shifts.push(shift);
  saveData();
  track(EVENTS.SHIFT_SAVED, { kind: scheduled && actual ? 'both' : actual ? 'actual' : 'scheduled' });
  if (isBackfill) track(EVENTS.SHIFT_SAVED_BACKFILL);
  // 익명 퍼널 집계(개수·값 전송 없음, 이름만): 첫/두 번째 근무 저장 마일스톤.
  const shiftTotal = S.data.shifts.length;
  if (shiftTotal === 1) measureOnce('first_shift_saved');
  else if (shiftTotal === 2) measureOnce('second_shift_saved');
  if (advanceDate) {
    S.draft = blankDraft(addDaysISO(d.date, 1));
    // 직전 시간값 재사용(입력 부담↓): 시간은 유지, 날짜만 +1
    S.draft.sStart = d.sStart; S.draft.sEnd = d.sEnd; S.draft.sBreak = d.sBreak;
    S.draft.aStart = d.aStart; S.draft.aEnd = d.aEnd; S.draft.aBreak = d.aBreak;
    render(); toast('저장됨 · 다음 날짜로');
  } else {
    S.draft = null; toast('저장됨'); go('list');
  }
}

// ---------- 근무 목록 ----------
function shiftItemHTML(sh) {
  const wage = S.data.workplace.wage;
  const dc = dayCompare(sh.scheduled, sh.actual, wage);
  const badge = dc.minDiff != null
    ? `<span class="badge ${diffClass(dc.minDiff)}">시간 ${dc.minDiff > 0 ? '+' : ''}${formatHM(Math.abs(dc.minDiff))}</span>`
    : `<span class="badge muted">${dc.hasScheduled && !dc.hasActual ? '실제 미입력' : !dc.hasScheduled && dc.hasActual ? '예정 없음' : ''}</span>`;
  return `<button class="shift-item" data-detail="${esc(sh.id)}">
    <div class="row spread"><span class="date">${esc(sh.date)}</span>${badge}</div>
    <div class="small muted">예정 ${dc.hasScheduled ? formatHM(dc.schedMin) : '미입력'} · 실제 ${dc.hasActual ? formatHM(dc.actMin) : '미입력'}</div>
  </button>`;
}
function renderList() {
  const shifts = [...S.data.shifts].sort((a, b) => (a.date < b.date ? 1 : -1));
  const items = [];
  shifts.forEach((sh, i) => {
    items.push(shiftItemHTML(sh));
    if ((i + 1) % 4 === 0) items.push(adSlot('list_between')); // 항목 사이(입력 흐름 밖)
  });
  return `${appbar('근무 목록', false)}
  <div class="screen">
    ${shifts.length ? items.join('') : '<div class="card"><p class="muted small">아직 근무 기록이 없습니다.</p></div>'}
    <button class="btn" data-action="quick-add">＋ 근무 추가</button>
  </div>`;
}

// ---------- 근무 상세 ----------
function renderDetail() {
  const sh = S.data.shifts.find((x) => x.id === S.detailId);
  if (!sh) { return `${appbar('근무 상세', true)}<div class="screen"><div class="card"><p class="muted">기록을 찾을 수 없습니다.</p></div></div>`; }
  const wage = S.data.workplace.wage;
  const dc = dayCompare(sh.scheduled, sh.actual, wage);
  const row = (k, v) => `<div class="row spread"><span class="muted small">${k}</span><b>${v}</b></div>`;
  return `${appbar('근무 상세', true)}
  <div class="screen">
    <div class="card">
      <h2>${esc(sh.date)}</h2>
      ${row('예정 근무시간', dc.hasScheduled ? formatHM(dc.schedMin) : '미입력')}
      ${row('실제 근무시간', dc.hasActual ? formatHM(dc.actMin) : '미입력')}
      ${dc.minDiff != null ? row('시간 차이(실제−예정)', `${dc.minDiff > 0 ? '+' : ''}${formatHM(Math.abs(dc.minDiff))}`) : ''}
      <hr class="hr">
      ${wage == null || wage === ''
        ? '<p class="warn small">기본시급 미설정 — 금액 미표시</p>'
        : `${row('예정 단순액', dc.schedAmt != null ? fmtWon(dc.schedAmt) : '미입력')}
           ${row('실제 단순액', dc.actAmt != null ? fmtWon(dc.actAmt) : '미입력')}
           ${dc.amtDiff != null ? row('금액 차이(실제−예정)', `${dc.amtDiff > 0 ? '+' : ''}${fmtWon(dc.amtDiff)}`) : ''}`}
      ${legalShort()}
    </div>
    <button class="btn secondary" data-action="edit-shift" data-id="${esc(sh.id)}">수정</button>
    <button class="btn danger" data-action="delete-shift" data-id="${esc(sh.id)}" style="margin-top:10px">삭제</button>
  </div>`;
}

// ---------- 급여기간 ----------
function findPeriod(start, end) {
  return S.data.payPeriods.find((p) => p.start === start && p.end === end) || null;
}
function renderPeriod() {
  if (!S.period) S.period = monthRange(todayISO());
  const p = S.period;
  const rec = findPeriod(p.start, p.end);
  const inP = shiftsInPeriod(S.data.shifts, p.start, p.end);
  const totals = payPeriodTotals(inP, S.data.workplace.wage, rec ? rec.deposit : null);
  track(EVENTS.TOTAL_DIFF_VIEWED);
  // 익명 집계: 입금액이 있어 실제 "총차이"를 본 순간만 1회(퍼널 도달).
  if (totals.hasDeposit) measureOnce('pay_diff_viewed');
  return `${appbar('급여기간', false)}
  <div class="screen">
    <div class="card">
      <div class="grid2">
        <div><label>시작일</label><input type="date" id="p-start" value="${esc(p.start)}"></div>
        <div><label>종료일</label><input type="date" id="p-end" value="${esc(p.end)}"></div>
      </div>
      <div class="field" style="margin-top:8px">
        <label>실제 총입금액(이 급여기간에 실제로 받은 금액)</label>
        <input type="number" inputmode="numeric" id="p-deposit" placeholder="예: 1200000" value="${rec && rec.deposit != null ? esc(rec.deposit) : ''}">
      </div>
      <button class="btn" data-action="save-deposit">입금액 저장</button>
    </div>

    <div class="card">
      <h2>이번 급여기간 결과</h2>
      <div class="row spread"><span class="muted small">실제 기준 단순 총예상액</span><b>${fmtWon(totals.eActual)}</b></div>
      <div class="row spread"><span class="muted small">실제 입금액</span><b>${totals.hasDeposit ? fmtWon(totals.deposit) : '미입력'}</b></div>
      ${totals.hasDeposit
        ? `<div class="row spread"><span class="muted small">총차이(입금액 − 단순 총예상액)</span>
             <b class="amount ${diffClass(totals.delta)}">${totals.delta > 0 ? '+' : ''}${fmtWon(totals.delta)}</b></div>
           <p class="small muted">입금액이 단순 총예상액보다 <b>${signWord(totals.sign)}</b>. 차이가 있다면 수당·세금·공제·기록 누락 등
             조건을 확인해 보세요.</p>`
        : '<p class="muted small">실제 입금액을 입력하면 총차이가 표시됩니다.</p>'}
      <p class="small muted">기간 내 실제 근무 ${totals.actualCount}건 기준.</p>
      ${legalShort()}
    </div>

    <button class="btn secondary" data-action="export">개인 요약 내보내기</button>
    ${adSlot('period_bottom')}
  </div>`;
}
function wirePeriod() {
  ['p-start', 'p-end'].forEach((id) => {
    const n = $('#' + id);
    if (n) n.addEventListener('change', () => {
      S.period = { start: $('#p-start').value, end: $('#p-end').value };
      render();
    });
  });
}
function saveDeposit() {
  const start = $('#p-start').value, end = $('#p-end').value;
  const depRaw = $('#p-deposit').value;
  if (!start || !end) { toast('기간을 설정하세요'); return; }
  S.period = { start, end };
  let rec = findPeriod(start, end);
  const deposit = depRaw === '' ? null : Number(depRaw);
  if (!rec) { rec = { id: store.newId(), start, end, deposit }; S.data.payPeriods.push(rec); }
  else { rec.deposit = deposit; }
  saveData();
  if (deposit != null) track(EVENTS.PAYPERIOD_DEPOSIT_SET);
  toast('입금액 저장됨'); render();
}

// ---------- 설정 ----------
function renderSettings() {
  const w = S.data.workplace;
  const sum = getSummary();
  const count = (k) => sum.counts[k] || 0;
  return `${appbar('설정', false)}
  <div class="screen">
    <div class="card">
      <h2>근무지 · 기본시급</h2>
      <div class="field"><label>근무지 이름</label>
        <input type="text" id="s-name" value="${esc(w.name)}" placeholder="예: OO카페"></div>
      <div class="field"><label>기본시급(원/시간)</label>
        <input type="number" inputmode="numeric" id="s-wage" value="${w.wage != null ? esc(w.wage) : ''}" placeholder="예: 10030"></div>
      <button class="btn" data-action="save-workplace">저장</button>
    </div>
    <div class="card">
      <h2>데이터</h2>
      <button class="btn secondary" data-action="export">개인 요약 내보내기(로컬 파일)</button>
      <p class="tiny muted" style="margin-top:8px">근무·급여 기록(금액·시간·근무지·이름·메모)은 <b>이 기기에만</b> 저장되며 서버로 전송되지 않습니다.
        제품 개선을 위해 <b>익명 사용 단계와 발생 시각</b>(어느 화면까지 도달했는지)만 별도로 서버에 집계되며,
        이 익명 통계로는 개인의 급여 기록을 볼 수 없습니다. 앱을 지우면 기록이 사라질 수 있으니 내보내기로 백업하세요.</p>
    </div>
    <div class="card">
      <h2>익명 사용 통계</h2>
      <label class="row" style="gap:8px"><input type="checkbox" id="s-optout" ${isOptedOut() ? 'checked' : ''} style="width:auto"> 익명 사용 통계 보내지 않기</label>
      <p class="tiny muted">익명 통계에는 어느 화면까지 왔는지와 발생 시각, 그리고 브라우저별 중복 집계를 줄이기 위한
        <b>가명값</b>(무작위 토큰의 해시)이 포함됩니다. 이 가명값은 완전 익명 ID가 아니며, 이 기기 저장을 지우면 초기화됩니다.
        금액·시간·근무지·이름·메모는 원래부터 전송하지 않습니다. 체크하면 이 익명 통계도 보내지 않습니다.</p>
    </div>
    <div class="card">
      <h2>광고 자리(개발 미리보기)</h2>
      <label class="row" style="gap:8px"><input type="checkbox" id="s-ads" ${S.adsPreview ? 'checked' : ''} style="width:auto"> 광고 자리 표시자 미리보기(예시)</label>
      <p class="tiny muted">실제 광고가 아니라 "자리"만 표시합니다. 꺼도 핵심 기능은 그대로 완료됩니다.</p>
    </div>
    <div class="card">
      <h2>앱 정보 · 법률 경계(전문)</h2>
      <p class="legal-full">${esc(LEGAL_FULL)}</p>
    </div>
    <div class="card">
      <h2>내 사용 요약(이 기기)</h2>
      <p class="tiny muted">숫자 값(시급·시간·입금액)은 저장하지 않고, 발생 횟수만 셉니다.</p>
      <p class="small">근무 저장 ${count('shift_saved')}회 · 소급 입력 ${count('shift_saved_backfill')}회 ·
        입금액 입력 ${count('payperiod_deposit_set')}회 · 총차이 조회 ${count('total_diff_viewed')}회 ·
        내보내기 ${count('export_done')}회</p>
    </div>
  </div>`;
}

// ---------- 내보내기 ----------
function doExport() {
  const totalsByPeriod = S.data.payPeriods.map((p) => {
    const inP = shiftsInPeriod(S.data.shifts, p.start, p.end);
    const t = payPeriodTotals(inP, S.data.workplace.wage, p.deposit);
    return { start: p.start, end: p.end, ...t };
  });
  const text = store.buildExportText(S.data, totalsByPeriod);
  store.downloadFile('work-pay-summary.export.txt', text, 'text/plain;charset=utf-8');
  track(EVENTS.EXPORT_DONE);
  measureOnce('export_run'); // 익명 집계(이름만)
  toast('요약 파일을 내보냈습니다');
}

// ---------- 이벤트 위임 ----------
document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) {
    const key = navBtn.getAttribute('data-nav');
    if (key === 'input') { S.editingId = null; S.draft = S.draft || blankDraft(); }
    go(key); return;
  }
  const actEl = e.target.closest('[data-action]');
  if (actEl) { handleAction(actEl.getAttribute('data-action'), actEl); return; }
  const detailEl = e.target.closest('[data-detail]');
  if (detailEl) { S.detailId = detailEl.getAttribute('data-detail'); go('detail'); return; }
});
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 's-ads') { S.adsPreview = e.target.checked; render(); }
  if (e.target && e.target.id === 's-optout') {
    setOptedOut(e.target.checked);
    toast(e.target.checked ? '익명 통계 보내지 않음' : '익명 통계 다시 보냄');
  }
});

function handleAction(action, el) {
  switch (action) {
    case 'onboard-start':
      S.data.meta.onboarded = true;
      S.data.meta.firstOpenDate = S.data.meta.firstOpenDate || todayISO();
      saveData(); track(EVENTS.FIRST_OPEN); measureOnce('onboarding_complete'); go('home'); break;
    case 'quick-add': S.editingId = null; S.draft = blankDraft(); go('input'); break;
    case 'save-shift': commitShift(false); break;
    case 'save-next': commitShift(true); break;
    case 'edit-shift': {
      const sh = S.data.shifts.find((x) => x.id === el.getAttribute('data-id'));
      if (sh) { S.editingId = sh.id; S.draft = draftFromShift(sh); go('input'); }
      break;
    }
    case 'delete-shift': {
      const id = el.getAttribute('data-id');
      S.data.shifts = S.data.shifts.filter((x) => x.id !== id);
      saveData(); toast('삭제됨'); go('list'); break;
    }
    case 'save-deposit': saveDeposit(); break;
    case 'save-workplace': {
      const name = $('#s-name').value.trim();
      const wageRaw = $('#s-wage').value;
      S.data.workplace.name = name;
      S.data.workplace.wage = wageRaw === '' ? null : Number(wageRaw);
      saveData(); track(EVENTS.WORKPLACE_SET); toast('저장됨'); render(); break;
    }
    case 'export': doExport(); break;
    case 'legal-expand': alert(LEGAL_FULL); break;
    case 'dismiss-ad': {
      const slot = el.closest('.ad-slot'); if (slot) slot.remove();
      track(EVENTS.AD_SLOT_DISMISS); break;
    }
    case 'back': go(S.route === 'detail' ? 'list' : 'home'); break;
    default: break;
  }
}

// ---------- 부팅 ----------
function boot() {
  const res = store.load();
  S.data = res.state; S.corrupt = res.corrupt;
  // 재방문 신호(다른 날 다시 옴) — 원문 값 없이 플래그만.
  const today = todayISO();
  measureVisit(today); // 익명 방문/재방문(하루 1회, 이름만) — 온보딩 이전에도 '방문'은 집계
  if (S.data.meta.onboarded) {
    if (S.data.meta.lastOpenDate && S.data.meta.lastOpenDate !== today) track(EVENTS.RETURN_DAY2PLUS);
    S.data.meta.lastOpenDate = today; saveData();
  }
  render();
}
boot();
