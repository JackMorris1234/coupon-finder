import { useState } from 'react';

export default function CopyCode({ code }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <button className={`code ${copied ? 'copied' : ''}`} onClick={copy} title="Copy code">
      <span>{code}</span>
      <span className="copy-label">{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
}
