import {
  거래읽기, 카테고리목록, 고정지출읽기, 대출읽기, 월요약, 카테고리별, 목록밖카테고리,
  연간, 연간입금, 남은기간, 고정지출요약, 대출요약, 고정월별, 유형별, 원, 메모읽기,
} from "./파서.js";
import { 토큰, 토큰오류, 연결확인, 원문가져오기, 메모저장 } from "./깃허브.js";

const 탭들 = ["월", "연", "고정지출", "월급", "메모"];
const $ = id => document.getElementById(id);
const 상태 = { 원문: null, 데이터: null, 월: "", 연: "", 탭: "월" };

// 모든 글자는 textContent로만 넣는다(저장소 내용이 HTML로 해석되지 않게).
function 만들기(태그, 클래스, 글, 속성 = {}) {
  const 요소 = document.createElement(태그);
  if (클래스) 요소.className = 클래스;
  if (글 !== undefined) 요소.textContent = 글;
  for (const [k, v] of Object.entries(속성)) 요소.setAttribute(k, v);
  return 요소;
}

const 긴열 = new Set(["상호", "출처", "이름", "메모"]); // 길어질 수 있어 …로 줄이는 열

// 셀은 문자열이거나 [글, 클래스]. 숫자 열은 머리 이름 뒤에 '#'을 붙여 표시한다.
function 표(머리, 행들, 빈문구 = "내역이 없습니다.", 행클래스 = () => "") {
  if (!행들.length) return 만들기("p", "빈문구", 빈문구);
  const 표요소 = 만들기("table");
  const thead = 만들기("thead"), tbody = 만들기("tbody"), tr = 만들기("tr");
  머리.forEach(h => tr.append(만들기("th", h.endsWith("#") ? "금액" : "", h.replace("#", ""))));
  thead.append(tr);
  표요소.append(thead, tbody);
  for (const [번호, 행] of 행들.entries()) {
    const 줄 = 만들기("tr", 행클래스(번호));
    행.forEach((셀, i) => {
      const [글, 클래스] = Array.isArray(셀) ? 셀 : [셀, ""];
      const 긴 = 긴열.has(머리[i]);
      줄.append(만들기("td", [머리[i].endsWith("#") ? "금액" : "", 클래스, 긴 ? "긴글" : ""].join(" ").trim(), 글, 긴 && 글 ? { title: 글 } : {}));
    });
    tbody.append(줄);
  }
  const 틀 = 만들기("div", "표틀");
  틀.append(표요소);
  return 틀;
}

const 카드 = (라벨, 값, 음수 = false, 주요 = false) => {
  const 요소 = 만들기("div", 주요 ? "카드 주요" : "카드");
  요소.append(만들기("span", "", 라벨), 만들기("strong", 음수 ? "음수" : "", 값));
  return 요소;
};
const 부호 = n => (n < 0 ? "음수" : "");
const 합계줄 = (...조각) => {
  const p = 만들기("p", "합계");
  조각.forEach(([라벨, 값], i) => { if (i) p.append(" · "); p.append(`${라벨} `, 만들기("b", "", 값)); });
  return p;
};

function 분석(원문) {
  const 지출 = [], 입금 = [], 경고 = [];
  for (const [월, 글] of Object.entries(원문.가계부)) {
    const r = 거래읽기(글);
    지출.push(...r.지출);
    입금.push(...r.입금);
    경고.push(...r.경고.map(w => `${월}: ${w}`));
  }
  const 이번달 = new Date().toLocaleDateString("sv-SE").slice(0, 7); // YYYY-MM (로컬 시간)
  const 달목록 = [...new Set([...지출, ...입금].map(r => r.날짜.slice(0, 7)).concat(Object.keys(원문.가계부), 이번달))].sort();
  const 고정전체 = 고정지출읽기(원문.고정지출, 경고, true), 대출전체 = 대출읽기(원문.대출, 경고, true);
  const 진행중 = it => it.상태 !== "종료";
  return {
    지출, 입금, 경고, 달목록, 이번달, 고정전체, 대출전체,
    카테고리: 카테고리목록(원문.카테고리),
    고정: 고정전체.filter(진행중),
    대출: 대출전체.filter(진행중),
    메모: Object.fromEntries(Object.entries(원문.가계부).map(([월, 글]) => [월, 메모읽기(글)])),
  };
}

