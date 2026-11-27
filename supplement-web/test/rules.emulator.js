// Security rules check against the local emulators.
// Run with: npm run test:rules  (starts the auth + firestore emulators for the duration)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, getDocs, collection, deleteDoc, updateDoc } from "firebase/firestore";

const PROJECT = "demo-supplement";

async function client(name, sub) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT, appId: "demo" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  if (sub) {
    const token = JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true });
    await signInWithCredential(auth, GoogleAuthProvider.credential(token));
  }
  return { app, db, uid: sub ? auth.currentUser.uid : null };
}

async function denied(promise) {
  await assert.rejects(promise, (e) => e.code === "permission-denied");
}

let owner, friend, stranger;

before(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  owner = await client("owner", "owner-uid");
  friend = await client("friend", "friend-uid");
  stranger = await client("stranger", null);
});

test("a signed-out visitor cannot read anything", async () => {
  await denied(getDocs(collection(stranger.db, "products")));
  await denied(getDoc(doc(stranger.db, "config", "admins")));
});

test("nobody can claim admin on behalf of someone else", async () => {
  await denied(setDoc(doc(friend.db, "config", "admins"), { uids: [owner.uid] }));
});

test("the first claim succeeds, later claims fail", async () => {
  await setDoc(doc(owner.db, "config", "admins"), { uids: [owner.uid] });
  await denied(setDoc(doc(friend.db, "config", "admins"), { uids: [friend.uid] }));
  await denied(updateDoc(doc(friend.db, "config", "admins"), { uids: [owner.uid, friend.uid] }));
  await denied(deleteDoc(doc(owner.db, "config", "admins")));
});

test("only the admin writes products; everyone signed in reads them", async () => {
  await setDoc(doc(owner.db, "products", "p1"), { name: "Omega 3", photo: null });
  await denied(setDoc(doc(friend.db, "products", "p2"), { name: "Sneaky" }));
  await denied(updateDoc(doc(friend.db, "products", "p1"), { name: "Changed" }));
  await denied(deleteDoc(doc(friend.db, "products", "p1")));
  const snap = await getDoc(doc(friend.db, "products", "p1"));
  assert.equal(snap.data().name, "Omega 3");
});

test("products reject non-image photo data and empty names", async () => {
  await denied(setDoc(doc(owner.db, "products", "p3"), { name: "X", photo: "javascript:alert(1)" }));
  await denied(setDoc(doc(owner.db, "products", "p4"), { name: "" }));
});

test("only the admin edits the shared rotation; everyone signed in reads it", async () => {
  const plan = { methods: [{ id: "m1", title: "섭취법 1", lunch: [], dinner: [] }] };
  await setDoc(doc(owner.db, "config", "rotation"), plan);
  await denied(setDoc(doc(friend.db, "config", "rotation"), { methods: [{ id: "x", title: "몰래", lunch: [], dinner: [] }] }));
  await denied(deleteDoc(doc(friend.db, "config", "rotation")));
  await denied(setDoc(doc(owner.db, "config", "rotation"), { methods: [] }));
  const snap = await getDoc(doc(friend.db, "config", "rotation"));
  assert.equal(snap.data().methods[0].title, "섭취법 1");
  // each person's own cycle is private
  await setDoc(doc(friend.db, "users", friend.uid, "meta", "cycle"), { methodId: "m1", startDay: 1, items: [] });
  await denied(getDoc(doc(owner.db, "users", friend.uid, "meta", "cycle")));
  await denied(getDoc(doc(stranger.db, "config", "rotation")));
});

test("only the admin edits 상황별 세트; everyone signed in reads them", async () => {
  const set = { title: "운동 부스터", note: "운동 전 공복", items: [{ productId: "p1", perDose: 2, meals: ["morning"], memo: "" }] };
  await setDoc(doc(owner.db, "sets", "s1"), set);
  await denied(setDoc(doc(friend.db, "sets", "s2"), set));
  await denied(updateDoc(doc(friend.db, "sets", "s1"), { title: "바꿈" }));
  await denied(deleteDoc(doc(friend.db, "sets", "s1")));
  await denied(setDoc(doc(owner.db, "sets", "s3"), { ...set, title: "" }));
  await denied(setDoc(doc(owner.db, "sets", "s4"), { ...set, items: [] }));
  assert.equal((await getDoc(doc(friend.db, "sets", "s1"))).data().title, "운동 부스터");
  await denied(getDoc(doc(stranger.db, "sets", "s1")));
});

test("personal data is private to its owner", async () => {
  await setDoc(doc(owner.db, "users", owner.uid, "items", "i1"), { name: "Mine" });
  await setDoc(doc(owner.db, "users", owner.uid, "meta", "rotation"), { rows: [], notes: "secret" });
  await denied(getDoc(doc(friend.db, "users", owner.uid, "items", "i1")));
  await denied(getDocs(collection(friend.db, "users", owner.uid, "items")));
  await denied(getDoc(doc(friend.db, "users", owner.uid, "meta", "rotation")));
  await denied(setDoc(doc(friend.db, "users", owner.uid, "items", "i2"), { name: "Planted" }));
  await setDoc(doc(friend.db, "users", friend.uid, "items", "f1"), { name: "Friend's" });
});

test("cleanup", async () => {
  await Promise.all([owner, friend, stranger].map((c) => deleteApp(c.app)));
});
