from pathlib import Path
import zipfile, shutil, re

root=Path('/mnt/data/site_fullfix')
index=root/'index.html'
s=index.read_text(encoding='utf-8')

# Repair malformed duplicate style closing if present.
s=s.replace('</style>\n</style>\n\n</head>', '</style>\n\n</head>')
# Replace missing Adobe asset references with a local SVG asset created below.
s=s.replace('src="adobe.png"', 'src="adobe.svg"')

# Make the main hero secondary CTA point to the application anchor while preserving domain explorer elsewhere.
s=s.replace('<a class="secondary-btn" href="#projects">Explore Internship Domains</a>', '<button class="secondary-btn open-application" type="button">Explore Internship Domains <span>→</span></button>')

# Add a deliberate, professional accent line beneath the headline instead of relying on gradient text clipping.
# No markup change needed: CSS will make span a safe solid accent.

polish=r'''
<style id="internsforge-visual-polish-v5">
/* =========================================================
   InternsForge visual polish V5
   Frontend only. Firebase / Apps Script / backend untouched.
   Goal: strong contrast, readable hierarchy, restrained color.
   ========================================================= */
:root{
  --if-ink:#10233f;
  --if-ink-strong:#0b1c34;
  --if-muted:#5f7391;
  --if-muted-2:#7b8ca5;
  --if-line:#d9e2ef;
  --if-surface:#ffffff;
  --if-surface-2:#f4f7fc;
  --if-blue:#2f5eea;
  --if-violet:#6948e8;
  --if-green:#16a66f;
  --if-navy:#081a33;
  --if-navy-2:#0d2445;
  --if-white:#ffffff;
}

html,body{color:var(--if-ink);background:#f4f7fb}
body{overflow-x:hidden;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}

/* HEADER */
.site-header{background:rgba(255,255,255,.96)!important;border-color:#dfe7f2!important;box-shadow:0 10px 28px rgba(16,35,63,.08)!important;backdrop-filter:blur(14px)}
.brand strong{color:var(--if-ink-strong)!important}
.brand small{color:#71829a!important}
.desktop-nav a{color:#425675!important}
.desktop-nav a:hover,.desktop-nav a:focus-visible{color:var(--if-blue)!important}
.header-cta{background:linear-gradient(100deg,var(--if-blue),var(--if-violet))!important;color:#fff!important}

/* HERO: solid readable accent instead of fragile text-clipping gradient */
.hero{position:relative;isolation:isolate}
.hero-copy{position:relative;z-index:3}
.hero h1{color:var(--if-ink-strong)!important;text-wrap:balance}
.hero h1 span{display:inline!important;color:var(--if-blue)!important;background:none!important;-webkit-background-clip:initial!important;background-clip:initial!important;-webkit-text-fill-color:currentColor!important;font-weight:900}
.hero-lead{color:#5a6f8d!important;max-width:650px}
.hero-proof{color:#4f6482!important}
.hero-proof span::first-letter{color:var(--if-green)}
.fact-row{border-top-color:#dce4ef!important}
.fact-row b{color:var(--if-ink-strong)!important}
.fact-row small{color:#6e809a!important}
.secondary-btn{border:1px solid #ccd8e8!important;background:#fff!important;color:var(--if-ink)!important;cursor:pointer}
.secondary-btn:hover,.secondary-btn:focus-visible{border-color:#8ea5d1!important;color:var(--if-blue)!important;background:#f8faff!important}
.primary-btn,.header-cta{will-change:transform}

/* HERO ART: strengthen legibility while preserving futuristic style */
.hero-art{border:1px solid rgba(127,162,230,.26)!important;background:radial-gradient(circle at 50% 46%,rgba(79,103,245,.32),transparent 35%),linear-gradient(145deg,#06152d,#0b1c37 62%,#151034)!important}
.visual-top{color:#b7c9e4!important}
.visual-top i{color:#6fe4aa!important}
.orbit-card{background:rgba(10,27,56,.90)!important;border-color:rgba(132,163,228,.30)!important}
.orbit-card b{color:#fff!important}
.orbit-card small{color:#b6c6de!important}
.career-core strong,.career-core b{color:#fff!important}
.career-core small{color:#9ec1ff!important}

/* TRUST / ECOSYSTEM */
.trust-strip article{background:#fff!important;border-color:#dce5f0!important}
.trust-strip span{color:#5c7190!important}
.trust-strip strong{color:var(--if-ink-strong)!important}
.trust-strip small{color:#73859e!important}
.ecosystem{background:#fff!important;border-color:#dbe4ef!important}
.ecosystem-title span{color:#1d3558!important}
.ecosystem-title small{color:#7487a1!important}
.marquee-group figure{background:#f7f9fd!important;border:1px solid #e4eaf2}
.marquee-group img{filter:none!important;opacity:1!important}
.brand-disclaimer{color:#6d809b!important;border-top-color:#e5ebf3!important}

/* APPLICATION WORKSPACE */
.application-zone{background:#f4f7fc!important}
.application-intro>span,.section-heading>span{color:#4666d8!important}
.application-intro h2{color:var(--if-ink-strong)!important}
.application-intro p{color:#62758f!important}
.application-points>div{background:#fff!important;border:1px solid #dfe7f1!important}
.application-points span strong{color:#203653!important}
.application-points span small{color:#6f819b!important}
.application-card.wizard-shell{color:var(--if-ink)!important;border-color:#d6e0ec!important}
.wizard-copy h2{color:#fff!important}
.wizard-copy p{color:#bed0ea!important}
.wizard-time-pill{color:#526998!important}
.step-panel{background:#fff!important;border-color:#dbe4ef!important}
.step-panel-head h3{color:var(--if-ink-strong)!important}
.step-panel-head p{color:#6b7e98!important}
.field-wrap label{color:#3b5272!important}
.field-control input,.field-control select{color:#10233f!important;border-color:#cdd9e8!important;background:#fbfdff!important}
.field-control input::placeholder,.field-control select::placeholder{color:#8897aa!important;opacity:1}
.field-help{color:#71839c!important}
.consent-row{color:#61748f!important}
.secure{color:#6e8098!important}

/* JOURNEY: explicit text colors solve white-on-white cards */
.student-journey-section{background:linear-gradient(180deg,#081a33,#0a2040)!important;color:#fff!important}
.student-journey-shell{background:transparent!important}
.student-journey-head h2{color:#fff!important}
.student-journey-head p{color:#afc0da!important}
.journey-step-card{background:#fff!important;border-color:#d7e2ef!important;color:var(--if-ink)!important;box-shadow:0 10px 26px rgba(0,0,0,.10)}
.journey-step-card.active{background:linear-gradient(155deg,#eef2ff,#e6ddff)!important;border-color:#9dadf7!important;box-shadow:0 16px 34px rgba(71,85,214,.20)!important}
.journey-step-card h3{color:#163154!important}
.journey-step-card p{color:#607491!important}
.journey-step-number{background:#eef2ff!important;color:#4363da!important}
.journey-step-card.active .journey-step-number{background:#fff!important;color:#4b5fe1!important}
.journey-arrow{color:#91a7dc!important}

/* GENERIC LIGHT SECTIONS */
.section:not(.project-section):not(.domain-section):not(.proof-section){background:#fff}
.section:not(.project-section):not(.domain-section):not(.proof-section) .section-heading h2{color:var(--if-ink-strong)!important}
.section:not(.project-section):not(.domain-section):not(.proof-section) .section-heading p{color:#667a95!important}

/* PROJECTS: light cards + explicit dark typography */
.project-section{background:#f5f8fc!important;color:var(--if-ink)!important}
.project-section .section-heading.inverted h2{color:var(--if-ink-strong)!important}
.project-section .section-heading.inverted p{color:#667a95!important}
.project-grid article{background:#fff!important;border-color:#d9e3ef!important;box-shadow:0 12px 30px rgba(24,45,78,.07)!important}
.project-grid article>span{color:#5270d9!important}
.project-grid h3{color:#163153!important}
.project-grid p,.project-grid li{color:#627691!important}
.project-grid small{color:#7488a3!important}
.project-icon{box-shadow:none!important}

/* COUNSELLING */
.fit-section{background:#f6f8fc!important}
.fit-grid article{background:#fff!important;border-color:#dbe4ef!important}
.fit-grid h3{color:#163153!important}
.fit-grid ul{color:#627691!important}
.inline-cta{color:#fff!important;background:linear-gradient(100deg,var(--if-blue),var(--if-violet))!important;border:0!important}
.fit-guidance{background:#fff!important}
.guidance-note{color:#6f819a!important}

/* PERSONAS */
.student-persona-section{background:#fff!important}
.student-persona-section .section-heading h2{color:var(--if-ink-strong)!important}
.student-persona-section .section-heading p{color:#667a95!important}
.persona-card{background:linear-gradient(145deg,#fff,#f5f8fd)!important;border-color:#d8e2ef!important}
.persona-card h3{color:#15304f!important}
.persona-card p{color:#647893!important}
.persona-cta{color:#4866d9!important}

/* DOMAINS */
.domain-section{background:#091b34!important;color:#fff!important}
.domain-section .section-heading.inverted h2{color:#fff!important}
.domain-section .section-heading.inverted p{color:#afbed7!important}
.domain-category{background:rgba(255,255,255,.98)!important;border-color:#d9e3ef!important}
.domain-category *{color:inherit}
.domain-card{background:#fbfdff!important;border-color:#dbe5ef!important}
.domain-card h3{color:#163153!important}
.domain-card p{color:#667a95!important}
.domain-explorer-trigger{background:linear-gradient(100deg,var(--if-blue),var(--if-violet))!important;color:#fff!important}

/* PROOF: dark section with readable cards */
.proof-section{background:linear-gradient(180deg,#081a33,#0a2040)!important;color:#fff!important}
.proof-section .section-heading.inverted h2{color:#fff!important}
.proof-section .section-heading.inverted p{color:#afbed7!important}
.proof-grid article{background:#fff!important;border-color:#d7e1ee!important;box-shadow:0 12px 30px rgba(0,0,0,.11)!important}
.proof-grid span{color:#4e72de!important}
.proof-grid h3{color:#163153!important}
.proof-grid p{color:#617691!important}

/* FAQ */
.faq-section{background:#f7f9fc!important}
.faq-list details{background:#fff!important;border-color:#dbe4ef!important}
.faq-list summary{color:#173252!important}
.faq-list details p{color:#657992!important}

/* CONVERSION NOTE: repair oversized/broken button alignment */
.conversion-note{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:24px!important;padding:24px 28px!important;border:1px solid #d8e2ee!important;background:linear-gradient(135deg,#fff 0%,#f6f9ff 100%)!important;min-height:150px!important}
.conversion-note-copy{flex:1 1 auto!important;display:flex!important;align-items:flex-start!important;gap:14px!important}
.conversion-note-text{flex:1 1 auto!important}
.conversion-note strong{color:#142b4a!important;font-size:18px!important}
.conversion-note span{color:#657994!important}
.conversion-note-meta small{color:#536b88!important;background:#fff!important;border-color:#dce5ef!important}
.conversion-note button{flex:0 0 auto!important;width:auto!important;min-width:190px!important;min-height:50px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:9px!important;color:#fff!important;background:linear-gradient(100deg,var(--if-blue),var(--if-violet))!important;box-shadow:0 12px 28px rgba(47,94,234,.18)!important;position:static!important}
.conversion-note button span{color:#fff!important}

/* FINAL CTA */
.final-cta{background:linear-gradient(120deg,#0b1b34,#12305d 56%,#30215a)!important}
.final-cta span{color:#8eb0ff!important}
.final-cta h2{color:#fff!important}
.final-cta p{color:#bfd0e8!important}
.final-cta button{color:#fff!important;background:linear-gradient(100deg,var(--if-blue),var(--if-violet))!important}

/* FOOTER */
footer{background:#f8fafd!important;border-top-color:#dde6f0!important}
.footer-brand strong{color:#143051!important}
footer>p,footer small,footer nav a{color:#657891!important}
footer nav a:hover,footer nav a:focus-visible{color:var(--if-blue)!important}

/* UNIVERSAL FOCUS / INTERACTION */
button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid rgba(47,94,234,.22)!important;outline-offset:3px!important}
button:disabled{opacity:.58;cursor:not-allowed}

/* Avoid text disappearing behind decorative pseudo-elements */
.hero h1,.hero-lead,.hero-actions,.hero-proof,.fact-row,.section-heading,.conversion-note,.final-cta,.student-journey-head,.persona-card,.proof-grid article{isolation:isolate}

/* Responsive refinements */
@media(max-width:900px){
  .hero{grid-template-columns:1fr!important}
  .hero h1{max-width:760px!important}
  .conversion-note{display:flex!important;flex-direction:column!important;align-items:stretch!important}
  .conversion-note button{width:100%!important}
}
@media(max-width:600px){
  .hero h1{font-size:42px!important;line-height:1.03!important;letter-spacing:-2.1px!important}
  .hero-actions .secondary-btn{min-height:52px!important}
  .conversion-note{margin:18px 12px 0!important;padding:20px!important;min-height:0!important}
  .conversion-note strong{font-size:16px!important}
  .conversion-note span{font-size:10.5px!important}
  .proof-grid article{min-height:150px!important}
  .journey-step-card h3{font-size:17px!important}
  .journey-step-card p{font-size:11px!important}
}
</style>
'''