function 월탭(d, 내용) {
  const 요약 = 월요약(d.지출, d.입금, 상태.월);
  const 카드들 = 만들기("div", "카드들");
  카드들.append(
    카드("지출", 원(요약.지출), false, true), 카드("차액", 원(요약.차액), 요약.차액 < 0),
    카드("포인트(별도)", 원(요약.포인트)), 카드("입금(현금)", 원(요약.현금입금)),
  );
  내용.append(카드들);
  const 나쁜 = 목록밖카테고리(d.지출, 상태.월, d.카테고리);
  if (나쁜.length) 알림추가(`카테고리 확인 필요: ${나쁜.map(r => `${r.날짜} ${r.이름}(${r.분류 || "비어 있음"})`).join(", ")}`);

  // 최근 날짜부터. 같은 날은 나중에 적힌 거래가 위로 온다.
  const 이번 = d.지출.filter(r => r.날짜.startsWith(상태.월)).reverse().sort((a, b) => b.날짜.localeCompare(a.날짜));
  // 월은 위에 보이므로 일만 쓰고, 같은 날은 첫 줄에만 적어 선으로 묶는다.
  const 새날 = i => i === 0 || 이번[i].날짜 !== 이번[i - 1].날짜;
  내용.append(만들기("h2", "", "지출 (날짜별)"),
    표(["일", "상호", "금액#", "카테고리", "메모"], 이번.map((r, i) => [새날(i) ? `${Number(r.날짜.slice(8))}일` : "", r.이름, 원(r.금액), r.분류, r.메모]),
      undefined, i => (i > 0 && 새날(i) ? "날경계" : "")));
  내용.append(만들기("h2", "", "지출 (카테고리별)"),
    표(["카테고리", "합계#", "비중#"], 카테고리별(d.지출, 상태.월).map(r => [r.분류, 원(r.합계), r.비중 === null ? "-" : `${r.비중}%`])));
}

const 요일 = 날짜 => { const [y, m, d] = 날짜.split("-").map(Number); return "일월화수목금토"[new Date(y, m - 1, d).getDay()]; };

// 메모 탭: 달별로 묶어 최신순. 날짜는 메모를 쓴 날(연·월·일·요일)을 그대로 보여준다.
function 메모탭(d, 내용) {
  const 달들 = Object.keys(d.메모).filter(월 => d.메모[월].length).sort().reverse();
  if (!달들.length) { 내용.append(만들기("p", "빈문구", "아직 메모가 없습니다. 위의 + 버튼으로 적어 보세요.")); return; }
  for (const 월 of 달들) {
    내용.append(만들기("h2", "", `${월.slice(0, 4)}년 ${Number(월.slice(5))}월`));
    const 목록 = 만들기("ul", "메모목록");
    const 정렬 = d.메모[월].map((m, i) => [m, i]).sort((a, b) => b[0].날짜.localeCompare(a[0].날짜) || b[1] - a[1]);
    for (const [m] of 정렬) {
      const li = 만들기("li");
      li.append(만들기("time", "메모날짜", `${m.날짜.replaceAll("-", ".")} (${요일(m.날짜)})`, { datetime: m.날짜 }), 만들기("span", "", m.내용));
      목록.append(li);
    }
    내용.append(목록);
  }
}

// 맨 위 + 버튼과 입력칸. 탭을 바꿔도 쓰던 글이 지워지지 않도록 한 번만 연결한다.
function 메모폼준비() {
  const 버튼 = $("메모추가"), 폼 = $("메모폼"), 입력 = $("메모입력"), 저장 = $("메모저장"), 안내 = $("메모안내");
  const 열기 = 열림 => {
    폼.hidden = !열림;
    버튼.setAttribute("aria-expanded", String(열림));
    if (열림) { 안내.textContent = ""; 입력.focus(); }
  };
  버튼.addEventListener("click", () => 열기(폼.hidden));
  $("메모취소").addEventListener("click", () => 열기(false));
  폼.addEventListener("submit", async e => {
    e.preventDefault();
    const 글 = 입력.value.trim();
    if (!글) { 안내.textContent = "내용을 적어 주세요."; return; }
    const 월 = 상태.월;
    저장.disabled = true;
    안내.textContent = "저장 중…";
    try {
      // 방금 커밋한 내용으로 바로 갱신한다(GitHub에서 다시 읽으면 잠깐 옛 내용이 올 수 있다).
      상태.원문.가계부[월] = await 메모저장(월, 글);
      상태.데이터 = 분석(상태.원문);
      입력.value = "";
      열기(false);
      안내.textContent = `${월.replace("-", ".")} 메모로 저장했어요. 메모 탭에서 볼 수 있어요.`;
      그리기();
    } catch (오류) {
      if (오류 instanceof 토큰오류) return 연결화면(오류.message);
      안내.textContent = 오류.message || "저장하지 못했습니다. 잠시 후 다시 시도하세요.";
    } finally {
      저장.disabled = false;
    }
  });
}

