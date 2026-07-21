// legal.js — 법률 경계 문구(04_PRIVACY_LEGAL_BOUNDARY 원문 동결).
// 이 상수의 의미를 바꾸거나 숨기지 않는다. 금액이 보이는 화면마다 노출한다.

// 원문(FULL) — 약화/삭제 금지.
export const LEGAL_FULL =
  '표시되는 금액은 사용자가 입력한 근무시간과 기본 시급을 단순 계산한 참고값입니다. ' +
  '주휴·야간·연장·휴일수당, 세금 및 기타 조건이 반영되지 않을 수 있으며 ' +
  '법률상 지급액이나 임금체불 여부를 판정하지 않습니다.';

// 짧은 버전 — 전문(FULL)으로 가는 펼치기와 함께 쓴다.
export const LEGAL_SHORT = '참고용 단순 계산이며 법정 지급액·체불을 판정하지 않습니다.';

// 내보내기 파일에 넣는 1줄.
export const LEGAL_EXPORT_LINE =
  '※ ' + LEGAL_FULL;
