// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics, logEvent } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "***REMOVED-FIREBASE-WEB-KEY***",
  authDomain: "case-on-pty.firebaseapp.com",
  projectId: "case-on-pty",
  storageBucket: "case-on-pty.firebasestorage.app",
  messagingSenderId: "227303496056",
  appId: "1:227303496056:web:0aa30b9987e3753aab508d",
  measurementId: "G-SEPE6VED3E"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Export analytics and logEvent for use in other components
export { analytics, logEvent };