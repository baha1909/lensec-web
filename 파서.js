// 가계부 마크다운 표를 읽고 화면에 필요한 값을 계산한다. 서버 없이 브라우저와 테스트가 함께 쓴다.
const 날짜형식 = /^\d{4}-\d{2}-\d{2}$/;

// 표는 열 위치가 아니라 머리 이름으로 읽는다(Muse가 열을 추가해도 깨지지 않게).
export function 표읽기(text) {
  const 표들 = [];
  let 제목 = "";
  let 현재 = null;
  for (const 줄 of String(text || "").split(/\r?\n/)) {
    const 제목줄 = 줄.match(/^#{1,6}\s*(.+?)\s*$/);
    if (제목줄) { 제목 = 제목줄[1]; 현재 = null; continue; }
    if (!줄.trim().startsWith("|")) { 현재 = null; continue; }
    const 셀 = 줄.trim().replace(/^\||\|$/g, "").split("|").map(s => s.trim());
    if (셀.every(c => /^:?-+:?$/.test(c))) continue;
    if (!현재) { 현재 = { 제목, 머리: 셀, 행: [] }; 표들.push(현재); } else 현재.행.push(셀);
  }
  return 표들;
}

function 금액읽기(값, 경고, 위치) {
  const t = String(값 ?? "").replace(/[^\d.-]/g, "");
  const n = Number(t);
  if (t === "" || Number.isNaN(n)) { 경고.push(`금액을 읽지 못함: ${위치}`); return 0; }
  return n;
}

const 열 = (머리, ...이름들) => 머리.findIndex(h => 이름들.includes(h));
const 객체행 = (표, 행) => Object.fromEntries(표.머리.map((h, i) => [h, 행[i] ?? ""]));

// 월별 파일 하나 → 지출·입금 거래. 제목에 '입금'이 있는 표는 입금, 나머지는 지출.
export function 거래읽기(text) {
  const 지출 = [], 입금 = [], 경고 = [];
  for (const 표 of 표읽기(text)) {
    const 날 = 열(표.머리, "날짜"), 이름 = 열(표.머리, "상호", "출처"), 금 = 열(표.머리, "금액");
    const 분류 = 열(표.머리, "카테고리", "종류"), 메모 = 열(표.머리, "메모");
    if (날 < 0 || 금 < 0) continue;
    const 목록 = 표.제목.includes("입금") ? 입금 : 지출;
    for (const 행 of 표.행) {
      if (행.every(c => c === "")) continue;
      if (!날짜형식.test(행[날] ?? "")) { 경고.push(`날짜를 읽지 못함: ${행.join(" | ")}`); continue; }
      const 위치 = `${행[날]} ${행[이름] ?? ""}`;
      목록.push({ 날짜: 행[날], 이름: 행[이름] ?? "", 금액: 금액읽기(행[금], 경고, 위치), 분류: 행[분류] ?? "", 메모: 행[메모] ?? "" });
    }
  }
  return { 지출, 입금, 경고 };
}

export function 카테고리목록(text) {
  return String(text || "").split(/\r?\n/).map(l => (l.match(/^- ([^:\s]+):/) || [])[1]).filter(Boolean);
}

function 항목읽기(text, 기준열, 숫자열, 경고, 종료포함) {
  const 표 = 표읽기(text).find(t => t.머리.includes(기준열));
  if (!표) return [];
  return 표.행.filter(행 => 행[0]).map(행 => {
    const 항목 = 객체행(표, 행);
    for (const 이름 of 숫자열) 항목[이름] = 금액읽기(항목[이름], 경고, `${항목.이름} ${이름}`);
    return 항목;
  }).filter(항목 => 종료포함 || 항목.상태 !== "종료");
}

export const 고정지출읽기 = (text, 경고 = [], 종료포함 = false) =>
  항목읽기(text, "주기", ["금액"], 경고, 종료포함).sort((a, b) => (Number(a.결제일) || 0) - (Number(b.결제일) || 0));

export const 대출읽기 = (text, 경고 = [], 종료포함 = false) =>
  항목읽기(text, "잔액", ["잔액", "금리", "월상환액"], 경고, 종료포함).sort((a, b) => a.만기일.localeCompare(b.만기일));

const 합 = rs => rs.reduce((s, r) => s + r.금액, 0);
const 이달 = (rs, 월) => rs.filter(r => r.날짜.startsWith(월));

export function 월요약(지출, 입금, 월) {
  const 입 = 이달(입금, 월);
  const 포인트 = 합(입.filter(r => r.분류 === "포인트"));
  const 현금입금 = 합(입) - 포인트;
  const 쓴돈 = 합(이달(지출, 월));
  return { 현금입금, 포인트, 지출: 쓴돈, 차액: 현금입금 - 쓴돈 };
}

export function 카테고리별(지출, 월) {
  const 이번 = 이달(지출, 월), 전체 = 합(이번), 맵 = new Map();
  for (const r of 이번) 맵.set(r.분류, (맵.get(r.분류) || 0) + r.금액);
  return [...맵].sort((a, b) => b[1] - a[1]).map(([분류, 합계]) => ({ 분류, 합계, 비중: 전체 ? Math.round(합계 / 전체 * 100) : null }));
}

// 목록이 비어 있으면(파일을 못 읽음) 검사하지 않는다.
export function 목록밖카테고리(지출, 월, 목록) {
  return 목록.length ? 이달(지출, 월).filter(r => !목록.includes(r.분류)) : [];
}

export function 연간(지출, 입금, 연) {
  const 줄 = [];
  for (let m = 1; m <= 12; m++) {
    const 월 = `${연}-${String(m).padStart(2, "0")}`;
    if (!이달(지출, 월).length && !이달(입금, 월).length) continue;
    줄.push({ 월, ...월요약(지출, 입금, 월) });
  }
  return 줄;
}

export function 연간입금(입금, 연) {
  const 목록 = 입금.filter(r => r.날짜.startsWith(연)).sort((a, b) => b.날짜.localeCompare(a.날짜));
  const 종류별 = new Map();
  for (const r of 목록) 종류별.set(r.분류, (종류별.get(r.분류) || 0) + r.금액);
  return { 목록, 종류별: [...종류별].sort((a, b) => b[1] - a[1]) };
}

export function 남은기간(날짜, 오늘 = new Date()) {
  if (!날짜형식.test(날짜 || "")) return "-";
  const [y, m] = 날짜.split("-").map(Number);
  const 개월 = (y - 오늘.getFullYear()) * 12 + (m - 1) - 오늘.getMonth();
  return 개월 < 0 ? "만기 지남" : `${개월}개월`;
}

// 연 주기는 12로 나눠 월 환산한다. 저축은 지출성과 따로 센다.
export function 고정지출요약(항목들) {
  const 월환산 = it => it.금액 / (it.주기 === "연" ? 12 : 1);
  return {
    지출성: 항목들.filter(it => it.유형 !== "저축").reduce((s, it) => s + 월환산(it), 0),
    저축: 항목들.filter(it => it.유형 === "저축").reduce((s, it) => s + 월환산(it), 0),
  };
}

// 유형별 월 환산 합계. 정해 둔 순서대로, 목록에 없는 유형은 뒤에 붙인다.
export const 유형순서 = ["구독", "보험", "통신비", "저축", "기타"];
export function 유형별(항목들) {
  const 맵 = new Map();
  for (const it of 항목들) 맵.set(it.유형 || "기타", (맵.get(it.유형 || "기타") || 0) + it.금액 / (it.주기 === "연" ? 12 : 1));
  const 순위 = 유형 => (유형순서.includes(유형) ? 유형순서.indexOf(유형) : 유형순서.length);
  return [...맵].sort((a, b) => 순위(a[0]) - 순위(b[0]));
}

export const 대출요약 = 항목들 => ({
  잔액합계: 항목들.reduce((s, it) => s + it.잔액, 0),
  월상환합계: 항목들.reduce((s, it) => s + it.월상환액, 0),
});

// 달마다 그때 내던 고정 지출·대출 상환. 시작일~만기일 사이 달만 센다(비어 있으면 끝없이).
// 종료된 줄은 만기일까지만 센다. 만기일 없이 종료된 줄은 언제 끝났는지 몰라 세지 않는다.
export function 고정월별(고정, 대출, 달들) {
  const 그달 = (it, 월) => (!it.시작일 || it.시작일.slice(0, 7) <= 월) && (!it.만기일 || it.만기일.slice(0, 7) >= 월)
    && (it.상태 !== "종료" || !!it.만기일);
  return 달들.map(월 => {
    const 고 = 고정지출요약(고정.filter(it => 그달(it, 월)));
    const 상환 = 대출.filter(it => 그달(it, 월)).reduce((s, it) => s + it.월상환액, 0);
    return { 월, ...고, 상환, 합계: 고.지출성 + 고.저축 + 상환 };
  });
}

export const 원 = n => `${Math.round(n).toLocaleString("ko-KR")}원`;

// 월 파일의 "## 메모" 아래 "- YYYY-MM-DD: 내용" 줄들. 날짜는 메모를 쓴 날이다.
export function 메모읽기(text) {
  const 메모 = [];
  let 안 = false;
  for (const 줄 of String(text || "").split(/\r?\n/)) {
    const 제목 = 줄.match(/^#{1,6}\s*(.+?)\s*$/);
    if (제목) { 안 = 제목[1] === "메모"; continue; }
    const m = 안 && 줄.match(/^- (\d{4}-\d{2}-\d{2}):\s?(.*)$/);
    if (m) 메모.push({ 날짜: m[1], 내용: m[2] });
  }
  return 메모;
}

// 메모는 한 줄로만 저장한다(줄바꿈으로 표나 제목이 끼어들지 않게).
export const 메모정리 = 내용 => String(내용 ?? "").replace(/\s+/g, " ").trim();

// "## 메모" 맨 아래에 한 줄을 더한 새 파일 내용. 칸이 없으면 파일 끝에 만든다. 줄바꿈 방식은 원래대로 둔다.
export function 메모추가(text, 날짜, 내용) {
  const 원본 = String(text || "");
  const nl = 원본.includes("\r\n") ? "\r\n" : "\n";
  const 줄들 = 원본.replace(/\s+$/, "").split(/\r?\n/);
  const 새줄 = `- ${날짜}: ${메모정리(내용)}`;
  const 시작 = 줄들.findIndex(l => /^#{1,6}\s*메모\s*$/.test(l));
  if (시작 < 0) return [...줄들, "", "## 메모", "", 새줄].join(nl) + nl;
  let 끝 = 줄들.findIndex((l, i) => i > 시작 && /^#{1,6}\s/.test(l));
  if (끝 < 0) 끝 = 줄들.length;
  let 넣을곳 = 끝;
  while (넣을곳 > 시작 + 1 && 줄들[넣을곳 - 1].trim() === "") 넣을곳--;
  줄들.splice(넣을곳, 0, ...(넣을곳 === 시작 + 1 ? ["", 새줄] : [새줄]));
  return 줄들.join(nl) + nl;
}
