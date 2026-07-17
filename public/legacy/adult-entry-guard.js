(function(){
  function request(){if(!confirm("成人故事僅限已滿 18 歲的使用者。是否確認你已成年並主動開啟？"))return false;if(!confirm("請確認作品主要角色均為成年人。成人作品會與一般作品分開標記保存。"))return false;NovelConsumer.state.adultEnabled=true;NovelConsumer.state.wizard.genre="成人故事";NovelConsumer.save();return true}
  function disable(){NovelConsumer.state.adultEnabled=false;if(NovelConsumer.state.wizard.genre==="成人故事")NovelConsumer.state.wizard.genre="";NovelConsumer.save()}
  window.AdultEntryGuard={request,disable,status:()=>NovelConsumer.state.adultEnabled};
})();
