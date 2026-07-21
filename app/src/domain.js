// domain.js — 계산 계약(03_DOMAIN_CONTRACT)의 순수 함수 구현.
// 규칙: 부작용 없음(저장/네트워크/DOM 없음). 여기 있는 것만 계산의 진실이다.
//
// 불변식(코드에 드러냄):
//  - 날짜별은 예정↔실제만 비교한다. 입금액을 날짜/근무에 분배하지 않는다.
//  - 실제 입금액(D)은 급여기간 단위로만 다룬다. 총차이 Δ = D − E_actual, D 있을 때만.
//  - 미입력 값은 0으로 채우거나 추정하지 않는다. null("미입력")로 남긴다.
//  - 주휴·야간·연장·휴일수당·세금·공제·최저임금·체불 판정 연산은 존재하지 않는다.

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * 60;

// "HH:MM" → 자정 기준 분(정수). 비었거나 형식 오류면 null(추정 금지).
export function parseTime(hhmm) {
  if (hhmm == null || hhmm === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * MINUTES_PER_HOUR + min;
}

function toMinutes(v) {
  return typeof v === 'number' ? v : parseTime(v);
}

// 근무 구간이 "입력됨" 상태인지(예정/실제 각각). 시작·종료가 모두 있어야 입력으로 본다.
export function hasSegment(seg) {
  return !!seg
    && seg.start != null && seg.start !== ''
    && seg.end != null && seg.end !== '';
}

// 근무시간(분) = (종료 − 시작) − 휴게.
//  - 종료<시작 → 자정 넘김: +24h (근무는 시작 날짜에 귀속 — 03-5).
//  - 휴게 ≥ 근무 → 0(음수 없음). 종료=시작 → 0.
//  - 시작/종료 미입력 → null(추정 금지).
export function workedMinutes(seg = {}) {
  const s = toMinutes(seg.start);
  const e = toMinutes(seg.end);
  if (s == null || e == null) return null;
  const brk = Number(seg.breakMin) || 0;
  let raw = e - s;
  if (raw < 0) raw += MINUTES_PER_DAY; // 자정 넘김
  let worked = raw - brk;
  if (worked < 0) worked = 0; // 휴게 ≥ 근무 → 0 (음수 금지)
  return worked;
}

export function workedHours(minutes) {
  if (minutes == null) return null;
  return minutes / MINUTES_PER_HOUR;
}

// 단순액 = 근무시간(시간) × 기본시급. 오직 시간×시급(수당·세금 미포함). 정밀값 유지.
export function simpleAmount(minutes, wage) {
  if (minutes == null) return null;
  if (wage == null || wage === '') return null;
  const w = Number(wage);
  if (!isFinite(w)) return null;
  return (minutes / MINUTES_PER_HOUR) * w;
}

// 입력 경고(추정하지 않고 사용자에게 알림만): 휴게≥근무, 길이 0.
export function shiftWarnings(seg) {
  const warnings = [];
  if (!hasSegment(seg)) return warnings;
  const s = toMinutes(seg.start);
  const e = toMinutes(seg.end);
  if (s == null || e == null) return warnings;
  let raw = e - s;
  if (raw < 0) raw += MINUTES_PER_DAY;
  const brk = Number(seg.breakMin) || 0;
  if (raw === 0) warnings.push('ZERO_LENGTH');
  else if (brk >= raw) warnings.push('BREAK_GE_WORK');
  return warnings;
}

// 날짜별 비교: 같은 날의 예정↔실제만. 입금액은 여기 관여하지 않는다(03-2).
// 반환 키는 중립 표현만. "미지급/체불" 라벨을 만들지 않는다.
export function dayCompare(scheduled, actual, wage) {
  const hasScheduled = hasSegment(scheduled);
  const hasActual = hasSegment(actual);
  const schedMin = hasScheduled ? workedMinutes(scheduled) : null;
  const actMin = hasActual ? workedMinutes(actual) : null;
  const schedAmt = hasScheduled ? simpleAmount(schedMin, wage) : null;
  const actAmt = hasActual ? simpleAmount(actMin, wage) : null;
  // 둘 다 있을 때만 차이(실제 − 예정). 없으면 "미입력"(null) — 추정하지 않음.
  const minDiff = (schedMin != null && actMin != null) ? actMin - schedMin : null;
  const amtDiff = (schedAmt != null && actAmt != null) ? actAmt - schedAmt : null;
  return { hasScheduled, hasActual, schedMin, actMin, schedAmt, actAmt, minDiff, amtDiff };
}

// 급여기간 내 근무만 남긴다(귀속은 시작 날짜=shift.date). ISO 날짜 문자열 사전순 비교.
export function shiftsInPeriod(shifts, startDate, endDate) {
  if (!Array.isArray(shifts)) return [];
  return shifts.filter((s) => s && s.date >= startDate && s.date <= endDate);
}

// 급여기간 총계 — "입금액 차이"는 오직 여기서(급여기간 단위)만 계산(03-3).
//  E_actual = Σ(구간 내 각 실제 근무의 실제 단순액). 정밀값 누적(표시 반올림은 별도).
//  D = 사용자가 입력한 하나의 입금액. Δ = D − E_actual (D 있을 때만).
//  부호는 중립: '>' 많음 / '=' 같음 / '<' 적음. 체불로 단정하지 않는다.
export function payPeriodTotals(shifts, wage, deposit) {
  let eActual = 0;
  let actualCount = 0;
  for (const sh of Array.isArray(shifts) ? shifts : []) {
    if (hasSegment(sh && sh.actual)) {
      const amt = simpleAmount(workedMinutes(sh.actual), wage);
      if (amt != null) {
        eActual += amt; // 정밀값 합산(A10)
        actualCount += 1;
      }
    }
  }
  const hasDeposit = deposit != null && deposit !== '' && isFinite(Number(deposit));
  const D = hasDeposit ? Number(deposit) : null;
  const delta = hasDeposit ? D - eActual : null; // D 미입력 → Δ 계산·표시 안 함(A8)
  const sign = delta == null ? null : (delta > 0 ? '>' : (delta < 0 ? '<' : '='));
  return { eActual, actualCount, deposit: D, hasDeposit, delta, sign };
}

// 표시용 반올림 헬퍼(계산이 아니라 "표시"에서만 사용 — 합계는 정밀값 기준, A10).
export function displayWon(x) {
  if (x == null) return null;
  return Math.round(x);
}

// 분 → "H시간 M분" 표시.
export function formatHM(minutes) {
  if (minutes == null) return '미입력';
  const h = Math.floor(minutes / MINUTES_PER_HOUR);
  const m = minutes % MINUTES_PER_HOUR;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}
