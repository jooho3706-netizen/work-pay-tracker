// measure.js — 익명 원격 사용량 측정. 개인정보 0.
// 서버로 보내는 값은 오직 3가지: (1) 허용된 이벤트 "이름", (2) 로컬 중복방지 토큰의 SHA-256 해시,
//   (3) 앱 버전(개인정보 아님). 시각(created_at)은 "서버"가 기록한다(클라이언트 시각 신뢰 안 함).
// 절대 전송 안 함: 금액·시급·입금액·근무 날짜/시간·근무지·이름·메모·내보내기 내용·IP·User-Agent
//   원문·광고식별자·이메일·전화·URL 개인값.
// 싱크: 이 앱 전용 신규 Supabase 프로젝트의 usage_events 테이블
//   (RLS: 익명 역할은 "허용 이벤트 INSERT"만, SELECT/UPDATE/DELETE 불가).
//   measure.config.js가 비어 있으면(프로젝트 준비 전) 아무것도 전송하지 않는다.
// 중복 방지: 로컬 날짜/플래그(클라) + 서버 유니크 제약(토큰해시·이름·날짜). 저장소를 지우거나
//   브라우저를 바꾸면 토큰이 새로 생겨 중복이 생길 수 있다(완전 제거 불가 — 사람 추적을 안 하기 때문).
// 순수 코어(REMOTE_EVENTS/isAllowedEvent/buildPayload/buildServerRow/decideVisit)는 DOM 없이 테스트 가능.

import { SUPABASE_URL, SUPABASE_ANON_KEY, MEASURE_TABLE, APP_VERSION } from './measure.config.js';

// 대표에게 제공할 7개 집계에 1:1 대응하는 원격 이벤트. 이 목록 밖 이름은 전송 거부.
export const REMOTE_EVENTS = Object.freeze([
  'visit',                // 방문 수(하루 1회)
  'onboarding_complete',  // 온보딩 완료 수
  'first_shift_saved',    // 첫 근무 저장 수
  'pay_diff_viewed',      // 급여 차이 확인 수
  'second_shift_saved',   // 두 번째 근무 저장 수
  'return_visit',         // 재방문 수(다른 날 다시 옴)
  'export_run',           // 내보내기 실행 수
]);
const ALLOWED = new Set(REMOTE_EVENTS);

// 순수: 허용된 이벤트 이름인가.
export function isAllowedEvent(name) {
  return ALLOWED.has(name);
}

// 순수: 화이트리스트 게이트. 통과 시 { name } 하나뿐 — 그 외 어떤 키도 구조적으로 못 들어간다.
export function buildPayload(name) {
  if (!ALLOWED.has(name)) return null;
  return { name };
}

// 순수: 서버로 보낼 행(row). 허용 이벤트일 때만 정확히 { name, token_hash, app_version } 3개 키.
// created_at(시각)은 서버가 넣는다. 금액/시간/근무지/이름/메모 등 개인정보 필드는 어떤 것도 실릴 수 없다.
export function buildServerRow(name, tokenHash, appVersion) {
  if (!ALLOWED.has(name)) return null;
  return { name, token_hash: tokenHash, app_version: appVersion };
}

// 순수: 방문/재방문 판정 — 기기 식별자 없이 "로컬에 남은 날짜"만으로 결정.
export function decideVisit(firstVisit, lastVisit, today) {
  if (!firstVisit) return ['visit'];          // 최초 방문
  if (lastVisit === today) return [];         // 같은 날 재실행 → 중복 집계 안 함
  return ['visit', 'return_visit'];           // 다른 날 다시 옴 → 방문 + 재방문
}

// ---------- 이하 브라우저 전용(비-DOM 환경에서는 no-op) ----------
const MKEY = 'wpt.m1'; // 측정용 로컬 상태(중복방지 플래그·토큰·옵트아웃). 근무 데이터(wpt.v1.*)와 완전 분리.

function hasDOM() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}
// 원격 저장소가 설정돼 있는가(비어 있으면 전송 안 함).
function remoteConfigured() {
  return typeof SUPABASE_URL === 'string' && SUPABASE_URL !== ''
    && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY !== '';
}
function dntOn() {
  try {
    const nav = (typeof navigator !== 'undefined') ? navigator : {};
    const v = nav.doNotTrack || nav.msDoNotTrack || (typeof window !== 'undefined' && window.doNotTrack);
    return v === '1' || v === 'yes';
  } catch { return false; }
}
function isLocalHost() {
  try {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || location.protocol === 'file:';
  } catch { return false; }
}
function readM() {
  try { return JSON.parse(localStorage.getItem(MKEY)) || {}; } catch { return {}; }
}
function writeM(m) {
  try { localStorage.setItem(MKEY, JSON.stringify(m)); } catch { /* 무시: 측정은 부가기능 */ }
}

// 익명 사용 통계 끄기(사용자 선택). 켜면 전송 0. 근무 데이터는 원래부터 전송 안 함.
export function isOptedOut() { return hasDOM() ? !!readM().optOut : false; }
export function setOptedOut(off) {
  if (!hasDOM()) return;
  const m = readM(); m.optOut = !!off; writeM(m);
}

// 로컬 중복방지 토큰: 사람 추적용 프로필이 아니라 "같은 브라우저 중복 집계"만 막는 용도.
// 이 토큰의 해시(token_hash)는 "가명값"이며 완전 익명 ID가 아니다 — 같은 브라우저를 다른 방문에
//   묶어 중복을 줄이는 데만 쓴다. 해시로만 전송하며(원문은 기기 밖으로 안 나감),
//   저장소를 지우거나 브라우저를 바꾸면 새 토큰이 생겨 초기화된다(그래서 중복을 100% 없앨 수는 없음).
function getLocalToken() {
  const m = readM();
  if (!m.token) {
    m.token = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (String(Math.random()).slice(2) + '-' + Date.now());
    writeM(m);
  }
  return m.token;
}
async function sha256hex(s) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 실제 전송: 이름/토큰해시/앱버전만. 미설정·옵트아웃·DNT·로컬호스트·미허용이면 아무것도 안 한다.
async function send(name) {
  if (!hasDOM() || !remoteConfigured() || isOptedOut() || dntOn() || isLocalHost()) return;
  if (!isAllowedEvent(name)) return;
  try {
    const tokenHash = await sha256hex(getLocalToken());
    const row = buildServerRow(name, tokenHash, APP_VERSION);
    if (!row) return;
    await fetch(`${SUPABASE_URL}/rest/v1/${MEASURE_TABLE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        // 같은 날 중복 INSERT는 서버 유니크 제약으로 무시(에러 대신 조용히 넘어감).
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
      keepalive: true, // 페이지 이탈 중에도 전송 유지.
    });
  } catch { /* 측정 실패는 조용히 무시 — 앱 기능에는 영향 없음 */ }
}

// 마일스톤: 평생 1회만(퍼널 도달 측정). 이미 보냈으면 재전송 안 함.
export function measureOnce(name) {
  if (!hasDOM() || !isAllowedEvent(name)) return;
  const m = readM();
  m.once = m.once || {};
  if (m.once[name]) return;
  m.once[name] = 1;
  writeM(m);
  send(name);
}

// 방문/재방문: 하루 1회 집계. today = 'YYYY-MM-DD'.
export function measureVisit(today) {
  if (!hasDOM()) return;
  const m = readM();
  const events = decideVisit(m.firstVisit, m.lastVisit, today);
  if (events.length === 0) return;
  if (!m.firstVisit) m.firstVisit = today;
  m.lastVisit = today;
  writeM(m);
  events.forEach(send);
}
