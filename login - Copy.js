const emailInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const errorBox = document.getElementById("error");
const loginButton = document.getElementById("loginButton");

const forgotPasswordButton = document.getElementById("forgotPasswordButton");
const resetPanel = document.getElementById("resetPanel");
const resetEmailInput = document.getElementById("resetEmail");
const resetMessage = document.getElementById("resetMessage");
const resetSubmitButton = document.getElementById("resetSubmitButton");
const resetCancelButton = document.getElementById("resetCancelButton");

function showError(message) {
  errorBox.textContent = message;
}

function setResetMessage(message = "", type = "") {
  resetMessage.textContent = message;
  resetMessage.className = `reset-message${type ? ` ${type}` : ""}`;
}

function openResetPanel() {
  setResetMessage("");
  resetEmailInput.value = emailInput.value.trim();
  resetPanel.classList.add("is-open");
  resetPanel.setAttribute("aria-hidden", "false");
  window.setTimeout(() => resetEmailInput.focus(), 50);
}

function closeResetPanel() {
  resetPanel.classList.remove("is-open");
  resetPanel.setAttribute("aria-hidden", "true");
  setResetMessage("");
}

function getResetContinueUrl() {
  // The reset email is handled by Firebase's secure action page. After the
  // password is changed, Firebase can return the user to this login page.
  // Keep the URL on the same authorized production domain that sent the email.
  const origin = window.location.origin;
  if (origin && origin !== "null" && /^https?:$/i.test(window.location.protocol)) {
    return `${origin}/login.html?reset=success`;
  }
  return "https://mnc-internship.vercel.app/login.html?reset=success";
}

async function sendResetEmail() {
  const email = resetEmailInput.value.trim().toLowerCase();

  if (!email) {
    setResetMessage("Please enter your admin email address.", "error");
    resetEmailInput.focus();
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setResetMessage("Please enter a valid email address.", "error");
    resetEmailInput.focus();
    return;
  }

  resetSubmitButton.disabled = true;
  resetCancelButton.disabled = true;
  resetSubmitButton.textContent = "Sending...";
  setResetMessage("");

  try {
    const actionCodeSettings = {
      url: getResetContinueUrl(),
      handleCodeInApp: false
    };

    await auth.sendPasswordResetEmail(email, actionCodeSettings);

    setResetMessage(
      `Reset email sent to ${email}. Open the newest email and use the link once. If you requested multiple emails, older links may no longer work.`,
      "success"
    );

    resetSubmitButton.textContent = "Email Sent";
    window.setTimeout(() => {
      closeResetPanel();
      resetSubmitButton.disabled = false;
      resetCancelButton.disabled = false;
      resetSubmitButton.textContent = "Send Reset Link";
    }, 6500);
  } catch (error) {
    console.error("Firebase password reset request failed:", error);

    const friendlyMessages = {
      "auth/invalid-email": "Please enter a valid administrator email address.",
      "auth/user-not-found": "No Firebase administrator account was found for this email.",
      "auth/user-disabled": "This administrator account has been disabled.",
      "auth/too-many-requests": "Too many reset requests. Please wait and try again.",
      "auth/network-request-failed": "Network error. Check your internet connection and try again.",
      "auth/operation-not-allowed": "Email/password authentication is not enabled in Firebase Authentication."
    };

    setResetMessage(
      friendlyMessages[error.code] || error.message || "Unable to send the reset email. Please try again.",
      "error"
    );
    resetSubmitButton.disabled = false;
    resetCancelButton.disabled = false;
    resetSubmitButton.textContent = "Send Reset Link";
  }
}

async function login() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError("Please enter your Firebase email and password.");
    return;
  }

  loginButton.disabled = true;
  loginButton.innerHTML = `<span class="login-spinner" aria-hidden="true"></span> Signing in...`;
  showError("");

  try {
    await auth.signInWithEmailAndPassword(email, password);
    window.location.replace("admin.html");
  } catch (error) {
    console.error("Firebase login failed:", error);
    const friendlyMessages = {
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/user-disabled": "This administrator account has been disabled.",
      "auth/user-not-found": "Administrator account not found.",
      "auth/wrong-password": "Incorrect email or password.",
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/too-many-requests": "Too many attempts. Please try again later.",
      "auth/network-request-failed": "Network error. Check your connection and try again."
    };
    showError(friendlyMessages[error.code] || "Unable to sign in. Please check your Firebase login details.");
  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = `Login to Dashboard <span>→</span>`;
  }
}

forgotPasswordButton.addEventListener("click", openResetPanel);
resetSubmitButton.addEventListener("click", sendResetEmail);
resetCancelButton.addEventListener("click", closeResetPanel);

resetEmailInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendResetEmail();
});

resetPanel.addEventListener("click", (event) => {
  if (event.target === resetPanel) closeResetPanel();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && resetPanel.classList.contains("is-open")) {
    closeResetPanel();
  }
});

[emailInput, passwordInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") login();
  });
});

// Firebase's default password-reset handler returns here after the password
// has been successfully changed.
const params = new URLSearchParams(window.location.search);
if (params.get("reset") === "success") {
  showError("Password reset successful. Sign in with your new password.");
  window.history.replaceState({}, document.title, window.location.pathname);
}

auth.onAuthStateChanged((user) => {
  if (user) window.location.replace("admin.html");
});
