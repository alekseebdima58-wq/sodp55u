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
