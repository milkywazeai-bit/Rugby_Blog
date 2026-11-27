import { initializeApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signInWithCredential, onAuthStateChanged, signOut
} from "firebase/auth";
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache
} from "firebase/firestore";
import { firebaseConfig } from "./config.js";

const params = new URLSearchParams(location.search);
const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname);
export const useEmulator = isLocalHost && (params.has("emulator") || firebaseConfig.projectId === "REPLACE_ME");
export const isConfigured = useEmulator || firebaseConfig.projectId !== "REPLACE_ME";

let app, auth, db;

export function initFirebase() {
  if (!isConfigured) return null;
  const config = useEmulator
    ? { apiKey: "demo-key", authDomain: "localhost", projectId: "demo-supplement", appId: "demo" }
    : { ...firebaseConfig };
  app = initializeApp(config);
  auth = getAuth(app);
  auth.languageCode = "ko";
  let localCache;
  try {
    localCache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  } catch {
    localCache = memoryLocalCache();
  }
  db = initializeFirestore(app, { localCache });
  if (useEmulator) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return { app, auth, db };
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

// Emulator only: the auth emulator accepts an unsigned fake Google token, so local
// tests can sign in as distinct users without the Google account picker.
export async function signInTestUser(sub, email, name) {
  if (!useEmulator) throw new Error("emulator only");
  const token = JSON.stringify({ sub, email, email_verified: true, name });
  await signInWithCredential(auth, GoogleAuthProvider.credential(token));
}

export function logOut() {
  return signOut(auth);
}

export { auth, db };
