// storage.js — 기기 로컬 저장 + 사용자 실행 내보내기. 서버/네트워크 전송 없음.
// 원칙(04-4, CLAUDE.md-5): 기존 사용자 데이터를 삭제·초기화·덮어쓰지 않는다.
// 파싱 실패 시에도 원본을 지우지 않는다(보존 최우선). 저장은 명시적 save()에서만.

import { LEGAL_EXPORT_LINE } from './legal.js';

const KEY = 'wpt.v1.data';

export function emptyState() {
  return {
    version: 1,
    workplace: { name: '', wage: null },
    shifts: [],           // { id, date, scheduled?, actual? }
    payPeriods: [],       // { id, start, end, deposit }
    meta: { onboarded: false, firstOpenDate: null, lastOpenDate: null },
  };
}

// 로드: 없으면 빈 상태. 손상되어 파싱 실패하면 원본을 남기고 {corrupt:true} 신호만 준다.
export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { state: emptyState(), corrupt: false, available: false };
  }
  if (!raw) return { state: emptyState(), corrupt: false, available: true };
  try {
    const parsed = JSON.parse(raw);
    return { state: mergeDefaults(parsed), corrupt: false, available: true };
  } catch {
    // 손상: 절대 덮어쓰지 않는다. 사용자에게 알리고 빈 상태로 화면만 띄운다.
    return { state: emptyState(), corrupt: true, available: true };
  }
}

function mergeDefaults(p) {
  const base = emptyState();
  return {
    version: p.version || 1,
    workplace: { ...base.workplace, ...(p.workplace || {}) },
    shifts: Array.isArray(p.shifts) ? p.shifts : [],
    payPeriods: Array.isArray(p.payPeriods) ? p.payPeriods : [],
    meta: { ...base.meta, ...(p.meta || {}) },
  };
}

// 저장: 명시적 호출에서만. 실패 시 false 반환(조용히 데이터 파괴하지 않음).
export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function newId() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ---- 내보내기: 사용자가 버튼 누를 때만. 자동 업로드 없음. 경계 문구 1줄 포함. ----

export function buildExportJSON(state) {
  return JSON.stringify(
    { _notice: LEGAL_EXPORT_LINE, exportedAt: new Date().toISOString(), data: state },
    null,
    2,
  );
}

export function buildExportText(state, totalsByPeriod) {
  const lines = [];
  lines.push('근무·급여 오차 추적기 — 개인 요약(내보내기)');
  lines.push(LEGAL_EXPORT_LINE);
  lines.push('');
  lines.push(`근무지: ${state.workplace.name || '(미입력)'}  기본시급: ${state.workplace.wage ?? '(미입력)'}`);
  lines.push(`근무 기록 수: ${state.shifts.length}건`);
  if (Array.isArray(totalsByPeriod)) {
    lines.push('');
    lines.push('[급여기간 요약]');
    for (const t of totalsByPeriod) {
      lines.push(
        `- ${t.start}~${t.end}: 단순 총예상액 ${fmt(t.eActual)} / ` +
        `실제 입금액 ${t.hasDeposit ? fmt(t.deposit) : '미입력'} / ` +
        `총차이 ${t.delta == null ? '미계산' : fmt(t.delta) + ' (' + t.sign + ')'}`,
      );
    }
  }
  return lines.join('\n');
}

function fmt(x) {
  if (x == null) return '미입력';
  return Math.round(x).toLocaleString('ko-KR') + '원';
}

// 브라우저에서 로컬 파일 다운로드 트리거(자동 업로드 아님).
export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