// 토큰이 없거나 맞지 않으면 연결 화면을 보여준다.
function 연결화면(메시지 = "") {
  $("앱").hidden = true;
  $("연결").hidden = false;
  $("연결안내").textContent = 메시지;
  $("토큰입력").focus();
}

function 연결준비() {
  $("연결폼").addEventListener("submit", async e => {
    e.preventDefault();
    const 값 = $("토큰입력").value.trim();
    if (!값) { $("연결안내").textContent = "토큰을 넣어 주세요."; return; }
    $("연결안내").textContent = "확인 중…";
    토큰.쓰기(값);
    try {
      await 연결확인();
    } catch (오류) {
      토큰.지우기();
      $("연결안내").textContent = 오류 instanceof 토큰오류 ? 오류.message : "GitHub에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
      return;
    }
    $("토큰입력").value = "";
    await 불러오기();
  });
  $("연결해제").addEventListener("click", () => { 토큰.지우기(); location.reload(); });
}

async function 불러오기() {
  try {
    상태.원문 = await 원문가져오기();
  } catch (오류) {
    if (오류 instanceof 토큰오류) return 연결화면(오류.message);
    const 글 = `GitHub에서 불러오지 못했습니다. 잠시 후 다시 열어 주세요. (${오류.message})`;
    if (상태.데이터) 알림추가(글); else { $("연결").hidden = true; $("앱").hidden = false; $("내용").replaceChildren(만들기("p", "알림줄", 글)); }
    return;
  }
  const 처음 = !상태.데이터;
  상태.데이터 = 분석(상태.원문);
  if (처음) {
    상태.월 = 상태.데이터.이번달;
    상태.연 = 상태.월.slice(0, 4);
    const 해시 = decodeURIComponent(location.hash.slice(1));
    if (탭들.includes(해시)) 상태.탭 = 해시;
  }
  $("연결").hidden = true;
  $("앱").hidden = false;
  그리기();
}

function 연탭(d, 내용) {
  const 줄 = 연간(d.지출, d.입금, 상태.연).reverse(); // 최근 달부터
  내용.append(만들기("h2", "", `${상태.연}년 월별`),
    표(["월", "지출#", "차액#", "포인트#", "입금#"], 줄.map(r => [r.월, 원(r.지출), [원(r.차액), 부호(r.차액)], 원(r.포인트), 원(r.현금입금)]), "이 해의 내역이 없습니다."));
}

function 고정탭(d, 내용) {
  const 요약 = 고정지출요약(d.고정);
  const 대출합 = 대출요약(d.대출);
  const 유형들 = 유형별(d.고정);
  const 카드들 = 만들기("div", "카드들 좁게");
  카드들.append(카드(`${Number(d.이번달.slice(5))}월 고정지출`, 원(요약.지출성 + 요약.저축 + 대출합.월상환합계), false, true),
    ...유형들.map(([유형, 합]) => 카드(유형, 원(합))));
  if (대출합.월상환합계) 카드들.append(카드("대출 상환", 원(대출합.월상환합계)));
  // 유형별로 묶고(안에서는 결제일 순), 월 탭의 날짜처럼 유형은 첫 줄에만 적어 선으로 나눈다.
  const 순서 = 유형들.map(([유형]) => 유형);
  const 목록 = [...d.고정].sort((a, b) => 순서.indexOf(a.유형 || "기타") - 순서.indexOf(b.유형 || "기타"));
  const 새유형 = i => i === 0 || (목록[i].유형 || "기타") !== (목록[i - 1].유형 || "기타");
  내용.append(카드들, 만들기("h2", "", "고정 지출 (유형별)"),
    표(["유형", "이름", "금액#", "결제일", "주기", "만기일", "남은 기간"],
      목록.map((x, i) => [새유형(i) ? x.유형 || "기타" : "", x.이름, 원(x.금액), x.결제일 ? `${x.결제일}일` : "-", x.주기 || "월", x.만기일 || "-", 남은기간(x.만기일)]),
      "고정 지출이 없습니다.", i => (i > 0 && 새유형(i) ? "날경계" : "")),
    합계줄(["월 환산 지출성", 원(요약.지출성)], ["저축", 원(요약.저축)]));
  내용.append(만들기("h2", "", "대출"),
    표(["이름", "잔액#", "금리#", "월상환액#", "상환일", "만기일", "남은 기간", "상환방식"],
      d.대출.map(x => [x.이름, 원(x.잔액), `${x.금리}%`, 원(x.월상환액), x.상환일 ? `${x.상환일}일` : "-", x.만기일 || "-", 남은기간(x.만기일), x.상환방식]), "대출이 없습니다."),
    합계줄(["잔액 합계", 원(대출합.잔액합계)], ["월 상환 합계", 원(대출합.월상환합계)]));
  // 가계부가 있는 첫 달부터 이번 달까지, 최근 달부터
  const 줄 = 고정월별(d.고정전체, d.대출전체, d.달목록.filter(월 => 월 <= d.이번달)).filter(r => r.합계).reverse();
  내용.append(만들기("h2", "", "월별 고정 지출"),
    표(["월", "합계#", "지출성#", "저축#", "대출 상환#"], 줄.map(r => [r.월, 원(r.합계), 원(r.지출성), 원(r.저축), 원(r.상환)]), "기록이 없습니다."));
}

