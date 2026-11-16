import React, { useEffect, useState } from 'react';
import { Icon } from './icons';
import SelectField from './SelectField';
import { AiKeysApiError, fetchAiCredentialStatus, fetchAiModels, fetchAiProviders, validateAiKey } from '../lib/aiKeysApi';
import { isValidModelId, loadAiConfig, saveAiConfig } from '../lib/aiConfig';

// Built-in provider labels used only when the backend catalogue cannot be
// reached (e.g. the backend is down); the backend list wins.
const FALLBACK_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'modelscope', label: 'ModelScope (DashScope)' },
  { id: 'custom', label: 'Custom endpoint' },
];

const providerLabel = (providers, id) => (providers.find((item) => item.id === id) || {}).label || id;

export default function SettingsDrawer({ open, onClose, theme, setTheme, accent, setAccent }) {
  const [providers, setProviders] = useState(FALLBACK_PROVIDERS);
  // The provider / endpoint / model rows start from the persisted local
  // settings so a reopened drawer restores exactly what the user picked.
  const [initialConfig] = useState(loadAiConfig);
  const [provider, setProvider] = useState(initialConfig.provider);
  const [endpoint, setEndpoint] = useState(initialConfig.endpoint);
  const [model, setModel] = useState(initialConfig.model);
  const [apiKey, setApiKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  // Refresh the AI catalogue and the stored-credential status whenever the
  // drawer opens. Failures are non-fatal: the built-in list is kept and the
  // user can still enter a key.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAiProviders();
        if (!cancelled && Array.isArray(data.providers) && data.providers.length) setProviders(data.providers);
      } catch {
        /* keep the built-in catalogue */
      }
      try {
        const status = await fetchAiCredentialStatus();
        if (!cancelled) setSaved(status && status.configured ? status : null);
      } catch {
        if (!cancelled) setSaved(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Persist the local AI settings (provider, endpoint, model) on every
  // change. The API key is deliberately not part of this record: it is
  // validated and stored encrypted on the server, never in localStorage.
  useEffect(() => {
    saveAiConfig({
      provider,
      // A custom URL only belongs to the custom provider; built-in
      // providers use the backend catalogue endpoint, so never persist a
      // stale URL under them.
      endpoint: provider === 'custom' ? endpoint : '',
      model,
    });
  }, [provider, endpoint, model]);

  // While the drawer is open, the panel owns the only scrollbar: lock the
  // background page (body) so nothing behind it scrolls and the page's own
  // scrollbar disappears. The body's previous overflow state and the page's
  // scroll position are restored when the drawer closes or the component
  // unmounts, so the main page comes back exactly where it was.
  useEffect(() => {
    if (!open) return undefined;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousScrollTop = window.scrollY;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousOverflow;
      // Re-adding the page scrollbar shifts the layout width; put the page
      // back at the exact position it had before the drawer opened.
      window.scrollTo(0, previousScrollTop);
    };
  }, [open]);

  const handleProviderChange = (next) => {
    setProvider(next);
    // The discovered list and the picked model belong to the previous
    // provider (and its key / endpoint). Invalidate both so a model ID
    // from another provider is never silently reused — and no default
    // model is substituted: the row simply starts empty again.
    setModels([]);
    setModel('');
    setModelsError(null);
    setResult(null);
  };

  const handleEndpointChange = (value) => {
    setEndpoint(value);
    // The discovered list was fetched against the previous URL; the user
    // re-runs Load models once the URL is settled.
    setModels([]);
    setModelsError(null);
  };

  const handleLoadModels = async () => {
    setModelsError(null);
    if (!saved || !saved.configured) {
      // Model discovery decrypts the stored key server-side, so a stored
      // credential is required first.
      setModelsError('Validate the API key first — the model list uses your stored key.');
      return;
    }
    if (saved.provider !== provider) {
      setModelsError(
        `Your stored key is for ${providerLabel(providers, saved.provider)} — `
        + `validate the ${providerLabel(providers, provider)} key first, then load its models.`,
      );
      return;
    }
    setModelsLoading(true);
    try {
      const data = await fetchAiModels(provider === 'custom' ? { endpoint } : {});
      const list = data && Array.isArray(data.models) ? data.models : [];
      setModels(list);
      if (list.length === 0) setModelsError('The provider returned no models.');
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Could not load the model list.');
    } finally {
      setModelsLoading(false);
    }
  };

  const handleValidate = async () => {
    if (!apiKey.trim()) {
      setResult({ ok: false, message: 'Enter the API key first, then press Validate.' });
      return;
    }
    setValidating(true);
    setResult(null);
    const payload = { provider, apiKey: apiKey.trim() };
    if (provider === 'custom') payload.endpoint = endpoint;
    try {
      const data = await validateAiKey(payload);
      setValidating(false);
      if (data.valid) {
        setSaved({ configured: true, provider: data.provider, key_hint: data.key_hint, verified: true });
        setApiKey(''); // The key must not linger in the form after submission.
        setResult({ ok: true, message: data.message || 'Key verified and stored encrypted on the server.' });
      } else {
        setResult({ ok: false, message: data.message || 'The provider could not verify this key.' });
      }
    } catch (error) {
      setValidating(false);
      if (error instanceof AiKeysApiError && error.status === 401) {
        // With the device-identity header this is rare (it means the
        // backend rejected both identities, e.g. no Web Crypto at all).
        // It is no longer framed as a sign-in problem.
        setResult({ ok: false, message: 'Your AI settings could not be verified — please try again.' });
        return;
      }
      setResult({ ok: false, message: error instanceof Error ? error.message : 'Validation failed unexpectedly.' });
    }
  };

  if (!open) return null;
  const selectedLabel = providerLabel(providers, provider);
  const modelTrimmed = model.trim();
  const modelError = modelTrimmed !== '' && !isValidModelId(modelTrimmed)
    ? 'The model ID can only use letters, numbers and the characters . / _ -'
    : null;

  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close settings" />
      <aside className="settings-drawer" aria-label="Settings">
        <div className="drawer-head">
          <div><span className="eyebrow">Preferences</span><h2>Settings</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings"><Icon name="close" size={18} /></button>
        </div>

        <div className="drawer-body">
          <section className="settings-section">
            <span className="settings-label">Appearance</span>
            <div className="segmented">
              {['light', 'dark'].map((item) => <button key={item} className={theme === item ? 'selected' : ''} onClick={() => setTheme(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
            </div>
          </section>

          <section className="settings-section">
            <span className="settings-label">Accent color</span>
            <div className="accent-grid">
              {['#0B8F68', '#3568C8', '#7A5AF8', '#D97706', '#B83B5E'].map((color) => <button key={color} className={`accent-swatch ${accent === color ? 'selected' : ''}`} style={{ background: color }} onClick={() => setAccent(color)} aria-label={`Use ${color}`} />)}
            </div>
          </section>

          <section className="settings-section">
            <span className="settings-label">AI settings</span>

            <div className="ai-row">
              <span className="ai-row-label">Endpoint</span>
              <SelectField
                label="Provider"
                variant="dropdown"
                value={provider}
                onChange={handleProviderChange}
                options={providers.map((item) => ({ value: item.id, label: item.label }))}
                placeholder="Choose a provider"
              />
              {provider === 'custom' ? (
                <label className="input-shell ai-input">
                  <Icon name="settings" size={15} />
                  <input type="url" value={endpoint} onChange={(event) => handleEndpointChange(event.target.value)} placeholder="https://your-openai-compatible-gateway/v1" autoComplete="off" />
                </label>
              ) : null}
            </div>

            <div className="ai-row">
              <span className="ai-row-label">Model</span>
              <div className="ai-model-controls">
                <button type="button" className="secondary-button small" onClick={handleLoadModels} disabled={modelsLoading}>
                  {modelsLoading ? 'Loading…' : 'Load models'}
                </button>
                <SelectField
                  label="Discovered models"
                  variant="dropdown"
                  value={model}
                  onChange={setModel}
                  options={models.map((item) => ({
                    value: item.id,
                    label: item.name && item.name !== item.id ? `${item.id} (${item.name})` : item.id,
                  }))}
                  placeholder={models.length ? 'Choose a discovered model' : 'No models loaded yet'}
                />
              </div>
              <label className="input-shell ai-input">
                <Icon name="settings" size={15} />
                <input
                  type="text"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Model ID (e.g. deepseek-chat)"
                  autoComplete="off"
                  aria-label="Model ID"
                />
              </label>
              {modelError ? <p className="ai-field-error">{modelError}</p> : null}
            </div>

            <div className="ai-row">
              <span className="ai-row-label">API key</span>
              <label className="input-shell ai-input">
                <Icon name="lock" size={15} />
                <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={`API key for ${selectedLabel}`} autoComplete="off" />
              </label>
              <p className="ai-provider-note">The key is sent only to the PCL Tutor backend, which checks it against the provider and stores it encrypted. It is never kept in your browser and never shown again.</p>
              <button className="primary-button full small" onClick={handleValidate} disabled={validating}>{validating ? 'Validating…' : 'Validate API Key'}</button>
            </div>

            {result ? <div className={`ai-status ${result.ok ? 'ok' : 'err'}`}><Icon name={result.ok ? 'check' : 'x'} size={15} /><span>{result.message}</span></div> : null}
            {modelsError ? <div className="ai-status err"><Icon name="x" size={15} /><span>{modelsError}</span></div> : null}
            {saved && saved.configured ? (
              <p className="ai-status-saved">Stored on the server{saved.key_hint ? ` · …${saved.key_hint}` : ''}{saved.provider ? ` · ${providerLabel(providers, saved.provider)}` : ''}</p>
            ) : null}
          </section>
        </div>
      </aside>
    </>
  );
}
