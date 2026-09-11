
'use strict';
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = document.querySelector('.site-header');
  const progress = document.getElementById('scrollProgress');
  const floatingCta = document.getElementById('floatingCta');
  const apply = document.getElementById('apply');
  let applyVisible = false;
  let frame = 0;

  const updateScroll = () => {
    frame = 0;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const ratio = Math.min(1, Math.max(0, scrollY / max));
    if (progress) progress.style.transform = `scaleX(${ratio})`;
    header?.classList.toggle('scrolled', scrollY > 16);
    floatingCta?.classList.toggle('show', scrollY > 480 && !applyVisible);
  };
  const requestUpdate = () => {
    if (!frame) frame = requestAnimationFrame(updateScroll);
  };
  addEventListener('scroll', requestUpdate, { passive: true });
  addEventListener('resize', requestUpdate, { passive: true });

  if (apply && 'IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      applyVisible = Boolean(entries[0]?.isIntersecting);
      requestUpdate();
    }, { threshold: .1 }).observe(apply);
  }

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', event => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      const menu = anchor.closest('details');
      if (menu) menu.open = false;
    });
  });

  document.getElementById('backToTop')?.addEventListener('click', () => scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' }));

  const revealSelectors = [
    '.hero-copy>*', '.hero-art', '.trust-strip article', '.ecosystem', '.application-intro>*', '.application-card',
    '.section-heading', '.receive-grid article', '.project-grid article', '.fit-grid article', '.domain-tabs',
    '.domain-detail-wrap', '.how-grid article', '.proof-grid article', '.faq-list details', '.final-cta>*'
  ];
  const revealElements = revealSelectors.flatMap(selector => [...document.querySelectorAll(selector)]);
  revealElements.forEach((element, index) => element.classList.add('motion-reveal', `motion-delay-${(index % 4) + 1}`));
  if (reducedMotion || !('IntersectionObserver' in window)) revealElements.forEach(element => element.classList.add('motion-visible'));
  else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('motion-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .08, rootMargin: '80px 0px -25px' });
    revealElements.forEach(element => observer.observe(element));
  }

  const tabs = [...document.querySelectorAll('.domain-tab')];
  const panels = [...document.querySelectorAll('.domain-detail')];
  function activateDomain(name, focus = false) {
    tabs.forEach(tab => {
      const active = tab.dataset.domain === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => {
      const active = panel.dataset.domainPanel === name;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    const tab = tabs.find(item => item.dataset.domain === name);
    tab?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    if (focus) tab?.focus({ preventScroll: true });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateDomain(tab.dataset.domain));
    tab.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      activateDomain(tabs[next].dataset.domain, true);
    });
  });
  updateScroll();
})();


