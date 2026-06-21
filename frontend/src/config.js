// ── CONFIG ─────────────────────────────────────────────────────────────────
export const API  = import.meta.env.VITE_API_URL || 
(location.hostname === 'localhost' ? 'http://localhost:8000' : 'https://wheelttt.xyz')

export const WSS = import.meta.env.VITE_WSS_URL ||
 (location.hostname === 'localhost' ? 'ws://localhost:8000' : 'wss://wheelttt.xyz')

export const LANG = "en";
