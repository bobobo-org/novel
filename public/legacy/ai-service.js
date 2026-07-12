(function () {
  "use strict";

  let currentOllamaProvider = null;

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
    if (config.provider === "gemini") {
      // Server-side route holds the key; user needs nothing but a connection.
      if (!navigator.onLine) throw new Error("目前離線，Gemini 需要網路。可改用「離線規則續寫」。");
      return;
    }
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

  function ollamaBaseUrl(endpoint = "") {
    const raw = endpoint || "http://localhost:11434";
    return raw
      .replace(/\/api\/chat.*$/i, "")
      .replace(/\/api\/generate.*$/i, "")
      .replace(/\/+$/, "");
  }

  function createOllamaProvider(config = {}) {
    let activeController = null;
    const provider = {
      id: "ollama",
      name: "Ollama",
      type: "local",
      baseUrl: ollamaBaseUrl(config.endpoint),
      async isAvailable() {
        try {
          const response = await timeoutFetch(`${provider.baseUrl}/api/tags`, {}, 3000);
          return response.ok;
        } catch (error) {
          return false;
        }
      },
      async listModels() {
        let response;
        try {
          response = await timeoutFetch(`${provider.baseUrl}/api/tags`, {}, 4000);
        } catch (error) {
          throw new Error("Ollama 未啟動，或瀏覽器無法連到 http://localhost:11434。");
        }
        if (!response.ok) throw new Error(`Ollama 模型清單讀取失敗：HTTP ${response.status}`);
        const data = await response.json();
        return (data.models || []).map((model) => ({
          id: model.name,
          name: model.name,
          size: model.size || 0,
          modifiedAt: model.modified_at || ""
        }));
      },
      async *generate(request = {}) {
        const model = request.model || config.model;
        if (!model) throw new Error("尚未選擇 Ollama 模型。");
        activeController = new AbortController();
        let response;
        try {
          response = await fetch(`${provider.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: activeController.signal,
            body: JSON.stringify({
              model,
              stream: true,
              options: {
                temperature: request.temperature ?? 0.78,
                num_ctx: request.numCtx || 8192
              },
              messages: [
                { role: "system", content: request.system || "你是長篇小說正文生成引擎。只輸出小說正文。" },
                { role: "user", content: request.prompt || "" }
              ]
            })
          });
        } catch (error) {
          if (error.name === "AbortError") throw new Error("已中止生成。");
          throw new Error("尚未連接本機模型：Ollama 未啟動、模型未載入，或 localhost 連線被瀏覽器阻擋。");
        }
        if (!response.ok) throw new Error(`Ollama 回應失敗：HTTP ${response.status}`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error("瀏覽器不支援串流讀取。");
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const text = line.trim();
            if (!text) continue;
            let data;
            try {
              data = JSON.parse(text);
            } catch (error) {
              throw new Error("Ollama 回傳串流 JSON 格式錯誤。");
            }
            const token = data.message?.content || data.response || "";
            if (token) yield token;
            if (data.done) return;
          }
        }
      },
      async generateJson(request = {}) {
        let text = "";
        for await (const token of provider.generate(request)) text += token;
        const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
        try {
          return JSON.parse(cleaned);
        } catch (error) {
          throw new Error("本機模型沒有回傳有效 JSON。");
        }
      },
      abort() {
        if (activeController) activeController.abort();
      }
    };
    return provider;
  }

  async function generate(prompt, options = {}) {
    const config = { ...getConfig(), ...(options.config || {}) };
    validateConfig(config);

    if (config.provider === "gemini") {
      // Calls this site's own server route (app/api/generate); the Gemini key
      // stays on the server and never touches the browser or saved state.
      let response;
      try {
        response = await timeoutFetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt })
        }, options.timeoutMs || 60000);
      } catch (error) {
        throw new Error("Gemini 連線逾時或網路中斷。");
      }
      let data = {};
      try { data = await response.json(); } catch (e) {}
      if (!response.ok) throw new Error(data.error || `Gemini 回應失敗：HTTP ${response.status}`);
      return data.text || "";
    }

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

  async function listLocalModels(options = {}) {
    const config = { ...getConfig(), ...options };
    if (config.provider && config.provider !== "ollama") config.provider = "ollama";
    return createOllamaProvider(config).listModels();
  }

  async function testLocalModel(options = {}) {
    const config = { ...getConfig(), ...options, provider: "ollama" };
    const provider = createOllamaProvider(config);
    const models = await provider.listModels();
    if (!models.length) throw new Error("Ollama 已啟動，但尚未安裝任何模型。");
    return {
      ok: true,
      models,
      selectedModel: config.model || models[0].id
    };
  }

  function generateStream(request = {}, options = {}) {
    const config = { ...getConfig(), ...(options.config || {}) };
    if ((config.provider || request.provider) === "ollama") {
      currentOllamaProvider = createOllamaProvider(config);
      return currentOllamaProvider.generate(request);
    }
    throw new Error("目前第一階段串流正文生成只支援 Ollama 本機模型。");
  }

  function abortOllama() {
    if (currentOllamaProvider) currentOllamaProvider.abort();
  }

  window.NovelAIService = {
    getConfig,
    validateConfig,
    generate,
    generateStream,
    listLocalModels,
    testLocalModel,
    createOllamaProvider,
    abortOllama,
    checkLocalModel,
    saveSessionToken,
    clearToken,
    maskKey
  };
})();
