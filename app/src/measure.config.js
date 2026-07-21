// measure.config.js — 원격 익명 측정의 연결 설정.
// 이 값이 비어 있으면(=지금) measure.js는 아무것도 전송하지 않는다(측정 비활성).
// 대표가 "이 앱 전용 신규 Supabase 프로젝트"를 만든 뒤, Claude가 아래 두 값을 채운다.
//
// ⚠ 보안: 여기에는 공개(anon/publishable) 키만 둔다. RLS로 보호되므로 클라이언트 노출이 안전하다.
//    service_role(관리자) 키는 절대 여기에도, 클라이언트 어디에도 넣지 않는다.
export const SUPABASE_URL = '';        // 예: https://<project-ref>.supabase.co
export const SUPABASE_ANON_KEY = '';   // 공개 anon 키(service_role 아님)
export const MEASURE_TABLE = 'usage_events';
export const APP_VERSION = 'wpt-web-2026-07-21'; // 개인정보 아님(배포본 구분용 운영값)
