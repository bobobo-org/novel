(function(){
  const themes={"玄幻修仙":["#0a1020","#5b3fa2","#d6a34c"],"都市異能":["#081421","#12698b","#5fe1ff"],"戀愛養成":["#1b1020","#9b436f","#ffb1d0"],"宮廷權謀":["#130d16","#6a2431","#d7a954"],"商戰經營":["#07161a","#1e655d","#8fd5b4"],"RPG 冒險":["#0c1711","#446b36","#d9bd63"],"成人故事":["#171015","#71374f","#d8a1b7"]};
  function apply(name){const [base,accent,gold]=themes[name]||themes["玄幻修仙"];document.documentElement.style.setProperty("--p11-base",base);document.documentElement.style.setProperty("--p11-accent",accent);document.documentElement.style.setProperty("--p11-gold",gold);document.body.dataset.storyTheme=name;NovelConsumer.state.theme=name;NovelConsumer.save()}
  window.ConsumerTheme={themes,apply};
})();
