'use client';

import './globals.css';

// The last resort, when the root layout itself fails. It replaces the whole document.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main id="main" className="auth-shell">
          <div className="auth-card">
            <h1>Something went wrong.</h1>
            <p className="auth-intro">GigaCAD couldn’t load this page. Your files are safe. Try again in a moment.</p>
            <button type="button" className="button auth-submit" onClick={reset}>Try again</button>
          </div>
        </main>
      </body>
    </html>
  );
}
