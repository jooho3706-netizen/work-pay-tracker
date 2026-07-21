// 계산 계약(03) 자동 단위 테스트 — 06_TEST_CHECKLIST의 A1~A10, B1~B4.
// 실행: npm test  (= node --test). 외부 의존성 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../app/src/domain.js';

const {
  parseTime, workedMinutes, workedHours, simpleAmount, shiftWarnings,
  dayCompare, shiftsInPeriod, payPeriodTotals, displayWon,
} = domain;

const W = 10000; // 기본시급 예시(원/시간)

// ---------- A. 계산 계약 ----------

test('A1 근무시간 = (종료−시작) − 휴게 (예정/실제 각각)', () => {
  // 09:00~18:00, 휴게 60분 → 540분 - 60 = 480분(8시간)
  assert.equal(workedMinutes({ start: '09:00', end: '18:00', breakMin: 60 }), 480);
  // 휴게 0
  assert.equal(workedMinutes({ start: '09:00', end: '13:00', breakMin: 0 }), 240);
  // 예정/실제는 같은 함수로 각각 계산됨(구조 동일)
  assert.equal(workedMinutes({ start: '10:00', end: '15:30', breakMin: 30 }), 300);
});

test('A2 단순액 = 근무시간(시간) × 기본시급', () => {
  const min = workedMinutes({ start: '09:00', end: '18:00', breakMin: 60 }); // 480
  assert.equal(workedHours(min), 8);
  assert.equal(simpleAmount(min, W), 8 * W); // 80000
  // 30분 → 0.5시간
  assert.equal(simpleAmount(30, W), 0.5 * W);
});

test('A3 자정 넘김(종료<시작) → 익일 처리 +24h, 근무는 시작 날짜 귀속', () => {
  // 22:00~06:00, 휴게 0 → 8시간(480분)
  assert.equal(workedMinutes({ start: '22:00', end: '06:00', breakMin: 0 }), 480);
  // 23:30~00:30 → 60분
  assert.equal(workedMinutes({ start: '23:30', end: '00:30', breakMin: 0 }), 60);
  // 귀속: shiftsInPeriod는 shift.date(=시작날짜)만 본다
  const shifts = [{ date: '2026-07-10', actual: { start: '22:00', end: '06:00', breakMin: 0 } }];
  assert.equal(shiftsInPeriod(shifts, '2026-07-10', '2026-07-10').length, 1);
  // 다음날(07-11)로 조회하면 잡히지 않음 → 시작날짜에만 귀속
  assert.equal(shiftsInPeriod(shifts, '2026-07-11', '2026-07-11').length, 0);
});

test('A4 휴게 ≥ 근무 → 근무시간 0 (음수 없음) + 경고', () => {
  // 09:00~10:00(60분), 휴게 90분 → 0 (음수 아님)
  assert.equal(workedMinutes({ start: '09:00', end: '10:00', breakMin: 90 }), 0);
  assert.deepEqual(shiftWarnings({ start: '09:00', end: '10:00', breakMin: 90 }), ['BREAK_GE_WORK']);
  // 정확히 같을 때도 0 + 경고
  assert.equal(workedMinutes({ start: '09:00', end: '10:00', breakMin: 60 }), 0);
  assert.deepEqual(shiftWarnings({ start: '09:00', end: '10:00', breakMin: 60 }), ['BREAK_GE_WORK']);
});

test('A5 종료 = 시작 → 근무시간 0, 저장 허용(경고만)', () => {
  assert.equal(workedMinutes({ start: '09:00', end: '09:00', breakMin: 0 }), 0);
  assert.deepEqual(shiftWarnings({ start: '09:00', end: '09:00', breakMin: 0 }), ['ZERO_LENGTH']);
});

