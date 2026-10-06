const firebaseConfig = {
  apiKey: "AIzaSyAJ6712p0MdiL2JKuh3GxuPuGSuRVp3ILI",
  authDomain: "mnc-internship-live.firebaseapp.com",
  databaseURL: "https://mnc-internship-live-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mnc-internship-live",
  storageBucket: "mnc-internship-live.firebasestorage.app",
  messagingSenderId: "190638783121",
  appId: "1:190638783121:web:492d77b4233cc23b8a5d30"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();

// Authentication SDK is loaded only on login.html and admin.html.
// Keeping this conditional prevents an error on the public landing page.
const auth = typeof firebase.auth === "function" ? firebase.auth() : null;
