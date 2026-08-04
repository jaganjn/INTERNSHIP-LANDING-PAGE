const emailInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const errorBox = document.getElementById("error");
const loginButton = document.getElementById("loginButton");

function showError(message) {
  errorBox.textContent = message;
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
      "auth/too-many-requests": "Too many attempts. Please try again later."
    };
    showError(friendlyMessages[error.code] || "Unable to sign in. Please check your Firebase login details.");
  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = `Login to Dashboard <span>→</span>`;
  }
}

[emailInput, passwordInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") login();
  });
});

auth.onAuthStateChanged((user) => {
  if (user) window.location.replace("admin.html");
});
