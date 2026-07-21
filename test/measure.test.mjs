// measure.test.mjs — 원격 측정의 개인정보 계약 자동 검증(익명·이름만).
// 순수 함수만 import(DOM/네트워크 없음). 실행: npm test (= node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_EVENTS, isAllowedEvent, buildPayload, buildServerRow, decideVisit,
} from '../app/src/measure.js';

// ---------- M. 원격 측정 개인정보 계약 ----------

test('M1 원격 이벤트 = 대표에게 제공할 7개 집계와 정확히 일치', () => {
  assert.deepEqual([...REMOTE_EVENTS].sort(), [
    'export_run', 'first_shift_saved', 'onboarding_complete',
    'pay_diff_viewed', 'return_visit', 'second_shift_saved', 'visit',
  ].sort());
});

test('M2 전송 페이로드는 오직 { name } 하나뿐 — 개인정보 필드가 구조적으로 불가', () => {
  const PII_KEYS = ['amount', 'wage', 'won', 'hours', 'minutes', 'time', 'deposit',
    'workplace', 'memo', 'note', 'id', 'device', 'uid', 'ip', 'ua', 'session'];
  for (const name of REMOTE_EVENTS) {
    const p = buildPayload(name);
    assert.deepEqual(Object.keys(p), ['name']); // 키는 name 단 하나
    assert.equal(p.name, name);
    for (const bad of PII_KEYS) assert.ok(!(bad in p), `payload에 ${bad} 없음`);
    // 값은 화이트리스트 이벤트 이름 문자열(원문 숫자/자유 텍스트가 아님).
    assert.equal(typeof p.name, 'string');
    assert.ok(REMOTE_EVENTS.includes(p.name));
  }
});

test('M3 화이트리스트 밖 이름(원문 흔적 포함 시도)은 전송 거부(null)', () => {
  for (const bad of ['wage_10030', 'deposit_85000', 'workplace_카페', 'memo_x',
    'name_홍길동', '__proto__', 'click', 'pageview', '']) {
    assert.equal(isAllowedEvent(bad), false);
    assert.equal(buildPayload(bad), null);
  }
});

test('M4 방문/재방문 판정은 기기 식별자 없이 로컬 날짜만으로 중복 방지', () => {
  assert.deepEqual(decideVisit(null, null, '2026-07-21'), ['visit']);                     // 최초 방문
  assert.deepEqual(decideVisit('2026-07-21', '2026-07-21', '2026-07-21'), []);            // 같은 날 재실행 → 무집계
  assert.deepEqual(decideVisit('2026-07-21', '2026-07-21', '2026-07-22'),
    ['visit', 'return_visit']);                                                            // 다른 날 → 방문+재방문
  // 하루 여러 번 열어도 방문은 1회만(중복 방지).
  assert.deepEqual(decideVisit('2026-07-01', '2026-07-22', '2026-07-22'), []);
});

test('M5 서버로 보낼 row는 정확히 { name, token_hash, app_version } 3키뿐 — PII 필드 구조적 불가', () => {
  const PII_KEYS = ['amount', 'wage', 'won', 'hours', 'minutes', 'time', 'deposit',
    'workplace', 'memo', 'note', 'ip', 'ua', 'user_agent', 'email', 'phone', 'session', 'device'];
  for (const name of REMOTE_EVENTS) {
    const row = buildServerRow(name, 'a'.repeat(64), 'wpt-web-2026-07-21');
    assert.deepEqual(Object.keys(row).sort(), ['app_version', 'name', 'token_hash']); // 3키 고정
    assert.equal(row.name, name);
    assert.ok(REMOTE_EVENTS.includes(row.name)); // 값은 화이트리스트 이름
    for (const bad of PII_KEYS) assert.ok(!(bad in row), `server row에 ${bad} 없음`);
    // 시각(created_at)은 클라이언트가 넣지 않는다 — 서버가 기록.
    assert.ok(!('created_at' in row) && !('ts' in row) && !('time' in row));
  }
});

test('M6 화이트리스트 밖 이름은 server row도 거부(null) — 원문/임의 이름 전송 불가', () => {
  for (const bad of ['wage_10030', 'deposit_85000', 'workplace_카페', 'pageview',
    '__proto__', 'click', '']) {
    assert.equal(buildServerRow(bad, 'a'.repeat(64), 'v'), null);
  }
});
