const firebaseConfig = {
  apiKey: "AIzaSyCQ0P-301yjDPTSokOe4x0o01G_JCLZ4W4",
  authDomain: "webtoapk-f2868.firebaseapp.com",
  projectId: "webtoapk-f2868",
  storageBucket: "webtoapk-f2868.firebasestorage.app",
  messagingSenderId: "63147419146",
  appId: "1:63147419146:web:219affcfd7ed35ec4ae1f3"
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
