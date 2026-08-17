// firebase.js — Kız Tavlası
// Firebase v10 modular SDK, loaded straight from the CDN (no build step needed).
// This file is imported as an ES module from app.js.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  increment,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAMdrn-EMPPAhNj-HQueegT5UWSfrrpdHY",
  authDomain: "kzavlasii.firebaseapp.com",
  projectId: "kzavlasii",
  storageBucket: "kzavlasii.firebasestorage.app",
  messagingSenderId: "262770437278",
  appId: "1:262770437278:web:16e2d509204426182a9f8f",
  measurementId: "G-FYQ6X9FX72",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  app,
  auth,
  db,
  signInAnonymously,
  onAuthStateChanged,
  updateProfile,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  increment,
};
