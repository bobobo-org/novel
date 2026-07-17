(function(){
  function ensureReturnButton(){let button=document.getElementById("p11ReturnConsumer");if(button)return button;button=document.createElement("button");button.id="p11ReturnConsumer";button.type="button";button.textContent="返回創作中心";button.addEventListener("click",()=>window.ConsumerApp?.setMode("consumer"));document.body.appendChild(button);return button}
  function show(view){document.body.classList.add("p11-professional");document.body.classList.remove("p11-consumer");document.getElementById("consumerAppShell")?.setAttribute("hidden","");document.querySelector(".app")?.removeAttribute("hidden");ensureReturnButton().hidden=false;if(view&&typeof window.showView==="function")window.showView(view);window.scrollTo({top:0,behavior:"smooth"})}
  function hide(){document.body.classList.remove("p11-professional");document.body.classList.add("p11-consumer");document.querySelector(".app")?.setAttribute("hidden","");document.getElementById("consumerAppShell")?.removeAttribute("hidden");const button=document.getElementById("p11ReturnConsumer");if(button)button.hidden=true}
  window.ProfessionalTools={show,hide};
})();
