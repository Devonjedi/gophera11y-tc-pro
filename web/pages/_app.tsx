import type { AppProps } from 'next/app';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // client-only + avoid duplicate connects on HMR
    if (typeof window === 'undefined') return;
    if (socketRef.current) return;

    const base =
      process.env.NEXT_PUBLIC_API_ORIGIN ||
      'https://gophera11y-api.onrender.com';

    const socket = io(base, {
      withCredentials: true,
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
    (window as any).socket = socket; // handy for debugging in DevTools

    return () => {
      socket.disconnect();
      socketRef.current = null;
      delete (window as any).socket;
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
