(function () {
  const loading = document.getElementById('loading');
  const loadingMessage = document.getElementById('loadingMessage');
  const resetForm = document.getElementById('resetForm');
  const done = document.getElementById('done');
  const failed = document.getElementById('failed');
  const failedMessage = document.getElementById('failedMessage');
  const accountEmail = document.getElementById('accountEmail');
  const passwordForm = document.getElementById('passwordForm');
  const newPassword = document.getElementById('newPassword');
  const confirmPassword = document.getElementById('confirmPassword');
  const resetButton = document.getElementById('resetButton');
  const formMessage = document.getElementById('formMessage');

  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const actionCode = params.get('oobCode');
  const continueUrl = params.get('continueUrl');

  function showOnly(section) {
    [loading, resetForm, done, failed].forEach((el) => el.classList.add('hidden'));
    section.classList.remove('hidden');
  }

  function safeContinueUrl() {
    if (!continueUrl) return 'login.html?reset=success';
    try {
      const url = new URL(continueUrl, window.location.origin);
      const allowedHosts = new Set([window.location.host, 'mnc-internship.vercel.app', 'nexarvia-technologies.vercel.app']);
      if (url.protocol === 'https:' && allowedHosts.has(url.host)) return url.toString();
    } catch (_) {}
    return 'login.html?reset=success';
  }

  function friendlyError(error) {
    const code = error && error.code ? error.code : '';
    const map = {
      'auth/expired-action-code': 'This reset link has expired. Request a new reset email.',
      'auth/invalid-action-code': 'This reset link is invalid or has already been used. Request a new reset email.',
      'auth/user-disabled': 'This admin account is disabled. Contact the Firebase project administrator.',
      'auth/weak-password': 'That password is too weak. Please choose a stronger password.',
      'auth/network-request-failed': 'Network error. Check your internet connection and try again.'
    };
    return map[code] || (error && error.message) || 'The reset link could not be verified.';
  }

  async function init() {
    if (mode !== 'resetPassword' || !actionCode) {
      showOnly(failed);
      failedMessage.textContent = 'The email link is missing the Firebase password-reset code.';
      return;
    }

    try {
      loadingMessage.textContent = 'Verifying the one-time reset code…';
      const email = await auth.verifyPasswordResetCode(actionCode);
      accountEmail.textContent = email;
      showOnly(resetForm);
      newPassword.focus();
    } catch (error) {
      console.error('Password reset code verification failed:', error);
      showOnly(failed);
      failedMessage.textContent = friendlyError(error);
    }
  }

  passwordForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const password = newPassword.value;
    const confirmation = confirmPassword.value;
    formMessage.className = 'message';
    formMessage.textContent = '';

    if (password.length < 6) {
      formMessage.classList.add('error');
      formMessage.textContent = 'Password must be at least 6 characters.';
      return;
    }
    if (password !== confirmation) {
      formMessage.classList.add('error');
      formMessage.textContent = 'The passwords do not match.';
      return;
    }

    resetButton.disabled = true;
    resetButton.textContent = 'Resetting…';
    try {
      await auth.confirmPasswordReset(actionCode, password);
      showOnly(done);
      window.setTimeout(() => { window.location.href = safeContinueUrl(); }, 1800);
    } catch (error) {
      console.error('Password reset confirmation failed:', error);
      resetButton.disabled = false;
      resetButton.textContent = 'Reset Password';
      formMessage.classList.add('error');
      formMessage.textContent = friendlyError(error);
    }
  });

  init();
})();
