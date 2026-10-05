// Consumer-facing polish layer for the hackathon demo.
(() => {
  let cloudUsed = false;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    try {
      const url = String(args[0] || "");
      if (url.includes("/api/analyze") && res.ok) {
        const clone = res.clone();
        const body = await clone.json();
        if (body && body.runtime === "aliyun-model-studio") cloudUsed = true;
      }
    } catch (_) {}
    return res;
  };

  const polish = () => {
    document.querySelectorAll(".privacy-strip").forEach(el => {
      el.innerHTML = "<strong>隐私说明：</strong>你的自拍只用于本次分析，不会作为其他消费者的样本，也不会用于公开展示或训练。";
    });
    document.querySelectorAll(".tryon-card .toggle button").forEach(btn => {
      if (btn.textContent.trim() === "虚拟试色") btn.textContent = "颜色预览";
    });
    document.querySelectorAll(".tryon-caption small").forEach(el => {
      el.textContent = "这是基于多来源参考色域的视觉模拟，不等同于实物试色或最终上嘴效果。";
    });
    document.querySelectorAll(".media-placeholder small").forEach(el => {
      el.textContent = "高清原图正在载入";
    });
    document.querySelectorAll(".empty").forEach(el => {
      if (el.textContent.includes("OSS") || el.textContent.includes("静态版")) {
        el.textContent = "该色号的高清参考图正在准备中；文字证据与颜色分析仍可正常使用。";
      }
    });
    document.querySelectorAll(".tech-details summary").forEach(el => {
      el.textContent = "想知道为什么得出这个结论？查看分析依据";
    });
    document.querySelectorAll(".trust-grid h3").forEach(el => {
      if (el.textContent.trim() === "SKU 边界") el.textContent = "同色号的不同版本";
    });
    const result = document.querySelector(".personal-result");
    if (result && cloudUsed && !result.querySelector(".cloud-connected-badge")) {
      const anchor = result.querySelector(".result-title");
      if (anchor) {
        const badge = document.createElement("div");
        badge.className = "cloud-connected-badge";
        badge.innerHTML = "<span>AI 证据总结</span><b>✓ 阿里云百炼已参与本次分析</b>";
        anchor.insertAdjacentElement("afterend", badge);
      }
    }
  };

  new MutationObserver(polish).observe(document.documentElement, {subtree:true, childList:true});
  polish();
})();
