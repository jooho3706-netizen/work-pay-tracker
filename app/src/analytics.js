// analytics.js — 기기 로컬 카운터만. 외부 SDK/네트워크 없음.
// 규칙(04-5, 05-1): 시급·시간·입금액·총차이 "숫자 값", 근무지명, 날짜 원문,
// 기기·개인 식별자를 절대 저장하지 않는다. "발생 여부/횟수"와 소수의 안전 플래그만.

const KEY = 'wpt.v1.analytics';

// 허용 이벤트(05-1의 E1~E9). 이 목록 밖 이벤트는 무시.
export const EVENTS = Object.freeze({
  FIRST_OPEN: 'first_open',
  WORKPLACE_SET: 'workplace_set',
  SHIFT_SAVED: 'shift_saved',
  SHIFT_SAVED_BACKFILL: 'shift_saved_backfill',
  PAYPERIOD_DEPOSIT_SET: 'payperiod_deposit_set',
  TOTAL_DIFF_VIEWED: 'total_diff_viewed',
  EXPORT_DONE: 'export_done',
  RETURN_DAY2PLUS: 'return_day2plus',
  AD_SLOT_VIEW: 'ad_slot_view',
  AD_SLOT_DISMISS: 'ad_slot_dismiss',
});
const ALLOWED = new Set(Object.values(EVENTS));

// 안전 플래그만 허용(짧은 enum 문자열/불리언). 숫자·긴 문자열은 버린다(원문 유출 차단).
const ALLOWED_FLAGS = {
  // shift_saved 세부: 예정만/실제만/둘다
  kind: new Set(['scheduled', 'actual', 'both']),
};

function sanitizeProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    const allowed = ALLOWED_FLAGS[k];
    if (!allowed) continue; // 화이트리스트 밖 키는 저장 안 함
    if (typeof v === 'string' && allowed.has(v)) out[k] = v;
  }
  return out;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { counts: {}, flags: {} };
    const obj = JSON.parse(raw);
    return { counts: obj.counts || {}, flags: obj.flags || {} };
  } catch {
    return { counts: {}, flags: {} };
  }
}

function write(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* 저장 실패는 조용히 무시(분석은 부가기능, 사용자 데이터 아님) */
  }
}

// 이벤트 기록: 카운트만 올리고, 허용된 안전 플래그별 카운트만 추가.
export function track(event, props) {
  if (!ALLOWED.has(event)) return;
  const store = read();
  store.counts[event] = (store.counts[event] || 0) + 1;
  const safe = sanitizeProps(props);
  for (const [k, v] of Object.entries(safe)) {
    const bucket = `${event}.${k}.${v}`;
    store.flags[bucket] = (store.flags[bucket] || 0) + 1;
  }
  write(store);
}

// 사용자가 앱 안에서 자기 사용 요약을 볼 수 있게(05-1 허용 형태).
export function getSummary() {
  return read();
}

export function resetAnalytics() {
  write({ counts: {}, flags: {} });
}