s=s.replace('</head>', polish+'\n</head>',1)
index.write_text(s,encoding='utf-8')

# Local Adobe wordmark fallback; avoids broken image icon while keeping the asset local.
adobe_svg=root/'adobe.svg'
adobe_svg.write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 64" role="img" aria-labelledby="t d"><title id="t">Adobe</title><desc id="d">Adobe wordmark</desc><rect x="0" y="0" width="220" height="64" rx="10" fill="#ffffff"/><path d="M12 8h46l16 48H56L43 17 30 56H12z" fill="#e32929"/><text x="78" y="43" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700" fill="#1f2d45">Adobe</text></svg>''',encoding='utf-8')

# Update TEST report.
(root/'TEST-REPORT.txt').write_text('Frontend visual polish V5 applied: corrected contrast, fixed journey/proof/project card text visibility, repaired conversion CTA layout, replaced missing Adobe asset with local SVG, and preserved backend files.\n',encoding='utf-8')

# verify asset refs locally
refs=set(re.findall(r'(?:src|href)=["\']([^"\']+)["\']', s))
missing=[]
for r in sorted(refs):
    if r.startswith(('http://','https://','#','mailto:','tel:','javascript:','data:')): continue
    if r.startswith('/'): continue
    if not (root/r).exists() and not r.endswith('.html#'):
        # Ignore internal section IDs that may be in hrefs? those begin #, already skipped.
        missing.append(r)
print('missing refs', missing[:30], 'count', len(missing))
