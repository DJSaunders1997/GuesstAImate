/**
 * auth.js — Google sign-in and auth state management.
 *
 * When a user signs in:
 *   1. Their Firestore data is fetched and merged with any existing localStorage.
 *   2. The header auth UI updates to show their photo and a sign-out button.
 *   3. All future storage reads/writes include Firestore sync.
 *
 * When a user signs out:
 *   1. localStorage is cleared of their data (stays private).
 *   2. The header auth UI returns to the sign-in button.
 *   3. The log list re-renders empty.
 *
 * Globals consumed: syncFromFirestore, clearCloudState (storage.js),
 *                   renderLogs, setStatus (render.js).
 */

let _authReady = false;

function initAuth() {
  firebase.auth().onAuthStateChanged(async user => {
    if (user) {
      setStatus('Syncing…', '');
      await syncFromFirestore(user.uid);
      setStatus('', '');
    } else {
      clearCloudState();
      renderLogs();
    }
    renderAuthUI(user);
    if (!_authReady) { _authReady = true; }
  });
}

function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch(err => {
    setStatus(`Sign-in failed: ${err.message}`, 'error');
  });
}

function signOutUser() {
  firebase.auth().signOut();
}

function getCurrentUser() {
  return firebase.auth().currentUser;
}

function renderAuthUI(user) {
  const el = document.getElementById('auth-section');
  if (!el) return;
  if (user) {
    el.innerHTML = `
      <div class="auth-signed-in">
        <img src="${escapeHtml(user.photoURL || '')}" class="auth-avatar" alt="${escapeHtml(user.displayName || 'User')}" referrerpolicy="no-referrer" />
        <button class="auth-btn auth-signout" onclick="signOutUser()" title="Sign out">Sign out</button>
      </div>`;
  } else {
    el.innerHTML = `<button class="auth-btn auth-signin" onclick="signInWithGoogle()">Sign in with Google</button>`;
  }
}
