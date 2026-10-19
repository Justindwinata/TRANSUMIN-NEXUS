'use client';

import { useEffect, useState } from 'react';

type Props = Readonly<{
  journeyId?: string;
  recoveryId?: string;
  defaultQuestion?: string;
}>;

type ToolAudit = Readonly<{
  tool: string;
  resultRef: string;
  status: string;
  latencyMs: number;
}>;
type CopilotResponse = {
  data: {
    message_id: string;
    session_id?: string;
    answer: string;
    evidence_references: string[];
    tool_result_references: string[];
    evidence_type: string;
    fallback_status: string;
  };
  meta: {
    request_id?: string;
    warnings: string[];
    provenance: {
      evidence_type: string;
      reference_ids: string[];
      observed_at: string | null;
      limitations: string[];
    } | null;
    tool_audit: ToolAudit[];
  };
};

export function CopilotDrawer({
  journeyId,
  recoveryId,
  defaultQuestion,
}: Props) {
  const recoveryContext = Boolean(recoveryId);
  const questionDefault =
    defaultQuestion ??
    (recoveryContext
      ? 'Explain this recovery proposal and its evidence.'
      : 'Explain this route and its legs.');
  const [question, setQuestion] = useState(questionDefault);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const context = recoveryId
    ? `recovery:${recoveryId}`
    : journeyId
      ? `journey:${journeyId}`
      : null;
  const disabled = !context || !question.trim() || busy;

  useEffect(() => {
    setQuestion(questionDefault);
    setBusy(false);
    setResult(null);
    setError(null);
  }, [context, questionDefault]);

  async function ask() {
    if (!context) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/passenger/copilot/messages', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: question.trim(),
          context_references: [context],
        }),
        cache: 'no-store',
      });
      const body = (await response.json()) as CopilotResponse & {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          body.error?.message ?? `Request failed (${response.status}).`,
        );
      setResult(body);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'Request failed. Check connection and retry.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="copilot-drawer"
      aria-label="Grounded copilot"
      aria-busy={busy}
    >
      <div>
        <strong>Grounded copilot — route &amp; recovery</strong>
        <p className="fine-print">
          Read-only deterministic explanation. Evidence is labeled from
          available route or recovery records; request digest retained, no raw
          sensitive prompt storage; retention 90 days. Tool trace is persisted
          owner-scoped.
        </p>
      </div>
      <label htmlFor="copilot-question">Question</label>
      <textarea
        id="copilot-question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        rows={3}
        maxLength={4000}
        placeholder={
          recoveryContext
            ? 'Explain this recovery proposal.'
            : 'Explain this route and its legs.'
        }
        aria-describedby="copilot-context"
      />
      <p id="copilot-context" className="fine-print">
        Context:{' '}
        <code>{context ?? 'none — provide journey or recovery context'}</code>
      </p>
      {!context && (
        <p className="empty-state">
          Copilot waits for selected journey or recovery context.
        </p>
      )}
      <button
        className="primary-button"
        type="button"
        onClick={() => void ask()}
        disabled={disabled}
      >
        {busy ? 'Asking…' : 'Ask grounded copilot'}
      </button>
      {busy && (
        <p className="fine-print" role="status">
          Reading authorized context…
        </p>
      )}
      {error && (
        <div className="feedback error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="copilot-result" aria-live="polite">
          <pre>{result.data.answer}</pre>
          <p className="fine-print">
            Provenance:{' '}
            {result.meta.provenance?.evidence_type ?? result.data.evidence_type}
            ; references {result.data.evidence_references.join(', ') || 'none'};
            observed {result.meta.provenance?.observed_at ?? 'not provided'}.{' '}
            Session {result.data.session_id ?? '—'}.
          </p>
          <p className="fine-print">
            Evidence <code>{result.data.evidence_type}</code> · Fallback{' '}
            <code>{result.data.fallback_status}</code>
          </p>
          {result.meta.tool_audit.length > 0 && (
            <ul className="fine-print" aria-label="Tool trace">
              {result.meta.tool_audit.map((audit) => (
                <li key={audit.resultRef}>
                  <code>{audit.tool}</code> — {audit.status} · {audit.latencyMs}{' '}
                  ms · <code>{audit.resultRef}</code>
                </li>
              ))}
            </ul>
          )}
          {result.meta.tool_audit.length === 0 && (
            <p className="fine-print">
              No tool executed: insufficient evidence, no read performed.
            </p>
          )}
          {result.meta.warnings.length > 0 && (
            <ul className="fine-print" aria-label="Uncertainty notice">
              {result.meta.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