function 월급탭(d, 내용) {
  const { 목록, 종류별 } = 연간입금(d.입금, 상태.연);
  const 카드들 = 만들기("div", "카드들");
  종류별.forEach(([종류, 합]) => 카드들.append(카드(`${종류} 합계`, 원(합))));
  내용.append(만들기("h2", "", `${상태.연}년 입금`));
  if (종류별.length) 내용.append(카드들);
  내용.append(표(["날짜", "출처", "금액#", "종류", "메모"], 목록.map(r => [r.날짜, r.이름, 원(r.금액), r.분류, r.메모]), "이 해의 입금 내역이 없습니다."));
}

const 화면들 = { 월: 월탭, 연: 연탭, 고정지출: 고정탭, 월급: 월급탭, 메모: 메모탭 };

function 알림추가(글) { document.getElementById("알림").append(만들기("p", "알림줄", `⚠ ${글}`)); }

function 그리기() {
  const d = 상태.데이터;
  const 알림 = document.getElementById("알림");
  알림.replaceChildren();
  if (d.경고.length) 알림추가(`읽지 못한 항목 ${d.경고.length}건: ${d.경고.slice(0, 3).join(" / ")}${d.경고.length > 3 ? " …" : ""}`);

  const 연탭류 = 상태.탭 === "연" || 상태.탭 === "월급";
  // 자리는 남기고 숨긴다(탭을 바꿀 때 아래 목록이 위아래로 튀지 않게).
  $("기간").classList.toggle("숨김", 상태.탭 === "고정지출" || 상태.탭 === "메모");
  document.getElementById("기간표시").textContent = 연탭류 ? 상태.연 : 상태.월.replace("-", ".");
  document.getElementById("유령위").textContent = { 월: "month", 연: "year", 고정지출: "fixed", 월급: "income", 메모: "memo" }[상태.탭];
  document.getElementById("유령아래").textContent =
    연탭류 ? 상태.연 : 상태.탭 === "고정지출" ? "monthly" : 상태.탭 === "메모" ? "history" : 상태.월.replace("-", " – ");
  $("메모대상").textContent = `${상태.월.replace("-", ".")} 메모`;
  document.querySelectorAll("#탭 button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.탭 === 상태.탭)));

  const 내용 = document.getElementById("내용");
  내용.replaceChildren();
  화면들[상태.탭](d, 내용);
}

function 이동(방향) {
  const d = 상태.데이터;
  if (상태.탭 === "연" || 상태.탭 === "월급") { 상태.연 = String(Number(상태.연) + 방향); }
  else {
    const 다음 = d.달목록[d.달목록.indexOf(상태.월) + 방향];
    if (!다음) return;
    상태.월 = 다음;
    상태.연 = 다음.slice(0, 4);
  }
  그리기();
}

function 탭바꾸기(이름) {
  상태.탭 = 이름;
  history.replaceState(null, "", `#${encodeURIComponent(이름)}`);
  그리기();
}

async function 시작() {
  const 탭바 = document.getElementById("탭");
  탭들.forEach((이름, i) => {
    const 버튼 = 만들기("button", "", undefined, { type: "button", role: "tab" });
    버튼.append(만들기("span", "번호", String(i + 1).padStart(2, "0")), 만들기("span", "", 이름));
    버튼.dataset.탭 = 이름;
    버튼.addEventListener("click", () => 탭바꾸기(이름));
    탭바.append(버튼);
  });
  document.getElementById("이전").addEventListener("click", () => 이동(-1));
  document.getElementById("다음").addEventListener("click", () => 이동(1));
  메모폼준비();
  연결준비();
  $("내용").addEventListener("click", e => e.target.closest("td.긴글")?.classList.toggle("펼침"));
  // 다른 앱에 갔다가 돌아오면 다시 읽는다(그사이 Muse가 넣은 거래가 보이게).
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && 상태.데이터) 불러오기(); });

  if (!토큰.읽기()) return 연결화면();
  await 불러오기();
}

시작().catch(() => document.getElementById("내용").append(만들기("p", "알림줄", "화면을 그리다 오류가 났습니다.")));
