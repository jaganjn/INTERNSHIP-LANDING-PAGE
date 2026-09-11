
(function(){
  'use strict';
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Live application counter for Firebase Spark: only the privacy-safe
  // aggregate is public; individual applications remain auth-protected.
  const counter=document.getElementById('liveApplicationCount');
  function bindLiveCounter(){
    if(!counter || typeof db === 'undefined' || !db?.ref) return false;
    try{
      db.ref('publicStats/applicationCount').on('value',snap=>{
        const raw=snap.val();
        const count=Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
        counter.textContent=count.toLocaleString('en-IN');
        counter.classList.remove('live-count-pop');
        void counter.offsetWidth;
        if(!reduce) counter.classList.add('live-count-pop');
      },()=>{counter.textContent='—';});
      return true;
    }catch(e){ counter.textContent='—'; return false; }
  }
  if(!bindLiveCounter()) window.setTimeout(bindLiveCounter,300);

  // Four-stage visual progress mirrors the existing three form panels without changing submission logic.
  const form=document.getElementById('internshipForm');
  const progress=document.getElementById('applicationProgressFour');
  const stages=progress?[...progress.querySelectorAll('.progress-four-step')]:[];
  const lines=progress?[...progress.querySelectorAll(':scope > i')]:[];
  function updateFourProgress(){
    if(!form||!stages.length)return;
    const name=form.elements.namedItem('name')?.value.trim();
    const phone=form.elements.namedItem('phone')?.value.trim();
    const academic=form.elements.namedItem('email')?.value.trim() && form.elements.namedItem('college')?.value.trim() && form.elements.namedItem('department')?.value.trim() && form.elements.namedItem('year')?.value;
    const domain=form.elements.namedItem('domain')?.value;
    const current=document.getElementById('apply')?.dataset.activeStep||'1';
    const states=[!!(name&&phone),!!academic,!!domain,!!(state&&communicationLanguage&&startAvailability&&applicationReason),current==='4'];
    const active=current==='1'?0:current==='2'?(domain?2:1):3;
    stages.forEach((el,i)=>{el.classList.toggle('active',i===active);el.classList.toggle('completed',states[i]&&i<active);});
    lines.forEach((line,i)=>line.classList.toggle('done',states[i]));
  }
  if(form){['input','change'].forEach(type=>form.addEventListener(type,updateFourProgress));window.setInterval(updateFourProgress,500);updateFourProgress();}

  // Interactive domain details: first tap selects a domain and reveals learning/project/career context; CTA opens the form.
  const list=document.getElementById('domainModalList');
  const detail=document.getElementById('domainSelectionDetail');
  const title=document.getElementById('selectedDomainTitle');
  const desc=document.getElementById('selectedDomainDescription');
  const learn=document.getElementById('selectedDomainLearn');
  const projects=document.getElementById('selectedDomainProjects');
  const career=document.getElementById('selectedDomainCareer');
  const apply=document.getElementById('applySelectedDomain');
  let selectedDomain='';
  const categoryInfo={
    '0':{learn:'Programming, tools, workflows and portfolio building',projects:'Web apps, AI/data work, design or software projects',career:'Developer, AI, data, cloud, security or design roles'},
    '1':{learn:'Electronics, devices, embedded systems and automation',projects:'IoT prototypes, embedded builds, robotics or circuit work',career:'Embedded, IoT, VLSI, robotics or electronics roles'},
    '2':{learn:'Engineering fundamentals, design and practical workflows',projects:'CAD, mobility, construction, drone or mechanical projects',career:'Core engineering, design, mobility or construction roles'},
    '3':{learn:'Biological concepts, computational methods and research workflows',projects:'Bio-data, genetics or nanoscale research-oriented projects',career:'Biotech, bioinformatics or life-science roles'},
    '4':{learn:'Business concepts, analysis, operations and decision-making',projects:'Dashboards, campaigns, financial or operations analysis',career:'Marketing, finance, HR, analytics or operations roles'},
    '5':{learn:'Healthcare information and human behaviour fundamentals',projects:'Coding, documentation, data or applied health-information tasks',career:'Medical coding, health information or psychology-related pathways'}
  };
  function selectDomain(card){
    if(!card||!detail)return;
    selectedDomain=card.dataset.domainName||'';
    const info=categoryInfo[card.dataset.category]||categoryInfo['0'];
    title.textContent=selectedDomain;
    desc.textContent=card.querySelector('small')?.textContent||'Explore this programme and see where it can take you.';
    learn.textContent=info.learn;projects.textContent=info.projects;career.textContent=info.career;
    detail.hidden=false;
    list?.querySelectorAll('.domain-explorer-card').forEach(c=>c.classList.toggle('selected',c===card));
  }
  list?.addEventListener('click',e=>{
    const card=e.target.closest('.domain-explorer-card');
    if(!card)return;
    e.preventDefault();
    selectDomain(card);
  });
  apply?.addEventListener('click',()=>{
    if(!selectedDomain)return;
    window.__internsforgeCountApplicationVisitor?.();
    document.querySelector('[data-close-domain]')?.click();
    const app=document.getElementById('apply');
    document.body.classList.add('application-modal-open');
    const field=document.getElementById('domain');
    if(field){field.value=selectedDomain;field.dispatchEvent(new Event('change',{bubbles:true}));}
    setTimeout(()=>document.getElementById('name')?.focus(),120);
  });
})();
