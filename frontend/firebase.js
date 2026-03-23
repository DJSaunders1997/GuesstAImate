/**
 * firebase.js — Firebase app initialisation.
 *
 * SETUP: Replace the placeholder values below with your project's config.
 * Get them from: Firebase Console → Project Settings → Your apps → Config.
 *
 * You also need to:
 *   1. Enable Google sign-in under Authentication → Sign-in method.
 *   2. Add https://djsaunders1997.github.io to Authentication → Authorized domains.
 *   3. Create a Firestore database (start in production mode).
 *   4. Set these Firestore security rules:
 *
 *      rules_version = '2';
 *      service cloud.firestore {
 *        match /databases/{database}/documents {
 *          match /users/{userId} {
 *            allow read, write: if request.auth != null && request.auth.uid == userId;
 *          }
 *        }
 *      }
 */

const firebaseConfig = {
  apiKey:            'AIzaSyDwKQipN6I0KmE8WZvLuQcpZThRNG91ztE',
  authDomain:        'guesstaimate.firebaseapp.com',
  projectId:         'guesstaimate',
  storageBucket:     'guesstaimate.firebasestorage.app',
  messagingSenderId: '973930502882',
  appId:             '1:973930502882:web:8b1129ea2134a2c7ff9cbb',
  measurementId:     'G-X8H6KD352Y',
};

firebase.initializeApp(firebaseConfig);
