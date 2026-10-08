// ============================================================
// 画面の明るさの切り替え (☀ 昼のノート / 🌙 夜のノート)
//  - 右上のボタンで選んだほうを覚えておく (この端末のこのブラウザに保存)
//  - まだ選んでいないときは、端末 (Chrome や Windows) の設定に合わせる
// ※ 画面が一瞬ちがう色で表示されないよう、ページの最初 (<head>) で読み込む
// ============================================================
(function () {
  const KEY = "oshimemo-theme";
  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: dark)");

  // 前に選んだ明るさを読み込む (保存できない環境でも動くように try で囲む)
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch {}

  // 今が「夜のノート」かどうか
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : media.matches);

  // ボタンの絵とスマホの上の帯の色を、今の明るさに合わせる
  function update() {
    const dark = isDark();
    const btn = document.getElementById("btn-theme");
    if (btn) {
      btn.textContent = dark ? "☀" : "🌙";
      btn.title = dark ? "昼のノート (明るい画面) にする" : "夜のノート (暗い画面) にする";
      btn.setAttribute("aria-label", btn.title);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#22201d" : "#f5f0e6";
  }

  // ボタンを押したら切り替えて、選んだほうを保存する
  function toggle() {
    root.dataset.theme = isDark() ? "light" : "dark";
    try {
      localStorage.setItem(KEY, root.dataset.theme);
    } catch {}
    update();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btn-theme");
    if (btn) btn.addEventListener("click", toggle);
    update();
  });
  // 端末の設定が変わったときも合わせる (自分で選んでいないとき)
  media.addEventListener("change", update);
})();
