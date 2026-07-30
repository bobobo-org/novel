(function () {
  "use strict";

  function currentProjectId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("projectId")
      || document.body?.dataset?.frontdoorProjectId
      || localStorage.getItem("novel_p2_active_project_id")
      || localStorage.getItem("novel_last_project_id")
      || localStorage.getItem("novel_current_project_id")
      || "";
  }

  function closedAiRoute() {
    const projectId = currentProjectId();
    return projectId
      ? `/studio/project/${encodeURIComponent(projectId)}/closed-ai`
      : "/studio/create?from=professional&target=closed-ai";
  }

  function learningRoute() {
    const projectId = currentProjectId();
    return projectId
      ? `/studio/project/${encodeURIComponent(projectId)}/learning`
      : "/studio/create?from=professional&target=learning";
  }

  function installClosedAiMenuEntry() {
    const menu = document.querySelector('[data-testid="professional-menu"]');
    if (!menu || document.getElementById("closedAiNavButton")) return;
    const button = document.createElement("button");
    button.id = "closedAiNavButton";
    button.type = "button";
    button.textContent = "閉端 AI 中心";
    button.addEventListener("click", () => {
      window.location.href = closedAiRoute();
    });
    const anchor = document.getElementById("phase1NewWorkNavButton");
    if (anchor?.parentNode === menu) anchor.insertAdjacentElement("afterend", button);
    else menu.prepend(button);
  }

  function installMenuEntry() {
    const menu = document.querySelector('[data-testid="professional-menu"]');
    if (!menu || document.getElementById("sovereignLearningNavButton")) return;
    const button = document.createElement("button");
    button.id = "sovereignLearningNavButton";
    button.type = "button";
    button.textContent = "閉端 AI 學習";
    button.addEventListener("click", () => {
      window.location.href = learningRoute();
    });
    const anchor = document.getElementById("closedAiNavButton")
      || document.getElementById("phase1NewWorkNavButton");
    if (anchor?.parentNode === menu) anchor.insertAdjacentElement("afterend", button);
    else menu.prepend(button);
  }

  function installClosedAiRouteCard() {
    const grid = document.querySelector(".p24b-route-grid");
    if (!grid || document.getElementById("closedAiRouteCard")) return;
    const link = document.createElement("a");
    link.id = "closedAiRouteCard";
    link.className = "p24b-route-card";
    link.href = closedAiRoute();
    link.innerHTML = "<b>閉端 AI 中心</b><span>三個閉端 AI、共用 Agent OS、六層快取與可驗證執行。</span>";
    grid.appendChild(link);
  }

  function installRouteCard() {
    const grid = document.querySelector(".p24b-route-grid");
    if (!grid || document.getElementById("sovereignLearningRouteCard")) return;
    const link = document.createElement("a");
    link.id = "sovereignLearningRouteCard";
    link.className = "p24b-route-card";
    link.href = learningRoute();
    link.innerHTML = "<b>閉端 AI 學習</b><span>匯入文章或 AI 輸出，抽象為可核准、可撤銷的創作規則</span>";
    grid.appendChild(link);
  }

  function install() {
    installClosedAiMenuEntry();
    installMenuEntry();
    installClosedAiRouteCard();
    installRouteCard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
