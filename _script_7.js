
(function(){
  'use strict';
  const media = window.matchMedia('(max-width:600px)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const controllers = new Set();
  let domainController = null;
  let active = false;

  function nearestIndex(track, cards){
    if(!cards.length) return 0;
    const trackRect = track.getBoundingClientRect();
    let best = 0, distance = Infinity;
    cards.forEach((card, i) => {
      const cardRect = card.getBoundingClientRect();
      const targetLeft = cardRect.left - trackRect.left + track.scrollLeft;
      const d = Math.abs(targetLeft - track.scrollLeft);
      if(d < distance){ distance = d; best = i; }
    });
    return best;
  }

  function targetFor(track, card){
    const trackRect = track.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return Math.max(0, track.scrollLeft + (cardRect.left - trackRect.left) - 2);
  }

  function setupCarousel(track, selector, delay, transition='slide'){
    if(!track) return null;
    const cards = [...track.querySelectorAll(selector)];
    if(cards.length < 2) return null;

    let index = 0;
    let timer = null;
    let resumeTimer = null;
    let paused = false;
    let visible = true;
    let destroyed = false;
    let scrollingByCode = false;

    const setActive = () => {
      cards.forEach((card, i) => {
        card.classList.toggle('active', i === index);
        card.classList.toggle('card-transitioning', i === index);
        card.dataset.transition = transition;
      });
    };
    const go = next => {
      if(destroyed || paused || !visible) return;
      index = (next + cards.length) % cards.length;
      const left = targetFor(track, cards[index]);
      scrollingByCode = true;
      track.scrollTo({left, behavior:'smooth'});
      setActive();
      window.setTimeout(() => { scrollingByCode = false; }, 800);
    };
    const stop = () => { if(timer) clearInterval(timer); timer = null; };
    const start = () => {
      stop();
      if(destroyed || !active || reduce.matches || cards.length < 2) return;
      timer = setInterval(() => { if(!paused && visible) go(index + 1); }, delay);
    };
    const pause = () => {
      paused = true;
      stop();
      if(resumeTimer) clearTimeout(resumeTimer);
    };
    const resume = () => {
      paused = false;
      if(resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(start, 1200);
    };
    const onScroll = () => {
      if(scrollingByCode) return;
      const next = nearestIndex(track, cards);
      if(next !== index){ index = next; setActive(); }
    };
    const onVisibility = entries => {
      visible = !!entries[0]?.isIntersecting;
      if(!visible) stop(); else if(!paused) start();
    };

    track.addEventListener('pointerdown', pause, {passive:true});
    track.addEventListener('pointerup', resume, {passive:true});
    track.addEventListener('pointercancel', resume, {passive:true});
    track.addEventListener('touchend', resume, {passive:true});
    track.addEventListener('scroll', onScroll, {passive:true});
    let observer = null;
    if('IntersectionObserver' in window){
      observer = new IntersectionObserver(onVisibility, {threshold:0.12});
      observer.observe(track);
    }

    track.scrollLeft = 0;
    setActive();
    const api = {
      reset(){ index=0; track.scrollTo({left:0,behavior:'auto'}); setActive(); if(!paused) start(); },
      destroy(){
        destroyed=true; stop(); if(resumeTimer) clearTimeout(resumeTimer); observer?.disconnect();
        track.removeEventListener('pointerdown', pause); track.removeEventListener('pointerup', resume);
        track.removeEventListener('pointercancel', resume); track.removeEventListener('touchend', resume);
        track.removeEventListener('scroll', onScroll);
      }
    };
    controllers.add(api);
    if(!observer) start();
    return api;
  }

  function setupAll(){
    if(active || !media.matches || reduce.matches) return;
    active = true;
    setupCarousel(document.getElementById('studentJourneyScroller'), '.journey-step-card', 3000, 'lift');
    setupCarousel(document.getElementById('personaTrack'), '.persona-card', 3300, 'zoom');
    setupCarousel(document.querySelector('.receive-grid'), ':scope > article', 3000, 'fade');
    setupCarousel(document.querySelector('.project-grid'), ':scope > article', 3300, 'slide');
    setupCarousel(document.querySelector('.proof-grid'), ':scope > article', 3100, 'blur');
    setupCarousel(document.querySelector('.how-grid'), ':scope > article', 3200, 'lift');
    setupCarousel(document.querySelector('.domain-category-preview'), ':scope > .domain-category', 3400, 'zoom');
    document.querySelectorAll('.domain-card-grid').forEach((grid, i) => setupCarousel(grid, ':scope > .domain-card', 2800 + (i % 3) * 250, ['slide','fade','lift'][i % 3]));
    setupDomainModal();
  }

  function teardownAll(){
    controllers.forEach(c => c.destroy());
    controllers.clear();
    domainController?.destroy?.();
    domainController = null;
    active = false;
  }

  function setupDomainModal(){
    const modal = document.getElementById('domainModal');
    const list = document.getElementById('domainModalList');
    if(!modal || !list) return;

    let timer=null, resumeTimer=null, paused=false, visible=true, index=0, destroyed=false;
    const cards = () => [...list.querySelectorAll('.domain-explorer-card:not([hidden])')];
    const stop=()=>{if(timer)clearInterval(timer);timer=null};
    const setActive=()=>cards().forEach((c,i)=>c.classList.toggle('active',i===index));
    const sync=()=>{
      const visibleCards=cards();
      if(!visibleCards.length){index=0;return;}
      if(index>=visibleCards.length) index=0;
      let best=0,dist=Infinity;
      const rect=list.getBoundingClientRect();
      visibleCards.forEach((c,i)=>{const d=Math.abs((c.getBoundingClientRect().left-rect.left)+list.scrollLeft-list.scrollLeft);if(d<dist){dist=d;best=i;}});
      index=best; setActive();
    };
    const go=()=>{
      const visibleCards=cards();
      if(destroyed || paused || !visible || !modal.classList.contains('open') || visibleCards.length<2) return;
      index=(index+1)%visibleCards.length;
      const card=visibleCards[index];
      const rect=list.getBoundingClientRect();
      const left=Math.max(0,list.scrollLeft+(card.getBoundingClientRect().left-rect.left)-2);
      list.scrollTo({left,behavior:'smooth'});
      setActive();
    };
    const start=()=>{
      stop();
      if(destroyed || !active || reduce.matches || !modal.classList.contains('open')) return;
      timer=setInterval(go,3000);
    };
    const pause=()=>{paused=true;stop();if(resumeTimer)clearTimeout(resumeTimer)};
    const resume=()=>{paused=false;if(resumeTimer)clearTimeout(resumeTimer);resumeTimer=setTimeout(start,1200)};
    list.addEventListener('pointerdown',pause,{passive:true});
    list.addEventListener('pointerup',resume,{passive:true});
    list.addEventListener('pointercancel',resume,{passive:true});
    list.addEventListener('touchend',resume,{passive:true});
    list.addEventListener('scroll',sync,{passive:true});

    const modalObserver = new MutationObserver(()=>{
      if(modal.classList.contains('open')){ index=0; list.scrollTo({left:0,behavior:'auto'}); setActive(); start(); }
      else stop();
    });
    modalObserver.observe(modal,{attributes:true,attributeFilter:['class']});


    domainController={destroy(){
      destroyed=true; stop(); if(resumeTimer)clearTimeout(resumeTimer); modalObserver.disconnect();
      list.removeEventListener('pointerdown',pause); list.removeEventListener('pointerup',resume);
      list.removeEventListener('pointercancel',resume); list.removeEventListener('touchend',resume); list.removeEventListener('scroll',sync);
    }};
  }

  function refresh(){ if(media.matches && !reduce.matches) setupAll(); else if(active) teardownAll(); }
  media.addEventListener?.('change', refresh);
  reduce.addEventListener?.('change', refresh);
  refresh();
})();
