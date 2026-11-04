// Общее для всех тестов: какой браузер запускать (BROWSER=chromium | webkit) и касания пальцем.
//
// Тесты писались под Chromium и шлют касания через его протокол отладки (CDP: Input.dispatchTouchEvent).
// У WebKit такого нет, поэтому для него касания создаются прямо на странице — те же touchstart/touchmove/
// touchend с теми же координатами. Как и в настоящем браузере, всё касание приходит элементу, на который
// пришёлся палец, даже если его потом убрали со страницы (на этом попадался движок жестов).
let pw;
for (const m of ["playwright", "/opt/npm-tools/node_modules/playwright/index.mjs"]) {
  try { pw = await import(m); break; } catch (e) { /* пробуем дальше */ }
}
if (!pw) throw new Error("не найден playwright: npm install в папке ci");

export const BROWSER = process.env.BROWSER === "webkit" ? "webkit" : "chromium";
const type = BROWSER === "webkit" ? pw.webkit : pw.chromium;
// тесты зовут chromium.launch() — подставляем выбранный браузер
export const chromium = { launch: (o) => type.launch(o) };
export const isWebKit = BROWSER === "webkit";

function pageTouch(page) {
  const map = { touchStart: "touchstart", touchMove: "touchmove", touchEnd: "touchend", touchCancel: "touchcancel" };
  return {
    async send(method, params) {
      if (method !== "Input.dispatchTouchEvent") return {};   // другое из CDP (замедление процессора) — только в Chromium
      const pts = (params.touchPoints || []).map((t) => ({ x: t.x, y: t.y }));
      await page.evaluate(({ type, pts }) => {
        const st = window.__ts || (window.__ts = { target: null, last: [], moved: false });
        if (type === "touchstart") { st.target = document.elementFromPoint(pts[0].x, pts[0].y) || document.body; st.moved = false; }
        if (!st.target) return;
        if (type === "touchmove") st.moved = true;
        const mk = (p) => {
          const o = { identifier: 1, target: st.target, clientX: p.x, clientY: p.y, pageX: p.x + scrollX, pageY: p.y + scrollY,
            screenX: p.x, screenY: p.y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 };
          try { return new Touch(o); } catch (e) { return o; }
        };
        const touches = pts.map(mk), changed = touches.length ? touches : st.last;
        let ev;
        try { ev = new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches, targetTouches: touches, changedTouches: changed }); }
        catch (e) {   // без конструктора TouchEvent — обычное событие с теми же полями
          ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
          for (const [k, v] of Object.entries({ touches, targetTouches: touches, changedTouches: changed })) Object.defineProperty(ev, k, { value: v });
        }
        if (touches.length) st.last = touches;
        st.target.dispatchEvent(ev);
        // v2.0: лента дней — родная прокрутка. Подменные касания её не двигают (браузер прокручивает только
        // по настоящим), поэтому здесь повторяем то, что делает телефон: палец ведёт ленту 1:1, касание
        // останавливает её на лету, после отпускания она доезжает до соседнего дня (по скорости и пройденному пути).
        const P = pts[0], now = performance.now();
        if (type === "touchstart") {
          const pg = st.target.closest && st.target.closest("[data-pager]");
          st.pg = pg && getComputedStyle(pg).overflowX !== "hidden" ? pg : null; st.x0 = P.x; st.y0 = P.y; st.axis = 0; st.h = [{ t: now, x: P.x }];
          if (st.pg) { st.sl0 = st.pg.scrollLeft; st.pg.scrollTo({ left: st.sl0, behavior: "instant" }); }
        } else if (type === "touchmove" && st.pg) {
          const dx = P.x - st.x0, dy = P.y - st.y0;
          if (!st.axis && Math.hypot(dx, dy) > 7) st.axis = Math.abs(dx) > Math.abs(dy) ? 1 : -1;
          st.h.push({ t: now, x: P.x });
          if (st.axis === 1 && getComputedStyle(st.pg).overflowX !== "hidden") {
            st.pg.style.scrollSnapType = "none";
            st.pg.scrollLeft = st.sl0 - dx;
          }
        } else if (type === "touchend" && st.pg) {
          const pg = st.pg; st.pg = null;
          const W = pg.clientWidth || 1, s0 = Math.round(st.sl0 / W), f = pg.scrollLeft / W;
          const h = st.h.filter((q) => now - q.t <= 80), v = h.length > 1 ? (h[h.length - 1].x - h[0].x) / Math.max(8, h[h.length - 1].t - h[0].t) : 0;
          let to = Math.round(f);
          if (st.axis === 1 && v < -0.3) to = Math.ceil(f - 0.001); else if (st.axis === 1 && v > 0.3) to = Math.floor(f + 0.001);
          to = Math.max(s0 - 1, Math.min(s0 + 1, to));   // как scroll-snap-stop: always — не дальше одного дня
          pg.style.scrollSnapType = "";
          pg.scrollTo({ left: Math.max(0, Math.min(pg.scrollWidth - W, to * W)), behavior: "smooth" });
        }
        // короткое касание без сдвига — это нажатие: настоящий браузер следом присылает click
        if (type === "touchend" && !st.moved && !ev.defaultPrevented && st.target.isConnected) {
          const p = st.last[0] || { clientX: 0, clientY: 0 };
          st.target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, clientX: p.clientX, clientY: p.clientY }));
        }
      }, { type: map[params.type] || params.type, pts });
      return {};
    },
    async detach() {},
  };
}

// замена context.newCDPSession(page): в Chromium — настоящий CDP, в WebKit — касания на странице
// TOUCH=page — касания «как для WebKit» и в Chromium: так проверяется сама эта подмена
export async function touchSession(page) {
  if (!isWebKit && process.env.TOUCH !== "page") return page.context().newCDPSession(page);
  return pageTouch(page);
}
