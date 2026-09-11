
'use strict';

const SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbykckN1IqJxrzGTbJt7FSC7z0F9h_2z2JhihsBncDoYlmXhaFhSc6b8PX5FL8HbkBPY-g/exec';
const DRAFT_KEY = 'skillpathApplicationDraftV11';
const LAST_SUBMISSION_KEY = 'skillpathLastSubmissionV11';
const VISITOR_KEY = 'skillpathVisitorSessionV11';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const form = document.getElementById('internshipForm');
const applicationCard = document.getElementById('apply');
const message = document.getElementById('message');
const typingAura = document.getElementById('typingAura');
const draftBanner = document.getElementById('draftBanner');
const clearDraftButton = document.getElementById('clearDraft');
const startOverApplicationButton = document.getElementById('startOverApplication');
const formCelebration = document.getElementById('formCelebration');
const stepDots = [...document.querySelectorAll('.step-dot')];
const formSteps = form ? [...form.querySelectorAll('.form-step')] : [];
const trackedFields = form ? [...form.querySelectorAll('input[name], select[name], textarea[name]')].filter(field => field.name !== 'interest') : [];
const referralSource = (new URLSearchParams(location.search).get('ref') || '').trim().toUpperCase();
let currentStep = 1;
let submitLocked = false;
let lastMilestone = 0;
let draftTimer = 0;

const stepMeta = {
  1: { badge: '01', title: 'Let’s begin your application', subtitle: 'Enter your contact details first. Only after this step is completed, the academic step will be shown.', visual: 'CONTACT', hint: 'Start here', progressText: 'Step 1 of 4 · Contact details', time: 'About 60 seconds left' },
  2: { badge: '02', title: 'Now tell us about your profile', subtitle: 'Your academic details help us understand your background and the domain that suits you best.', visual: 'PROFILE', hint: 'Academic step unlocked', progressText: 'Step 2 of 4 · Academic profile', time: 'About 40 seconds left' },
  3: { badge: '03', title: 'A few final profile details', subtitle: 'These details help our programme team communicate with you in the right way and plan your start.', visual: 'PREFERENCES', hint: 'Almost there', progressText: 'Step 3 of 4 · Preferences', time: 'About 20 seconds left' },
  4: { badge: '04', title: 'Review and submit', subtitle: 'Only this final screen will submit your application. Review once and confirm with confidence.', visual: 'SUBMIT', hint: 'Final step', progressText: 'Step 4 of 4 · Review & submit', time: 'About 10 seconds left' }
};