test('A6 급여기간 E_actual = Σ(구간 내 실제 단순액)', () => {
  const shifts = [
    { date: '2026-07-01', actual: { start: '09:00', end: '13:00', breakMin: 0 } }, // 4h=40000
    { date: '2026-07-02', actual: { start: '10:00', end: '18:00', breakMin: 60 } }, // 7h=70000
    { date: '2026-06-30', actual: { start: '09:00', end: '18:00', breakMin: 0 } }, // 구간 밖
  ];
  const inP = shiftsInPeriod(shifts, '2026-07-01', '2026-07-31');
  const t = payPeriodTotals(inP, W, null);
  assert.equal(t.eActual, 40000 + 70000);
  assert.equal(t.actualCount, 2);
});

test('A7 총차이 Δ = D − E_actual, 부호(>,=,<) 중립 표기', () => {
  const shifts = [{ date: '2026-07-01', actual: { start: '09:00', end: '13:00', breakMin: 0 } }]; // 40000
  assert.deepEqual(pick(payPeriodTotals(shifts, W, 50000)), { delta: 10000, sign: '>' });
  assert.deepEqual(pick(payPeriodTotals(shifts, W, 40000)), { delta: 0, sign: '=' });
  assert.deepEqual(pick(payPeriodTotals(shifts, W, 30000)), { delta: -10000, sign: '<' });
});

test('A8 D 미입력 시 Δ 계산·표시 안 함', () => {
  const shifts = [{ date: '2026-07-01', actual: { start: '09:00', end: '13:00', breakMin: 0 } }];
  for (const noDeposit of [null, undefined, '']) {
    const t = payPeriodTotals(shifts, W, noDeposit);
    assert.equal(t.hasDeposit, false);
    assert.equal(t.delta, null);
    assert.equal(t.sign, null);
    assert.equal(t.eActual, 40000); // E_actual은 여전히 계산됨
  }
});

test('A9 예정만/실제만 있는 날의 미입력 처리(추정 채움 없음)', () => {
  // 예정만: 실제 비교/단순액 null, E_actual 미포함
  const schedOnly = dayCompare({ start: '09:00', end: '18:00', breakMin: 60 }, null, W);
  assert.equal(schedOnly.hasScheduled, true);
  assert.equal(schedOnly.hasActual, false);
  assert.equal(schedOnly.actMin, null);
  assert.equal(schedOnly.actAmt, null);
  assert.equal(schedOnly.minDiff, null); // 추정하지 않음
  assert.equal(schedOnly.amtDiff, null);
  // 실제만: 예정 비교 null, 실제 단순액은 계산되어 E_actual 포함
  const actOnly = dayCompare(null, { start: '09:00', end: '13:00', breakMin: 0 }, W);
  assert.equal(actOnly.hasScheduled, false);
  assert.equal(actOnly.schedAmt, null);
  assert.equal(actOnly.minDiff, null);
  assert.equal(actOnly.actAmt, 40000);
  const t = payPeriodTotals([{ date: '2026-07-01', actual: { start: '09:00', end: '13:00', breakMin: 0 } }], W, null);
  assert.equal(t.eActual, 40000);
  // 예정만 있는 날은 E_actual에 들어가지 않음
  const t2 = payPeriodTotals([{ date: '2026-07-01', scheduled: { start: '09:00', end: '18:00' } }], W, null);
  assert.equal(t2.eActual, 0);
  assert.equal(t2.actualCount, 0);
});

test('A10 반올림: 합계는 정밀값 기준, 표시만 반올림(합계 불일치 없음)', () => {
  // 10분 × 시급 10000 = 1666.666...원짜리 3건.
  const seg = { start: '09:00', end: '09:10', breakMin: 0 }; // 10분
  const shifts = [
    { date: '2026-07-01', actual: seg },
    { date: '2026-07-02', actual: seg },
    { date: '2026-07-03', actual: seg },
  ];
  const t = payPeriodTotals(shifts, W, null);
  // 정밀 합 = 4999.999... → 표시 반올림 5000
  assert.ok(Math.abs(t.eActual - 5000) < 1e-6);
  assert.equal(displayWon(t.eActual), 5000);
  // 개별 반올림 후 합(1667*3=5001)과 달라야 함 → 합계는 정밀값 기준임을 증명
  const naive = displayWon(simpleAmount(10, W)) * 3; // 1667*3
  assert.equal(naive, 5001);
  assert.notEqual(displayWon(t.eActual), naive);
});