/* Conversion-focused modal interactions. Student frontend only. */
(function setupConversionUX(){
  const body=document.body;
  const applicationZone=document.querySelector('.application-zone');
  const applicationCard=document.getElementById('apply');
  const openButtons=[...document.querySelectorAll('.open-application,#floatingCta')];
  const closeBtn=document.getElementById('closeApplication');
  const closeTop=document.getElementById('closeApplicationTop');
  let restoreScroll=0;
  /*
   * Total Application Visitors
   * Count one unique browser for this application portal.
   * localStorage is used so refreshes and new tabs do not inflate the total.
   * The Firebase transaction is retried if the network is temporarily unavailable.
   */
  const APPLICATION_VISITOR_KEY='internsforge_application_visitor_id_v2';
  const APPLICATION_VISITOR_COUNTED_KEY='internsforge_application_visitor_counted_v2';
  let applicationVisitorId = localStorage.getItem(APPLICATION_VISITOR_KEY);
  if (!applicationVisitorId) {
    applicationVisitorId = `appvisitor_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
    try { localStorage.setItem(APPLICATION_VISITOR_KEY, applicationVisitorId); } catch (_) {}
  }
  let applicationVisitorCounted = localStorage.getItem(APPLICATION_VISITOR_COUNTED_KEY) === '1';

  // Expose the counter so every application CTA/path (including domain selection)
  // records the same visitor event before opening the application modal.
  async function countApplicationVisitor(){
    if (applicationVisitorCounted || typeof db === 'undefined') return;

    const ref = db.ref('publicStats/applicationVisitorCount');

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await ref.transaction(current => {
          const n = Number(current);
          return Number.isFinite(n) && n >= 0 ? Math.floor(n) + 1 : 1;
        });

        if (result && result.committed) {
          applicationVisitorCounted = true;
          try { localStorage.setItem(APPLICATION_VISITOR_COUNTED_KEY,'1'); } catch (_) {}
          return;
        }
      } catch (error) {
        console.warn(`Application visitor counter attempt ${attempt + 1} failed:`, error);
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }
  window.__internsforgeCountApplicationVisitor = countApplicationVisitor;

  function openApplication(domain){
    countApplicationVisitor();
    applicationFormOpen = true;
    // Opening the form alone is not "filling"; filling begins on field interaction.
    formInteractionStarted = false;
    updateVisitor({ formProgress: 0, currentStep: 1, currentField: 'Application form opened', status: 'online', hasStartedFilling: false });
    restoreScroll=window.scrollY;
    body.classList.add('application-modal-open');
    if(domain){ const field=document.getElementById('domain'); if(field){field.value=domain; field.dispatchEvent(new Event('change',{bubbles:true}));} }
    applicationCard?.setAttribute('aria-label','Internship application');
    window.setTimeout(()=>document.getElementById('name')?.focus(),120);
  }
  function closeApplication(){
    if(!body.classList.contains('application-modal-open')) return;
    applicationFormOpen = false;
    formInteractionStarted = false;
    updateVisitor({ formProgress: 0, currentStep: 1, currentField: 'Viewing page', status: 'online', hasStartedFilling: false });
    body.classList.remove('application-modal-open');
    window.scrollTo({top:restoreScroll,behavior:'instant'});
  }
  openButtons.forEach(btn=>btn.addEventListener('click',()=>openApplication()));
  document.addEventListener('click', event => {
    const btn = event.target.closest('.open-application, #floatingCta');
    if (!btn) return;
    if (btn === openButtons.find(b => b === btn)) return;
    event.preventDefault();
    openApplication(btn.dataset.domain || '');
  });
  closeBtn?.addEventListener('click',closeApplication); closeTop?.addEventListener('click',closeApplication);
  applicationZone?.addEventListener('click',e=>{ if(e.target===applicationZone) closeApplication(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ if(document.getElementById('domainModal')?.classList.contains('open')) closeDomain(); else closeApplication(); }});

  const modal=document.getElementById('domainModal');
  const list=document.getElementById('domainModalList');
  const search=document.getElementById('domainSearch');
  const count=document.getElementById('domainCount');
  const empty=document.getElementById('domainEmpty');
  const domainButtons=[...document.querySelectorAll('[data-domain-name]')];
  const tabs=[...document.querySelectorAll('[data-domain-category]')];
  function openDomain(){modal?.classList.add('open');modal?.setAttribute('aria-hidden','false');body.classList.add('no-scroll');search?.focus();filterDomains();}
  function closeDomain(){modal?.classList.remove('open');modal?.setAttribute('aria-hidden','true');body.classList.remove('no-scroll');}
  function filterDomains(){
    const q=(search?.value||'').trim().toLowerCase(); const active=[...tabs].find(t=>t.classList.contains('active'))?.dataset.domainCategory;
    let visible=0;
    list?.querySelectorAll('.domain-explorer-card').forEach(card=>{const match=(!q || card.dataset.domainName.toLowerCase().includes(q) || card.innerText.toLowerCase().includes(q)) && (active===undefined || card.dataset.category===active); card.hidden=!match;if(match)visible++;});
    if(count)count.textContent=`${visible} program${visible===1?'':'s'}`; if(empty)empty.hidden=visible!==0;
  }
  document.getElementById('openDomainExplorer')?.addEventListener('click',openDomain);
  // Preview cards open the explorer and preselect the matching domain.
  document.querySelectorAll('.domain-card').forEach(b=>b.addEventListener('click',()=>{
    openDomain();
    const target=b.dataset.domainName;
    if(search) search.value='';
    tabs.forEach(t=>t.classList.remove('active'));
    filterDomains();
    const match=[...list.querySelectorAll('.domain-explorer-card')].find(c=>c.dataset.domainName===target);
    if(match) match.click();
  }));
  document.querySelectorAll('[data-close-domain]').forEach(b=>b.addEventListener('click',closeDomain));
  search?.addEventListener('input',filterDomains);
  tabs.forEach(tab=>tab.addEventListener('click',()=>{tabs.forEach(t=>t.classList.remove('active'));tab.classList.add('active');filterDomains();}));
  list?.addEventListener('click',e=>{const card=e.target.closest('.domain-explorer-card'); if(!card)return; const domain=card.dataset.domainName; closeDomain(); openApplication(domain);});
  tabs[0]?.classList.add('active');
})();

