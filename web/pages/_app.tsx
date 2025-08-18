import type { AppProps } from 'next/app';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import Link from 'next/link';
import '../styles/globals.css';

// (Optional) TS help for window.socket
declare global {
  interface Window {
    socket?: Socket;
  }
}

export default function App({ Component, pageProps }: AppProps) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // client-only + avoid duplicate connects during HMR/StrictMode
    if (typeof window === 'undefined') return;
    if (socketRef.current) return;

    // Use consistent API URL - same as your backend
    const base = process.env.NEXT_PUBLIC_API_URL || 'https://gophera11y-api.onrender.com';

    const socket = io(base, {
      withCredentials: true,        // set to false if you don't use cookies
      transports: ['websocket', 'polling'],
      path: '/socket.io',
    });

    socket.on('connect', () => console.log('[socket] connected', socket.id));
    socket.on('connect_error', (err) =>
      console.error('[socket] connect_error', err?.message || err)
    );
    socket.on('notes:init', (notes) =>
      console.log('[socket] notes:init', notes)
    );
    socket.on('notes:updated', (notes) =>
      console.log('[socket] notes:updated', notes)
    );

    socketRef.current = socket;
    window.socket = socket; // handy for DevTools

    return () => {
      socket.disconnect();
      socketRef.current = null;
      delete window.socket;
    };
  }, []);

  return (
    <>
      <div className="header">
        <h1>
          GopherA11y <span className="tag">Twin Cities</span>
        </h1>
        <div className="nav">
          <Link href="/">Scanner</Link>
          <Link href="/crawl">Crawl</Link>
          <Link href="/vpat">VPAT</Link>
          <Link href="/at-matrix">AT Matrix</Link>
          <Link href="/syllabus">Syllabus</Link>
          <Link href="/procure">Procurement</Link>
          <Link href="/contrast">Contrast</Link>
          <Link href="/training">Training</Link>
        </div>
      </div>
      <Component {...pageProps} />
    </>
  );
}