// ---------- B. 금지 연산 부재(03-6) ----------

const FORBIDDEN_EXPORT_HINTS = [
  'distribut', 'perday', 'perDay', 'unpaid', 'owed', 'arrear', // 입금액 분배/미지급
  'chebul', '체불', '미지급', 'wagetheft', 'wageTheft',
  'allowance', 'weeklyholiday', 'weeklyHoliday', 'overtime', 'nightpay', 'nightPay',
  'holidaypay', 'holidayPay', 'tax', 'deduct', 'insurance', 'minwage', 'minWage', 'judge',
];

test('B1 입금액 D가 어떤 날짜/근무에도 분배되지 않음', () => {
  // payPeriodTotals 결과에 근무별/날짜별 입금액 배분 필드가 없다.
  const shifts = [
    { date: '2026-07-01', actual: { start: '09:00', end: '13:00', breakMin: 0 } },
    { date: '2026-07-02', actual: { start: '09:00', end: '13:00', breakMin: 0 } },
  ];
  const t = payPeriodTotals(shifts, W, 100000);
  const keys = Object.keys(t).sort();
  assert.deepEqual(keys, ['actualCount', 'deposit', 'delta', 'eActual', 'hasDeposit', 'sign'].sort());
  // 입금액은 급여기간 하나의 값으로만 존재. 배열/날짜맵으로 쪼개지지 않음.
  assert.equal(typeof t.deposit, 'number');
  assert.ok(!Array.isArray(t.deposit));
  // 원본 근무 객체에 입금액 관련 필드가 주입되지 않았다(부작용 없음).
  for (const s of shifts) {
    assert.ok(!('deposit' in s) && !('depositShare' in s) && !('unpaid' in s));
  }
});

test('B2 특정 날짜에 "미지급/체불" 값·라벨이 생성되지 않음', () => {
  const dc = dayCompare({ start: '09:00', end: '18:00' }, { start: '09:00', end: '13:00' }, W);
  const keys = Object.keys(dc).join(' ').toLowerCase();
  for (const bad of ['unpaid', 'owed', 'arrear', 'chebul', '체불', '미지급', 'wagetheft']) {
    assert.ok(!keys.includes(bad.toLowerCase()), `dayCompare 키에 금지어(${bad}) 없음`);
  }
  // 값에도 그런 라벨 문자열이 없다(중립 숫자/불리언만).
  for (const v of Object.values(dc)) {
    assert.ok(typeof v === 'number' || typeof v === 'boolean' || v === null);
  }
});

test('B3 수당/세금/공제가 계산에 끼어들지 않음 (단순액 = 시간×시급 only)', () => {
  // 어떤 입력이든 결과는 정확히 시간×시급. 가산/공제가 없다.
  const min = workedMinutes({ start: '00:00', end: '10:00', breakMin: 0 }); // 600분=10h
  assert.equal(simpleAmount(min, W), 10 * W); // 정확히 100000, 야간/연장 가산 없음
  // 자정 걸친 야간이라도 가산 없음(단순액 동일).
  const night = workedMinutes({ start: '22:00', end: '08:00', breakMin: 0 }); // 10h
  assert.equal(simpleAmount(night, W), 10 * W);
});

test('B4 체불/최저임금 위반 판정 로직이 존재하지 않음 (금지 export 부재)', () => {
  const exportNames = Object.keys(domain);
  for (const name of exportNames) {
    const lower = name.toLowerCase();
    for (const hint of FORBIDDEN_EXPORT_HINTS) {
      assert.ok(!lower.includes(hint.toLowerCase()),
        `금지 성격의 export가 없어야 함: ${name} (힌트 ${hint})`);
    }
  }
  // 판정 함수가 없으니 "체불 여부" 같은 boolean 판정 API도 없다.
  assert.equal(domain.isWageTheft, undefined);
  assert.equal(domain.judgeUnpaid, undefined);
  assert.equal(domain.distributeDeposit, undefined);
});

// ---------- helpers ----------
function pick(t) {
  return { delta: t.delta, sign: t.sign };
}
