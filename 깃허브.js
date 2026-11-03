// GitHub에서 가계부를 직접 읽고, 월 메모를 직접 커밋한다. 중간 서버는 없다.
// 토큰은 이 기기 브라우저(localStorage)에만 저장하고 api.github.com 말고는 보내지 않는다.
import { 메모추가, 메모정리 } from "./파서.js";

export const 저장소 = "baha1909/Lensec-git";
const 가지 = "main";
const 토큰키 = "lensec-token";

let 임시토큰 = ""; // 브라우저 저장이 막힌 경우(사생활 보호 모드 등) 이번 방문 동안만 쓴다
export const 토큰 = {
  읽기: () => { try { return localStorage.getItem(토큰키) || 임시토큰; } catch { return 임시토큰; } },
  쓰기: 값 => { 임시토큰 = 값; try { localStorage.setItem(토큰키, 값); } catch {} },
  지우기: () => { 임시토큰 = ""; try { localStorage.removeItem(토큰키); } catch {} },
};

export class 토큰오류 extends Error {}

const 경로 = p => p.split("/").map(encodeURIComponent).join("/");

async function 호출(주소, 옵션 = {}) {
  const 응답 = await fetch(`https://api.github.com/repos/${저장소}${주소}`, {
    cache: "no-store",
    ...옵션,
    headers: { Authorization: `Bearer ${토큰.읽기()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...옵션.headers },
  });
  if (응답.status === 401) throw new 토큰오류("토큰이 맞지 않거나 만료됐습니다. 새 토큰을 넣어 주세요.");
  return 응답;
}

export async function 연결확인() {
  const 응답 = await 호출("");
  if (!응답.ok) throw new 토큰오류("이 토큰으로는 가계부 저장소를 열 수 없습니다. 토큰을 만들 때 고른 저장소와 권한(Contents)을 확인해 주세요.");
}

async function 글읽기(p) {
  const 응답 = await 호출(`/contents/${경로(p)}?ref=${가지}`, { headers: { Accept: "application/vnd.github.raw+json" } });
  if (응답.status === 404) return "";
  if (!응답.ok) throw new Error(`GitHub에서 ${p}를 읽지 못했습니다(${응답.status}).`);
  return 응답.text();
}

export async function 원문가져오기() {
  const 응답 = await 호출(`/contents/${경로("01_현금흐름/가계부")}?ref=${가지}`);
  if (!응답.ok && 응답.status !== 404) throw new Error(`GitHub에서 가계부 목록을 읽지 못했습니다(${응답.status}).`);
  const 달파일 = (응답.ok ? await 응답.json() : []).map(f => f.name).filter(n => /^\d{4}-\d{2}\.md$/.test(n)).sort();
  const [카테고리, 고정지출, 대출, ...월글] = await Promise.all([
    글읽기("01_현금흐름/가계부/_카테고리.md"),
    글읽기("02_고정지출·대출/고정지출.md"),
    글읽기("02_고정지출·대출/대출.md"),
    ...달파일.map(n => 글읽기(`01_현금흐름/가계부/${n}`)),
  ]);
  return { 가계부: Object.fromEntries(달파일.map((n, i) => [n.slice(0, 7), 월글[i]])), 카테고리, 고정지출, 대출 };
}

const 인코딩 = 글 => {
  const 바이트 = new TextEncoder().encode(글);
  let s = "";
  for (let i = 0; i < 바이트.length; i += 0x8000) s += String.fromCharCode(...바이트.subarray(i, i + 0x8000));
  return btoa(s);
};
const 디코딩 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

// 월 파일 하나에 메모 한 줄을 더해 커밋하고, 커밋한 새 내용을 돌려준다.
// 그사이 Muse가 같은 파일을 고쳤으면 GitHub가 sha 불일치로 거절하므로, 다시 읽어 최대 3번 시도한다.
export async function 메모저장(월, 내용, 오늘 = new Date().toLocaleDateString("sv-SE")) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(월)) throw new Error("월 형식이 잘못됐습니다.");
  const 한줄 = 메모정리(내용);
  if (!한줄 || 한줄.length > 500) throw new Error("메모는 1~500자로 써 주세요.");
  const p = `01_현금흐름/가계부/${월}.md`;
  for (let 시도 = 0; 시도 < 3; 시도++) {
    const 응답 = await 호출(`/contents/${경로(p)}?ref=${가지}`);
    let 원래, sha;
    if (응답.status === 404) 원래 = (await 글읽기("99_템플릿/월별가계부.md")).replaceAll("YYYY-MM", 월);
    else if (응답.ok) { const 파일 = await 응답.json(); 원래 = 디코딩(파일.content); sha = 파일.sha; }
    else throw new Error(`GitHub에서 ${월} 파일을 읽지 못했습니다(${응답.status}).`);
    const 새내용 = 메모추가(원래, 오늘, 한줄);
    const 결과 = await 호출(`/contents/${경로(p)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `가계부 메모 추가 (${월})`, content: 인코딩(새내용), branch: 가지, ...(sha ? { sha } : {}) }),
    });
    if (결과.ok) return 새내용;
    if (결과.status !== 409 && 결과.status !== 422) {
      throw new Error(`메모를 저장하지 못했습니다(GitHub ${결과.status}). 토큰에 쓰기 권한(Contents: Read and write)이 있는지 확인해 주세요.`);
    }
  }
  throw new Error("다른 곳에서 같은 달 파일을 계속 고치고 있어 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
