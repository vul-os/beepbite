// src/pages/legal/terms.jsx
// Renders the current Terms of Service fetched from GET /legal/terms/current.
// Route: /legal/terms
import React from 'react';
import { getCurrentDocument } from '../../services/legal.js';

// Minimal Markdown-to-HTML renderer for safe, predictable rendering.
// Handles headings (h1–h4), bold, italic, inline code, horizontal rules,
// paragraphs, and unordered lists. External sanitiser not required because
// body_md is server-controlled content, not user input.
function renderMarkdown(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const html = [];
  let inList = false;
  let inTable = false;
  let tableHeaderDone = false;

  const flush = () => {
    if (inList) { html.push('</ul>'); inList = false; }
    if (inTable) { html.push('</tbody></table>'); inTable = false; tableHeaderDone = false; }
  };

  const inline = (t) =>
    t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

  for (const raw of lines) {
    const line = raw;

    // Headings
    if (/^#{1,4} /.test(line)) {
      flush();
      const level = line.match(/^(#{1,4}) /)[1].length;
      const text = inline(line.replace(/^#{1,4} /, ''));
      html.push(`<h${level} class="legal-h${level}">${text}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flush();
      html.push('<hr/>');
      continue;
    }

    // Table rows (simple | col | col | pattern)
    if (/^\|/.test(line)) {
      if (!inTable) {
        html.push('<table class="legal-table"><thead>');
        inTable = true;
        tableHeaderDone = false;
      }
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (!tableHeaderDone && /^-+$/.test(cells[0].replace(/:/g, ''))) {
        html.push('</thead><tbody>');
        tableHeaderDone = true;
      } else if (!tableHeaderDone) {
        const tag = 'th';
        html.push(`<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`);
      } else {
        html.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      }
      continue;
    }

    // Unordered list
    if (/^- /.test(line)) {
      if (inTable) flush();
      if (!inList) { html.push('<ul class="legal-list">'); inList = true; }
      html.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }

    // Blockquote
    if (/^> /.test(line)) {
      flush();
      html.push(`<blockquote class="legal-blockquote">${inline(line.slice(2))}</blockquote>`);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      flush();
      html.push('<br/>');
      continue;
    }

    // Paragraph
    flush();
    html.push(`<p class="legal-p">${inline(line)}</p>`);
  }

  flush();
  return html.join('\n');
}

const TermsPage = () => {
  const [doc, setDoc] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    getCurrentDocument('terms').then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(err?.message || 'Failed to load Terms of Service.');
      else setDoc(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="legal-page" role="main">
      <div className="legal-container">
        {loading && (
          <p className="legal-loading" aria-live="polite" aria-busy="true">
            Loading Terms of Service&hellip;
          </p>
        )}

        {error && !loading && (
          <p className="legal-error" role="alert">
            {error}
          </p>
        )}

        {doc && !loading && (
          <>
            <p className="legal-meta">
              Version {doc.version} &middot; Effective{' '}
              {new Date(doc.effective_at).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>
            <div
              className="legal-body"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.body_md) }}
            />
          </>
        )}
      </div>

      <style>{`
        .legal-page {
          min-height: 100vh;
          background: #fff;
          padding: 2rem 1rem 4rem;
          font-family: system-ui, -apple-system, sans-serif;
          color: #1a1a2e;
        }
        .legal-container {
          max-width: 760px;
          margin: 0 auto;
        }
        .legal-loading, .legal-error { padding: 2rem 0; color: #555; }
        .legal-error { color: #c0392b; }
        .legal-meta {
          font-size: 0.875rem;
          color: #888;
          margin-bottom: 2rem;
          border-bottom: 1px solid #eee;
          padding-bottom: 1rem;
        }
        .legal-body { line-height: 1.75; }
        .legal-h1 { font-size: 2rem; font-weight: 800; margin: 0 0 1rem; }
        .legal-h2 { font-size: 1.4rem; font-weight: 700; margin: 2rem 0 0.75rem; }
        .legal-h3 { font-size: 1.15rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
        .legal-h4 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 0.4rem; }
        .legal-p  { margin: 0.6rem 0; }
        .legal-list { margin: 0.5rem 0 0.5rem 1.5rem; }
        .legal-list li { margin: 0.3rem 0; }
        .legal-blockquote {
          border-left: 3px solid #e67e22;
          padding: 0.5rem 1rem;
          margin: 1rem 0;
          background: #fdf3e7;
          border-radius: 0 4px 4px 0;
          font-style: italic;
        }
        .legal-table {
          width: 100%;
          border-collapse: collapse;
          margin: 1rem 0;
          font-size: 0.9rem;
        }
        .legal-table th, .legal-table td {
          border: 1px solid #e2e8f0;
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .legal-table th { background: #f7f7f7; font-weight: 600; }
        hr { border: none; border-top: 1px solid #eee; margin: 2rem 0; }
        code { background: #f0f0f0; padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
      `}</style>
    </div>
  );
};

export default TermsPage;
