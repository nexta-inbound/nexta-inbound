// Identificadores publicos do aplicativo; acesso aos dados depende das regras do banco.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA_-lNXk_GbSXl13gXLTtAqzQtvUuOV4Sw',
  authDomain: 'nexta-simulador-estoque.firebaseapp.com',
  databaseURL: 'https://nexta-simulador-estoque-default-rtdb.firebaseio.com',
  projectId: 'nexta-simulador-estoque',
  storageBucket: 'nexta-simulador-estoque.firebasestorage.app',
  messagingSenderId: '807845583858',
  appId: '1:807845583858:web:198fd12f5c4f58e102e96b',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDatabase = getDatabase(firebaseApp);
// A configuracao por si so nao le nem grava cenarios no banco.
