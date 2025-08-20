// /web/pages/_app.tsx
import type { AppProps } from 'next/app';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import '../styles/globals.css';

// Optional: make the socket available across HMR without reconnect storms
let socketSingleton: Socket | null = null;

export default function App({ Component, pageProps }: AppProps) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Client-only
    if (typeof window === 'undefined') return;

    // Reuse a singleton during HMR/route changes
    if (socketSingleton) {
      socketRef.current = socketSingleton;
      (window as any).socket = socketSingleton;
      return;
    }

    // Prefer explicit API origin; else fall back to same-origin
    const base =
      process.env.NEXT_PUBLIC_API_ORIGIN ||
      `${window.location.origin.replace(/\/$/, '')}`;

    // Must match server's Socket.IO path & CORS settings
    const socket = io(base, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      path: '/socket.io',
    });

    // Basic diagnostics; remove if noisy
    socket.on('connect', () => console.log('[socket] connected', socket.id));
    socket.on('connect_error', (err) =>
      console.error('[socket] connect_error', err?.message || err)
    );
    socket.on('disconnect', (reason) =>
      console.log('[socket] disconnected', reason)
    );

    // Example shared notes events wired up for visibility
    socket.on('notes:init', (notes) => console.log('[socket] notes:init', notes));
    socket.on('notes:updated', (notes) =>
      console.log('[socket] notes:updated', notes)
    );

    socketRef.current = socket;
    socketSingleton = socket;
    (window as any).socket = socket; // handy for DevTools

    return () => {
      // Keep the singleton alive across HMR/route changes;
      // if you want to fully tear down on unmount, uncomment below:
      // socket.disconnect();
      // socketSingleton = null;
      // socketRef.current = null;
      // delete (window as any).socket;
    };
  }, []);

  return (
    <>
      <div className="header">
        <h1>
          GopherA11y <span className="tag">Twin Cities</span>
        </h1>
        <div className="nav">
          <a href="/">Scanner</a>
          <a href="/crawl">Crawl</a>
          <a href="/vpat">VPAT</a>
          <a href="/at-matrix">AT Matrix</a>
          <a href="/syllabus">Syllabus</a>
          <a href="/procure">Procurement</a>
          <a href="/contrast">Contrast</a>
          <a href="/training">Training</a>
        </div>
      </div>
      <Component {...pageProps} />
    </>
  );
}
