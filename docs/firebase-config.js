const firebaseConfig = {
  apiKey: "AIzaSyDMKRFChW1MeUkGTH_rMyKImFTT-IQZptw",
  authDomain: "webtoapk-ab3e4.firebaseapp.com",
  databaseURL: "https://webtoapk-ab3e4-default-rtdb.firebaseio.com",
  projectId: "webtoapk-ab3e4",
  storageBucket: "webtoapk-ab3e4.firebasestorage.app",
  messagingSenderId: "1036876948372",
  appId: "1:1036876948372:web:9c625172794c9879742581"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

function getDeviceId() {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = "dev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    localStorage.setItem("device_id", id);
  }
  return id;
}
