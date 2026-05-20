// src/firebase.js

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyB_L8Hsk3QL0rYTsK-ZU3ckUxPH4n9NgGI",
  authDomain: "canvas-rampart-454804-b1.firebaseapp.com",
  projectId: "canvas-rampart-454804-b1",
  storageBucket: "canvas-rampart-454804-b1.firebasestorage.app",
  messagingSenderId: "951629223566",
  appId: "1:951629223566:web:8c9fc82e65c973a678dbdf",
  measurementId: "G-5VLQDLTXY4",
};

const app = initializeApp(firebaseConfig);

const analytics = getAnalytics(app);

export const db = getFirestore(app);
export const auth = getAuth(app);