// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics, logEvent } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "***REMOVED-FIREBASE-WEB-KEY***",
  authDomain: "beepbite-e43e6.firebaseapp.com",
  projectId: "beepbite-e43e6",
  storageBucket: "beepbite-e43e6.firebasestorage.app",
  messagingSenderId: "175649462126",
  appId: "1:175649462126:web:dedd60617a70aa3418937f",
  measurementId: "G-50VD91S0GT"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Export analytics and logEvent for use in other components
export { analytics, logEvent };