const fieldRules = {
  name: value => value.trim().length >= 2 ? '' : 'Enter your full name.',
  phone: value => /^[6-9]\d{9}$/.test(value.trim()) ? '' : 'Enter a valid 10-digit Indian WhatsApp number.',
  email: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? '' : 'Enter a valid email address.',
  college: value => value.trim().length >= 3 ? '' : 'Enter your complete college name.',
  department: value => value.trim().length >= 2 ? '' : 'Enter your department or branch.',
  year: value => value ? '' : 'Select your current year.',
  domain: value => value ? '' : 'Select your interested domain.',
  state: value => value.trim().length >= 2 ? '' : 'Enter your state.',
  communicationLanguage: value => value ? '' : 'Select your preferred communication language.',
  startAvailability: value => value ? '' : 'Select when you can start.',
  applicationReason: value => value.trim().length >= 10 ? '' : 'Please tell us briefly why you are applying.'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function getField(name) {
  return form?.elements?.namedItem(name) || null;
}

function normaliseField(field) {
  if (!field) return;
  if (field.name === 'phone') field.value = field.value.replace(/\D/g, '').slice(0, 10);
  if (field.name === 'email') field.value = field.value.trim().toLowerCase();
  if (field.name === 'name' || field.name === 'college' || field.name === 'department' || field.name === 'state') {
    field.value = field.value.replace(/\s{2,}/g, ' ');
  }
}


function updateStepPresentation() {
  const meta = stepMeta[currentStep] || stepMeta[1];
  const title = document.getElementById('wizardTitle');
  const subtitle = document.getElementById('wizardSubtitle');
  const badge = document.getElementById('wizardStepBadge');
  const visual = document.getElementById('wizardVisualLabel');
  const hint = document.getElementById('wizardVisualHint');
  const progressText = document.getElementById('wizardProgressText');
  const timePill = document.getElementById('wizardTimePill');
  if (title) title.textContent = meta.title;
  if (subtitle) subtitle.textContent = meta.subtitle;
  if (badge) badge.textContent = meta.badge;
  if (visual) visual.textContent = meta.visual;
  if (hint) hint.textContent = meta.hint;
  if (progressText) progressText.textContent = meta.progressText;
  if (timePill) timePill.textContent = meta.time;
}

function moveTypingAura(field) {
  if (!typingAura || !applicationCard || !field || reducedMotion || window.innerWidth <= 820) return;
  const target = field.closest('.field-wrap') || field;
  const cardRect = applicationCard.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  typingAura.style.left = `${rect.left - cardRect.left + rect.width * 0.85}px`;
  typingAura.style.top = `${rect.top - cardRect.top + rect.height * 0.5}px`;
  applicationCard.classList.add('aura-live');
}

function hideTypingAura() {
  if (!typingAura || !applicationCard) return;
  applicationCard.classList.remove('aura-live');
}

function pulseFieldWrap(field) {
  const wrap = field?.closest('.field-wrap');
  if (!wrap) return;
  wrap.classList.add('valid-pop');
  window.setTimeout(() => wrap.classList.remove('valid-pop'), 520);
}


function isFieldValidQuiet(field) {
  if (!field || !field.required || !field.name || !fieldRules[field.name]) return true;
  const value = String(field.value || '');
  return !fieldRules[field.name](value);
}

function isStepComplete(step) {
  const panel = form?.querySelector(`.form-step[data-step="${step}"]`);
  if (!panel) return false;
  const fields = [...panel.querySelectorAll('input[name], select[name], textarea[name]')].filter(field => field.required);
  return fields.length > 0 && fields.every(isFieldValidQuiet);
}

function refreshStepAccess(celebrateUnlock = false) {
  if (!form) return;
  const currentPanel = form.querySelector(`.form-step[data-step="${currentStep}"]`);
  const ready = currentStep === 4 ? true : isStepComplete(currentStep);
  const nextButton = currentPanel?.querySelector('.next-step');

  currentPanel?.classList.toggle('step-ready', ready && currentStep < 4);

  if (nextButton) {
    const wasReady = nextButton.dataset.ready === 'true';
    nextButton.disabled = !ready;
    nextButton.setAttribute('aria-disabled', String(!ready));
    nextButton.dataset.ready = String(ready);
    if (ready && !wasReady && celebrateUnlock) {
      nextButton.classList.add('unlocked-now');
      window.setTimeout(() => nextButton.classList.remove('unlocked-now'), 760);
      launchSparks(6);
    }
  }

  stepDots.forEach(dot => {
    const dotStep = Number(dot.dataset.stepTarget);
    const canOpen = dotStep <= currentStep || (dotStep === currentStep + 1 && ready);
    const locked = dotStep > currentStep && !canOpen;
    dot.disabled = locked;
    dot.classList.toggle('locked', locked);
    dot.setAttribute('aria-disabled', String(locked));
    if (locked) dot.title = 'Complete the current step to unlock this section';
    else dot.removeAttribute('title');
  });
}

function validateField(field, showError = true) {
  if (!field || !field.name || !fieldRules[field.name]) return true;
  normaliseField(field);
  const error = fieldRules[field.name](String(field.value || ''));
  const wrap = field.closest('.field-wrap');
  const wasValid = wrap?.classList.contains('valid');
  const errorElement = document.getElementById(`${field.name}Error`);
  wrap?.classList.toggle('valid', !error);
  wrap?.classList.toggle('invalid', Boolean(error) && showError);
  if (!error && !wasValid) pulseFieldWrap(field);
  if (errorElement) errorElement.textContent = showError ? error : '';
  field.setAttribute('aria-invalid', String(Boolean(error) && showError));
  return !error;
}

function validateStep(step, focusFirst = true) {
  const panel = form?.querySelector(`.form-step[data-step="${step}"]`);
  const fields = panel ? [...panel.querySelectorAll('input[name], select[name], textarea[name]')].filter(field => field.required) : [];
  let firstInvalid = null;
  fields.forEach(field => {
    if (!validateField(field, true) && !firstInvalid) firstInvalid = field;
  });
  panel?.querySelector('.form-error')?.remove();
  if (firstInvalid) {
    const error = document.createElement('div');
    error.className = 'form-error';
    error.textContent = 'Please correct the highlighted field before continuing.';
    panel?.appendChild(error);
    if (focusFirst) firstInvalid.focus();
    return false;
  }
  return true;
}

function getFormData() {
  const form = document.getElementById('internshipForm');
  const fd = new FormData(form);
  return {
    name: String(fd.get('name') || '').trim(),
    phone: String(fd.get('phone') || '').replace(/\D/g, '').slice(-10),
    email: String(fd.get('email') || '').trim().toLowerCase(),
    college: String(fd.get('college') || '').trim(),
    department: String(fd.get('department') || '').trim(),
    year: String(fd.get('year') || '').trim(),
    interest: String(fd.get('interest') || '').trim(),
    domain: String(fd.get('domain') || '').trim(),
    state: String(fd.get('state') || '').trim(),
    communicationLanguage: String(fd.get('communicationLanguage') || '').trim(),
    startAvailability: String(fd.get('startAvailability') || '').trim(),
    applicationReason: String(fd.get('applicationReason') || '').trim()
  };
}

function calculateProgress() {
  const required = ['name', 'phone', 'email', 'college', 'department', 'year', 'domain', 'state', 'communicationLanguage', 'startAvailability', 'applicationReason'];
  const completed = required.filter(name => {
    const field = getField(name);
    return field && validateField(field, false);
  }).length;
  return Math.round((completed / required.length) * 100);
}

function motivationFor(progress) {
  if (progress === 0) return 'Start with your name—your draft will be saved automatically.';
  if (progress < 30) return 'Great start. Your contact profile is taking shape.';
  if (progress < 60) return 'Keep going—your academic profile is almost unlocked.';
  if (progress < 90) return 'Strong progress. Choose the track that matches your interest.';
  if (progress < 100) return 'One last detail and your application will be ready.';
  return 'Application ready. Review your details and submit with confidence.';
}

function updateJourney(triggerBoost = false) {
  const progress = calculateProgress();
  const wizardProgress = document.getElementById('wizardProgress');
  const bar = document.getElementById('journeyBar');
  const rocket = document.getElementById('journeyRocket');
  const percent = document.getElementById('journeyPercent');
  const text = document.getElementById('motivationText');
  const journey = document.getElementById('journeyCard');
  if (wizardProgress) wizardProgress.style.setProperty('width', `${progress}%`, 'important');
  if (bar) bar.style.width = `${progress}%`;
  if (rocket) rocket.style.left = `${progress}%`;
  if (percent) percent.textContent = `${progress}%`;
  if (text) text.textContent = motivationFor(progress);

  const nodes = [...document.querySelectorAll('.journey-nodes b')];
  nodes.forEach((node, index) => node.classList.toggle('active', progress >= [0, 45, 90][index]));

  document.querySelectorAll('[data-milestone]').forEach(badge => {
    const threshold = Number(badge.dataset.milestone);
    badge.classList.toggle('unlocked', progress >= threshold);
  });

  const milestone = progress >= 100 ? 100 : progress >= 60 ? 60 : progress >= 25 ? 25 : 0;
  if (milestone > lastMilestone) {
    lastMilestone = milestone;
    journey?.classList.add('milestone-hit');
    window.setTimeout(() => journey?.classList.remove('milestone-hit'), 850);
    if (milestone >= 60) launchSparks(10);
  }
  if (triggerBoost) {
    journey?.classList.add('field-boost');
    window.setTimeout(() => journey?.classList.remove('field-boost'), 280);
  }
  updateVisitor({ formProgress: progress, currentStep, status: progress ? 'filling_form' : 'online' });
}

function launchSparks(count = 12) {
  if (reducedMotion || !formCelebration) return;
  const colours = ['#246bfd', '#7047eb', '#2fc77f', '#ffbd52', '#c53ed6'];
  for (let index = 0; index < count; index += 1) {
    const spark = document.createElement('i');
    spark.className = 'spark';
    spark.style.left = `${42 + Math.random() * 16}%`;
    spark.style.top = `${28 + Math.random() * 35}%`;
    spark.style.setProperty('--tx', `${(Math.random() - .5) * 240}px`);
    spark.style.setProperty('--ty', `${-45 - Math.random() * 145}px`);
    spark.style.setProperty('--spark-color', colours[index % colours.length]);
    formCelebration.appendChild(spark);
    window.setTimeout(() => spark.remove(), 900);
  }
}

function saveDraft() {
  if (!form || submitLocked) return;
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    const data = getFormData();
    const hasData = Object.values(data).some(Boolean);
    if (hasData) localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
    else localStorage.removeItem(DRAFT_KEY);
  }, 180);
}

