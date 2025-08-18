import type { AppProps } from 'next/app'
import '../styles/globals.css'
export default function App({ Component, pageProps }: AppProps){
  return <>
    <div className="header">
      <h1>GopherA11y <span className="tag">Twin Cities</span></h1>
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
}
