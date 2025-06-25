// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics, logEvent } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "***REMOVED-FIREBASE-WEB-KEY***",
  authDomain: "beepbite-io.firebaseapp.com",
  projectId: "beepbite-io",
  storageBucket: "beepbite-io.firebasestorage.app",
  messagingSenderId: "461673464535",
  appId: "1:461673464535:web:33a2d854b3f7be7017e692",
  measurementId: "G-7ZEQY4DED1"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Export analytics and logEvent for use in other components
export { analytics, logEvent };