function restoreDraft() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw || !form) return;
  try {
    const draft = JSON.parse(raw);
    if (!draft.savedAt || Date.now() - draft.savedAt > 1000 * 60 * 60 * 24 * 14) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    ['name', 'phone', 'email', 'college', 'department', 'year', 'domain', 'interest', 'state', 'communicationLanguage', 'startAvailability', 'applicationReason'].forEach(name => {
      const field = getField(name);
      if (field && draft[name]) field.value = draft[name];
    });
    if (Object.values(draft).some(Boolean)) draftBanner.hidden = false;
    updateRecommendation();
    trackedFields.forEach(field => validateField(field, false));
    updateJourney();
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function clearDraft(resetForm = true) {
  localStorage.removeItem(DRAFT_KEY);
  if (resetForm) form?.reset();
  draftBanner.hidden = true;
  document.querySelectorAll('.field-wrap').forEach(wrap => wrap.classList.remove('valid', 'invalid'));
  document.querySelectorAll('.field-error').forEach(error => { error.textContent = ''; });
  lastMilestone = 0;
  updateRecommendation();
  showStep(1, false);
  updateJourney();
  refreshStepAccess(false);
}

function showStep(step, scroll = true) {
  const previousStep = currentStep;
  const requestedStep = Math.max(1, Math.min(4, Number(step) || 1));

  // A student cannot jump forward without completing the active step.
  if (requestedStep > currentStep && !isStepComplete(currentStep)) {
    validateStep(currentStep, true);
    refreshStepAccess(false);
    return;
  }

  currentStep = requestedStep;
  applicationCard.dataset.activeStep = String(currentStep);
  applicationCard.classList.add('step-transitioning');

  formSteps.forEach(panel => {
    const active = Number(panel.dataset.step) === currentStep;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
    panel.classList.remove('step-enter-forward', 'step-enter-backward');
    if (active) {
      // Restart the animation each time a step becomes visible.
      void panel.offsetWidth;
      panel.classList.add(currentStep >= previousStep ? 'step-enter-forward' : 'step-enter-backward');
    }
  });

  stepDots.forEach(dot => {
    const dotStep = Number(dot.dataset.stepTarget);
    dot.classList.toggle('active', dotStep === currentStep);
    dot.classList.toggle('completed', dotStep < currentStep);
    dot.setAttribute('aria-current', dotStep === currentStep ? 'step' : 'false');
  });

  if (currentStep === 4) renderReview();
  updateStepPresentation();
  refreshStepAccess(false);

  const wizardHero = document.getElementById('wizardHero');
  wizardHero?.classList.remove('step-swap');
  void wizardHero?.offsetWidth;
  wizardHero?.classList.add('step-swap');

  applicationCard.classList.add('step-celebrate');
  window.setTimeout(() => {
    applicationCard.classList.remove('step-celebrate', 'step-transitioning');
    wizardHero?.classList.remove('step-swap');
  }, 820);

  if (currentStep > 1) launchSparks(currentStep === 4 ? 14 : 8);
  updateJourney();
  updateVisitor({ currentStep, currentField: currentStep === 1 ? 'Contact details' : currentStep === 2 ? 'Academic profile' : currentStep === 3 ? 'Profile preferences' : 'Reviewing application' });

  if (scroll && window.innerWidth <= 820) {
    const top = applicationCard.getBoundingClientRect().top + window.scrollY - 82;
    window.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
}

function renderReview() {
  const review = document.getElementById('applicationReview');
  if (!review) return;
  const data = getFormData();
  const rows = [
    ['Full Name', data.name], ['WhatsApp', `+91 ${data.phone}`], ['Email', data.email],
    ['College', data.college], ['Department', data.department], ['Current Year', data.year], ['Interested Domain', data.domain], ['State', data.state], ['Communication Language', data.communicationLanguage], ['Start Availability', data.startAvailability], ['Application Reason', data.applicationReason]
  ];
  review.innerHTML = rows.map(([label, value]) => `<div class="review-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('');
}

const recommendationMap = {
  build: ['Web Development', 'App Development', 'Java'],
  data: ['Python', 'Artificial Intelligence', 'Data Science'],
  secure: ['Cyber Security', 'AWS & Cloud', 'IoT'],
  engineer: ['VLSI', 'Robotics', 'AutoCAD'],
  business: ['Digital Marketing', 'Finance', 'Business Analytics'],
  science: ['Bioinformatics', 'Genetic Engineering']
};

function updateRecommendation() {
  const interest = getField('interest')?.value;
  const result = document.getElementById('recommendationResult');
  if (!result) return;
  const options = recommendationMap[interest] || [];
  if (!options.length) {
    result.hidden = true;
    result.innerHTML = '';
    return;
  }
  result.hidden = false;
  result.innerHTML = `<strong>Recommended starting points:</strong><br>${options.map(option => `<button type="button" data-recommended-domain="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join('')}`;
}

function createReferralCode() {
  return `SKP${Date.now().toString(36).slice(-5).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function buildReferralUrl(code) {
  const url = new URL('referral.html', window.location.href);
  url.searchParams.set('ref', code);
  return url.toString();
}

function buildShareText(referralUrl) {
  return `🚀 *ONLINE INTERNSHIP PROGRAMME 2026*\n\nOpen to students from 1st year to final year across any degree or department.\n\n✅ Practical projects\n✅ Guided learning\n✅ Completion-based certification\n✅ Career preparation\n\nApply here:\n${referralUrl}`;
}

async function copyText(text, button, successLabel = 'Copied!') {
  const old = button?.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt('Copy this text:', text);
  }
  if (button) {
    button.textContent = successLabel;
    window.setTimeout(() => { button.textContent = old || 'Copy'; }, 1600);
  }
}

function showSuccess(data, applicationId, referralCode, referralUrl) {
  form.hidden = true;
  document.querySelector('.application-title')?.setAttribute('hidden', '');
  document.querySelector('.steps')?.setAttribute('hidden', '');
  document.querySelector('.secure')?.setAttribute('hidden', '');
  const shareText = buildShareText(referralUrl);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  message.innerHTML = `
    <section class="submission-success" aria-live="polite">
      <div class="success-icon">✓</div>
      <span>APPLICATION SUBMITTED</span>
      <h3>You're officially in the review queue.</h3>
      <p>Keep this reference for future communication. Programme details will be shared through the approved contact information you provided.</p>
      <div class="reference-card"><small>Application Reference</small><strong>${escapeHtml(applicationId)}</strong><button type="button" id="copyReference">Copy reference</button></div>
      <div class="success-details"><div><span>Applicant</span><strong>${escapeHtml(data.name)}</strong></div><div><span>Domain</span><strong>${escapeHtml(data.domain)}</strong></div><div><span>Current Year</span><strong>${escapeHtml(data.year)}</strong></div><div><span>Submitted</span><strong>${escapeHtml(new Date().toLocaleString('en-IN'))}</strong></div></div>
      <div class="referral-panel">
        <div class="referral-panel-head"><div><span class="referral-kicker">OPTIONAL REFERRAL</span><h4>Invite your classmates</h4><p>Your application is complete. If you want, share this opportunity with friends and classmates.</p></div><div class="referral-badge">↗</div></div>
        <div class="referral-code-card"><div><small>Your referral code</small><strong>${escapeHtml(referralCode)}</strong></div><button type="button" id="copyReferralCode">Copy code</button></div>
        <div class="share-actions">
          <a class="whatsapp" href="${whatsappUrl}" target="_blank" rel="noopener">WhatsApp</a>
          <button type="button" id="copyReferral">Copy referral link</button>
          <button type="button" id="nativeShare">More options</button>
        </div>
        <div class="quick-share-row">
          <a href="sms:?&body=${encodeURIComponent(shareText)}" id="smsShare">SMS</a>
          <a href="mailto:?subject=${encodeURIComponent('Online Internship Programme 2026')}&body=${encodeURIComponent(shareText)}" id="emailShare">Email</a>
        </div>
        <p class="share-note">Anyone who applies through your referral link will be attributed to your referral code. Sharing is optional and does not affect your application.</p>
      </div>
      <button type="button" class="success-home" id="newApplication">Return to programme page</button>
    </section>`;
  launchSparks(24);
  message.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });

  document.getElementById('copyReference')?.addEventListener('click', event => copyText(applicationId, event.currentTarget, 'Reference copied!'));
  document.getElementById('copyReferralCode')?.addEventListener('click', event => copyText(referralCode, event.currentTarget, 'Code copied!'));
  document.getElementById('copyReferral')?.addEventListener('click', event => copyText(referralUrl, event.currentTarget, 'Link copied!'));
  document.getElementById('nativeShare')?.addEventListener('click', async event => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Online Internship Programme 2026', text: shareText, url: referralUrl });
        recordReferralShare(referralCode, applicationId, 'native_share');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    await copyText(referralUrl, event.currentTarget, 'Link copied!');
  });
  document.querySelector('.whatsapp')?.addEventListener('click', () => recordReferralShare(referralCode, applicationId, 'whatsapp'));
  document.getElementById('smsShare')?.addEventListener('click', () => recordReferralShare(referralCode, applicationId, 'sms'));
  document.getElementById('emailShare')?.addEventListener('click', () => recordReferralShare(referralCode, applicationId, 'email'));
  document.getElementById('newApplication')?.addEventListener('click', () => location.assign(location.pathname));
}

function recordReferralShare(code, applicationId, method) {
  if (typeof db === 'undefined') return;
  db.ref(`referralShares/${code}`).push().set({ applicationId, method, sharedAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
}

function duplicateSubmission(phone) {
  try {
    const previous = JSON.parse(localStorage.getItem(LAST_SUBMISSION_KEY) || 'null');
    return previous && previous.phone === phone && Date.now() - previous.time < 15 * 60 * 1000;
  } catch {
    return false;
  }
}

async function submitApplication() {
  if (submitLocked || !form) return;
  if (!validateStep(1, false) || !validateStep(2, false)) {
    showStep(!validateStep(1, false) ? 1 : 2);
    return;
  }
  const consent = document.getElementById('applicationConsent');
  if (!consent?.checked) {
    consent?.focus();
    message.innerHTML = '<div class="message-error">Please confirm the programme terms and privacy notice before submitting.</div>';
    return;
  }

  const data = getFormData();
  if (duplicateSubmission(data.phone)) {
    message.innerHTML = '<div class="message-error">A recent application was already submitted from this WhatsApp number. Please avoid submitting it repeatedly.</div>';
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitLocked = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Submitting securely…';
  message.innerHTML = '';

  const referralCode = createReferralCode();
  const referralUrl = buildReferralUrl(referralCode);
  const submittedAtMs = Date.now();
  const submittedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(submittedAtMs));
  const application = {
    name: data.name,
    phone: data.phone,
    email: data.email,
    college: data.college,
    department: data.department,
    year: data.year,
    domain: data.domain,
    state: data.state,
    communicationLanguage: data.communicationLanguage,
    startAvailability: data.startAvailability,
    applicationReason: data.applicationReason,
    interest: data.interest || null,
    communicationConsent: Boolean(document.getElementById('communicationConsent')?.checked),
    termsAccepted: true,
    referralCode,
    referredBy: referralSource || null,
    referralUrl,
    submittedAt,
    submittedAtMs,
    source: 'skillpath_landing_final_v11'
  };

  try {
    if (typeof db === 'undefined') throw new Error('Firebase is unavailable');
    const applicationRef = db.ref('submittedApplications').push();
    application.applicationId = applicationRef.key;
    application.callStatus = 'Not Contacted';
    application.nextFollowUpAt = '';
    application.assignedTo = '';
    application.lastContactedAt = '';
    application.remarks = '';
    await applicationRef.set(application);

    // Spark-plan live counter: increment a privacy-safe aggregate only after
    // the application itself has been written successfully. The transaction
    // keeps simultaneous submissions from overwriting each other.
    try {
      await db.ref('publicStats/applicationCount').transaction(current => {
        const n = Number(current);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) + 1 : 1;
      });
    } catch (counterError) {
      console.warn('Public application counter update failed:', counterError);
    }

    updateVisitor({ status: 'submitted', presence: 'completed', formProgress: 100, applicationId: applicationRef.key, currentField: 'Application submitted' }, true);

    db.ref(`referrals/${referralCode}`).set({
      ownerApplicationId: applicationRef.key,
      ownerName: data.name,
      ownerPhone: data.phone,
      ownerEmail: data.email,
      ownerCollege: data.college,
      ownerDomain: data.domain,
      referralUrl,
      referredBy: referralSource || null,
      createdAt: submittedAt,
      createdAtMs: submittedAtMs
    }).catch(() => {});

    if (referralSource) {
      db.ref(`referralJoins/${referralSource}/${applicationRef.key}`).set({
        applicantName: data.name,
        applicantPhone: data.phone,
        applicantEmail: data.email,
        applicantCollege: data.college,
        applicantDomain: data.domain,
        applicantReferralCode: referralCode,
        joinedAt: submittedAt,
        joinedAtMs: submittedAtMs
      }).catch(() => {});
    }

    fetch(SHEET_ENDPOINT, {
      method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(application), keepalive: true
    }).catch(() => {});

    localStorage.setItem(LAST_SUBMISSION_KEY, JSON.stringify({ phone: data.phone, time: Date.now(), applicationId: applicationRef.key }));
    localStorage.removeItem(DRAFT_KEY);
    showSuccess(data, applicationRef.key, referralCode, referralUrl);
  } catch (error) {
    console.error('Application submission failed:', error);
    const permission = /permission|PERMISSION_DENIED/i.test(error?.message || error?.code || '');
    message.innerHTML = `<div class="message-error">${permission ? 'The database rules blocked this application. Update the Firebase rules for submittedApplications and try again.' : 'The application could not be submitted. Check your connection and try again.'}</div>`;
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit Application <span>→</span>';
    submitLocked = false;
  }
}

// Daily landing-page traffic tracking.
// One persistent browser/device ID is counted once per IST calendar day.
// IMPORTANT: this uses the existing publicStats/landingPageVisitors path so
// it works with the already-published Firebase rules as well.
(function trackDailyLandingPageTraffic(){
  function start(){
    if (typeof db === 'undefined' || typeof firebase === 'undefined') {
      console.warn('Daily traffic tracking: Firebase database is not ready.');
      return;
    }

    const VISITOR_ID_KEY = 'internsforge_landing_visitor_id_v8';
    let visitorId;
    try {
      visitorId = localStorage.getItem(VISITOR_ID_KEY);
      if (!visitorId) {
        visitorId = `landing_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        localStorage.setItem(VISITOR_ID_KEY, visitorId);
      }
    } catch (_) {
      visitorId = `landing_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    }

    function getISTDateKey(){
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
      return `${map.year}-${map.month}-${map.day}`;
    }

    async function registerToday(){
      const dateKey = getISTDateKey();
      const visitorRef = db.ref(`publicStats/landingPageVisitors/${visitorId}`);
      try {
        const result = await visitorRef.transaction(current => {
          const record = current && typeof current === 'object' ? current : {};
          const days = record.days && typeof record.days === 'object' ? record.days : {};
          if (days[dateKey]) return record;
          return {
            ...record,
            firstSeen: record.firstSeen || firebase.database.ServerValue.TIMESTAMP,
            days: {
              ...days,
              [dateKey]: firebase.database.ServerValue.TIMESTAMP
            }
          };
        });
        if (result && result.committed) {
          console.log('Daily landing visitor recorded:', dateKey);
        }
      } catch (error) {
        console.warn('Daily landing visitor registration failed:', error);
      }
    }

    registerToday();
    // Handles a visitor who keeps the page open across midnight IST.
    setInterval(registerToday, 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    setTimeout(start, 0);
  }
})();


// Application-form visitor tracking.
// A form visitor is counted live only while the visitor has the application
// form open. A persistent browser ID prevents refreshes from creating
// duplicate stored visitor profiles. The live session is removed on disconnect.
(function trackApplicationFormVisitors(){
  if (typeof db === 'undefined' || typeof firebase === 'undefined') return;

  const ID_KEY = 'internsforge_form_visitor_id_v2';
  let visitorId = null;

  try {
    visitorId = localStorage.getItem(ID_KEY);
    if (!visitorId) {
      visitorId = `form_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
      localStorage.setItem(ID_KEY, visitorId);
    }
  } catch (_) {
    visitorId = `form_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
  }

  const profileRef = db.ref(`publicStats/applicationFormVisitors/${visitorId}`);
  const liveRef = db.ref(`publicStats/applicationFormLive/${visitorId}`);

  let formOpen = false;
  let heartbeatTimer = null;

  function startFormVisit(){
    if (formOpen) return;
    formOpen = true;

    profileRef.transaction(current => {
      if (current === null) {
        return {
          firstSeen: firebase.database.ServerValue.TIMESTAMP,
          lastSeen: firebase.database.ServerValue.TIMESTAMP
        };
      }
      return {
        ...current,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      };
    }).catch(() => {});

    liveRef.set({
      startedAt: firebase.database.ServerValue.TIMESTAMP,
      lastSeen: firebase.database.ServerValue.TIMESTAMP,
      status: 'active'
    }).catch(() => {});

    liveRef.onDisconnect().remove().catch(() => {});

    heartbeatTimer = setInterval(() => {
      if (!formOpen) return;
      liveRef.update({
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
        status: 'active'
      }).catch(() => {});
      profileRef.update({
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      }).catch(() => {});
    }, 15000);
  }

  function stopFormVisit(){
    if (!formOpen) return;
    formOpen = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    liveRef.remove().catch(() => {});
  }

  // Capture any application-modal/form opener already present on the page.
  document.addEventListener('click', event => {
    const trigger = event.target.closest(
      '[data-open-application], [data-apply], .apply-btn, .apply-button, ' +
      '.hero-apply, .floating-apply, #applyBtn, #startApplicationBtn'
    );
    if (trigger) {
      setTimeout(() => {
        const modal = document.querySelector(
          '#applicationModal, #application-modal, .application-modal, [role="dialog"]'
        );
        if (modal && !modal.hidden && modal.offsetParent !== null) {
          startFormVisit();
        }
      }, 150);
    }
  }, true);

  // Observe the DOM so this also works with modals opened by JS without
  // a recognizable button class.
  const observer = new MutationObserver(() => {
    const modal = document.querySelector(
      '#applicationModal, #application-modal, .application-modal, [role="dialog"]'
    );
    const visible = !!(modal && !modal.hidden && modal.offsetParent !== null);
    if (visible) startFormVisit();
    else stopFormVisit();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class','style','hidden','aria-hidden']
  });

  window.addEventListener('pagehide', stopFormVisit);
})();

// Live visitor tracking. The admin dashboard mirrors the form fields that are
// currently visible to the student so staff can see live filling progress.
const visitorId = sessionStorage.getItem(VISITOR_KEY) || `visitor_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
sessionStorage.setItem(VISITOR_KEY, visitorId);
let visitorRef = null;
let visitorComplete = false;
// A landing-page visitor is NOT considered a form-filler just because a
// saved draft exists. Filling starts only after the application modal is open
// and the visitor actually has form progress.
let applicationFormOpen = false;
let formInteractionStarted = false;

function collectLiveFieldData() {
  return {
    name: getField('name')?.value.trim() || '',
    phone: getField('phone')?.value.trim() || '',
    email: getField('email')?.value.trim().toLowerCase() || '',
    college: getField('college')?.value.trim() || '',
    department: getField('department')?.value.trim() || '',
    year: getField('year')?.value || '',
    domain: getField('domain')?.value || '',
    consent: !!getField('consent')?.checked
  };
}

function updateVisitor(patch = {}, complete = false) {
  if (typeof db === 'undefined') return;
  visitorRef ||= db.ref(`liveVisitors/${visitorId}`);
  visitorComplete = visitorComplete || complete;
  const progress = Number.isFinite(Number(patch.formProgress)) ? Number(patch.formProgress) : calculateProgress();
  const canBeFilling = applicationFormOpen && formInteractionStarted && progress > 0;
  const nextStatus = patch.status || (canBeFilling ? 'filling_form' : 'online');
  visitorRef.update({
    page: 'Application Portal Final V11',
    presence: 'active',
    status: nextStatus,
    formProgress: progress,
    currentStep,
    currentField: patch.currentField || (progress > 0 ? `Step ${currentStep}` : 'Viewing page'),
    hasStartedFilling: progress > 0,
    fieldData: collectLiveFieldData(),
    lastActive: firebase.database.ServerValue.TIMESTAMP,
    referredBy: referralSource || null,
    ...patch
  }).catch(error => console.warn('Live visitor update failed:', error));
}

function initialiseVisitor() {
  if (typeof db === 'undefined') return;
  visitorRef = db.ref(`liveVisitors/${visitorId}`);
  // Always start as a landing-page visitor. A restored draft must not make
  // someone appear in "Currently Filling" until they open the form and interact.
  visitorRef.set({
    page: 'Application Portal Final V11',
    status: 'online',
    presence: 'active',
    formProgress: 0,
    currentStep: 1,
    currentField: 'Viewing page',
    hasStartedFilling: false,
    fieldData: collectLiveFieldData(),
    startedAt: firebase.database.ServerValue.TIMESTAMP,
    lastActive: firebase.database.ServerValue.TIMESTAMP,
    referredBy: referralSource || null
  }).catch(error => console.warn('Live visitor initialization failed:', error));
  // A live session is temporary. Remove it automatically when the browser
  // connection closes so the admin count cannot be stuck at 1.
  visitorRef.onDisconnect().remove().catch(() => {});
}

if (form) {
  form.addEventListener('focusin', event => {
    const field = event.target.closest('input[name],select[name],textarea[name]');
    if (!field) return;
    if (applicationFormOpen) formInteractionStarted = true;
    document.querySelectorAll('.field-wrap.focused').forEach(wrap => wrap.classList.remove('focused'));
    const wrap = field.closest('.field-wrap');
    wrap?.classList.add('focused');
    moveTypingAura(field);
  });
  form.addEventListener('input', event => {
    const field = event.target.closest('input[name],select[name],textarea[name]');
    if (!field) return;
    if (applicationFormOpen) formInteractionStarted = true;
    normaliseField(field);
    const wrap = field.closest('.field-wrap');
    const wasValid = wrap?.classList.contains('valid');
    wrap?.classList.add('typing');
    window.setTimeout(() => wrap?.classList.remove('typing'), 260);
    const nowValid = validateField(field, false);
    saveDraft();
    updateJourney(nowValid && !wasValid);
    refreshStepAccess(nowValid && !wasValid);
    moveTypingAura(field);
    updateVisitor({ currentField: field.name, status: 'filling_form' });
  });
  form.addEventListener('change', event => {
    const field = event.target.closest('input[name],select[name],textarea[name]');
    if (!field) return;
    if (applicationFormOpen) formInteractionStarted = true;
    validateField(field, true);
    if (field.name === 'interest') updateRecommendation();
    saveDraft();
    updateJourney(true);
    refreshStepAccess(true);
    moveTypingAura(field);
    updateVisitor({ currentField: field.name, status: 'filling_form' });
  });
  form.addEventListener('focusout', event => {
    const field = event.target.closest('input[name],select[name],textarea[name]');
    const wrap = field?.closest('.field-wrap');
    window.setTimeout(() => wrap?.classList.remove('focused'), 80);
    if (field?.required && field.value) validateField(field, true);
    if (!form.matches(':focus-within')) hideTypingAura();
  });
  form.addEventListener('click', event => {
    const next = event.target.closest('.next-step');
    const back = event.target.closest('.back-step');
    const recommendation = event.target.closest('[data-recommended-domain]');
    if (recommendation) {
      getField('domain').value = recommendation.dataset.recommendedDomain;
      validateField(getField('domain'), false);
      saveDraft();
      updateJourney(true);
      refreshStepAccess(true);
    }
    if (next && !next.disabled && validateStep(currentStep)) showStep(currentStep + 1);
    if (back) showStep(currentStep - 1);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    submitApplication();
  });
}

stepDots.forEach(dot => dot.addEventListener('click', () => {
  if (dot.disabled || dot.classList.contains('locked')) return;
  const requested = Number(dot.dataset.stepTarget);
  if (requested < currentStep) showStep(requested);
  else if (requested === currentStep + 1 && validateStep(currentStep)) showStep(requested);
}));

clearDraftButton?.addEventListener('click', () => clearDraft(true));
startOverApplicationButton?.addEventListener('click', () => {
  const hasData = Object.values(getFormData()).some(Boolean);
  if (!hasData) {
    clearDraft(true);
    return;
  }
  const confirmed = window.confirm('Clear this application and start over?\n\nAll information currently entered in this form will be removed from this device.');
  if (confirmed) clearDraft(true);
});

document.addEventListener('visibilitychange', () => {
  if (visitorComplete) return;
  if (document.visibilityState === 'hidden') updateVisitor({ presence: 'background' });
  else updateVisitor({ presence: 'active' });
});
window.addEventListener('pagehide', () => {
  if (!visitorComplete && visitorRef) {
    visitorRef.remove().catch(() => {});
  }
});

restoreDraft();
showStep(1, false);
updateStepPresentation();
updateJourney();
refreshStepAccess(false);
setTimeout(initialiseVisitor, 0);
window.setInterval(() => {
  if (visitorComplete) return;
  const liveProgress = (applicationFormOpen && formInteractionStarted) ? calculateProgress() : 0;
  const liveStatus = liveProgress > 0 ? 'filling_form' : 'online';
  updateVisitor({
    formProgress: liveProgress,
    currentStep: applicationFormOpen ? currentStep : 1,
    status: liveStatus,
    presence: 'active',
    hasStartedFilling: liveProgress > 0,
    currentField: liveProgress > 0 ? (getField(document.activeElement?.name)?.name || `Step ${currentStep}`) : 'Viewing page'
  });
}, 5000);

// Visible in DevTools so the deployed build can be verified without guessing.
console.info('SkillPath guided form build: Final V11');

