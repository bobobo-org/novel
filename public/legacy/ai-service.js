(function () {
  "use strict";

  function maskKey(key) {
    if (!key) return "";
    return key.length <= 8 ? "****" : `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  function getConfig() {
    return {
      provider: document.getElementById("aiProvider")?.value || "chat",
      endpoint: document.getElementById("aiEndpoint")?.value || "",
      model: document.getElementById("aiModel")?.value || "",
      token: sessionStorage.getItem("novel_session_ai_token") || document.getElementById("aiToken")?.value || ""
    };
  }

  function saveSessionToken() {
    const input = document.getElementById("aiToken");
    if (input?.value) sessionStorage.setItem("novel_session_ai_token", input.value);
    if (input?.value) input.value = maskKey(input.value);
  }

  function clearToken() {
    sessionStorage.removeItem("novel_session_ai_token");
    localStorage.removeItem("novel_external_ai_cfg");
    const input = document.getElementById("aiToken");
    if (input) input.value = "";
    return "已清除本次工作階段的 AI 金鑰。";
  }

  function validateConfig(config) {
    if (config.provider === "cloud" || config.provider === "openai" || config.provider === "chat") {
      if (!navigator.onLine) throw new Error("目前離線，雲端 AI 需要網路。");
      if (!config.endpoint) throw new Error("尚未設定雲端 AI 端點。");
      if (!config.model) throw new Error("尚未設定雲端 AI 模型名稱。");
      if (!config.token) throw new Error("尚未提供雲端 AI 金鑰。金鑰只會暫存在 sessionStorage。");
    }
    if (config.provider === "ollama") {
      if (!config.endpoint) config.endpoint = "http://localhost:11434/api/generate";
      if (!config.model) throw new Error("尚未設定 Ollama 模型名稱。");
    }
    if (config.provider === "lmstudio") {
      if (!config.endpoint) config.endpoint = "http://localhost:1234/v1/chat/completions";
      if (!config.model) throw new Error("尚未設定 LM Studio 模型名稱。");
    }
  }

  async function timeoutFetch(url, options = {}, timeoutMs = 45000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }

  async function generate(prompt, options = {}) {
    const config = { ...getConfig(), ...(options.config || {}) };
    validateConfig(config);

    if (config.provider === "ollama") {
      let response;
      try {
        response = await timeoutFetch(config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: config.model, prompt, stream: false })
        }, options.timeoutMs || 45000);
      } catch (error) {
        throw new Error("尚未連接本機模型：Ollama 未啟動或端點無法連線。");
      }
      if (!response.ok) throw new Error(`Ollama 回應失敗：HTTP ${response.status}`);
      const data = await response.json();
      return data.response || data.message || "";
    }

    if (config.provider === "lmstudio") {
      let response;
      try {
        response = await timeoutFetch(config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.8
          })
        }, options.timeoutMs || 45000);
      } catch (error) {
        throw new Error("尚未連接本機模型：LM Studio 未啟動或端點無法連線。");
      }
      if (!response.ok) throw new Error(`LM Studio 回應失敗：HTTP ${response.status}`);
      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
    }

    let response;
    try {
      response = await timeoutFetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.token}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.85
        })
      }, options.timeoutMs || 60000);
    } catch (error) {
      throw new Error("雲端 AI 連線逾時或網路中斷。");
    }
    if (!response.ok) throw new Error(`雲端 AI 回應失敗：HTTP ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || data.output_text || "";
  }

  async function checkLocalModel() {
    const config = getConfig();
    if (config.provider === "ollama") {
      try {
        const base = config.endpoint || "http://localhost:11434/api/generate";
        const url = base.replace(/\/api\/generate.*$/, "/api/tags");
        const response = await timeoutFetch(url, {}, 2500);
        return response.ok ? "本機模型已連線" : "尚未連接本機模型";
      } catch (error) {
        return "尚未連接本機模型";
      }
    }
    if (config.provider === "lmstudio") {
      try {
        const base = config.endpoint || "http://localhost:1234/v1/chat/completions";
        const url = base.replace(/\/chat\/completions.*$/, "/models");
        const response = await timeoutFetch(url, {}, 2500);
        return response.ok ? "本機模型已連線" : "尚未連接本機模型";
      } catch (error) {
        return "尚未連接本機模型";
      }
    }
    return "本機模型未連線";
  }

  window.NovelAIService = {
    getConfig,
    validateConfig,
    generate,
    checkLocalModel,
    saveSessionToken,
    clearToken,
    maskKey
  };
})();
