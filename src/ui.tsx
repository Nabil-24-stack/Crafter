// UI code - runs in the browser iframe
// This renders the plugin panel using React

import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { generateLayout, iterateLayout } from './claudeService';
import { DesignSystemData, Message } from './types';
import './ui.css';

const App = () => {
  // State management
  const [prompt, setPrompt] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isScanning, setIsScanning] = React.useState(false);
  const [designSystem, setDesignSystem] = React.useState<DesignSystemData | null>(null);
  const [result, setResult] = React.useState<string>('');
  const [error, setError] = React.useState<string>('');
  const [promptError, setPromptError] = React.useState<string>('');

  // Iteration mode state
  const [selectedFrame, setSelectedFrame] = React.useState<any | null>(null);
  const [frameId, setFrameId] = React.useState<string | null>(null);
  const [iterationPrompt, setIterationPrompt] = React.useState('');
  const [isIterating, setIsIterating] = React.useState(false);
  const [mode, setMode] = React.useState<'ideation' | 'iterate'>('ideation');

  // Variations state
  const [numberOfVariations, setNumberOfVariations] = React.useState<1 | 2 | 3>(1);
  const [isGeneratingVariations, setIsGeneratingVariations] = React.useState(false);

  // Set up message listener on mount
  React.useEffect(() => {
    // Listen for messages from plugin
    window.onmessage = (event) => {
      const msg: Message = event.data.pluginMessage;
      if (!msg) return;

      console.log('UI received message:', msg.type);

      switch (msg.type) {
        case 'design-system-data':
          setDesignSystem(msg.payload);
          setIsScanning(false);
          console.log('Design system loaded:', msg.payload);
          break;

        case 'selected-frame-data':
          if (msg.payload.frame) {
            setSelectedFrame(msg.payload.frame);
            setFrameId(msg.payload.frameId);
            setMode('iterate');
            console.log('Frame selected for iteration:', msg.payload.frame.name);
          } else {
            setSelectedFrame(null);
            setFrameId(null);
            setMode('ideation');
          }
          break;

        case 'generation-complete':
          setIsLoading(false);
          setIsGeneratingVariations(false);
          setResult(
            msg.payload.reasoning
              ? `Success! ${msg.payload.reasoning}`
              : 'Layout generated successfully!'
          );
          setError('');
          break;

        case 'iteration-complete':
          setIsIterating(false);
          setResult(msg.payload.message || 'Iteration applied successfully!');
          setError('');
          break;

        case 'generation-error':
          setIsLoading(false);
          setError(`Error: ${msg.payload.error}`);
          setResult('');
          break;

        case 'iteration-error':
          setIsIterating(false);
          setError(`Error: ${msg.payload.error}`);
          setResult('');
          break;

        case 'frame-json-exported':
          // Download the JSON file
          const { json, fileName } = msg.payload;
          const jsonString = JSON.stringify(json, null, 2);
          const blob = new Blob([jsonString], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          link.click();
          URL.revokeObjectURL(url);
          setResult('Frame exported successfully!');
          setError('');
          break;
      }
    };
  }, []);


  // Handle scan design system button click
  const handleScanDesignSystem = () => {
    setIsScanning(true);
    setError('');
    parent.postMessage({
      pluginMessage: {
        type: 'get-design-system'
      }
    }, '*');
  };

  // Generate variation prompts helper
  const generateVariationPrompts = (masterPrompt: string, n: number): string[] => {
    const variations = [
      `${masterPrompt} — Variation 1: Same concept, tighter layout, emphasize primary actions.`,
      `${masterPrompt} — Variation 2: Balanced layout, alternate component arrangements.`,
      `${masterPrompt} — Variation 3: More whitespace, simplified hierarchy.`
    ];
    return variations.slice(0, n);
  };

  // Handle generate variations - directly generates designs without concept selection
  const handleGenerateVariations = async () => {
    if (!prompt.trim()) {
      setPromptError('Provide a prompt to generate designs.');
      return;
    }

    if (!designSystem) {
      setError('Design system not loaded. Please scan first.');
      return;
    }

    setIsGeneratingVariations(true);
    setIsLoading(true);
    setError('');
    setResult('');
    setPromptError('');

    try {
      const apiKey = 'USE_PROXY';

      // Generate variation prompts
      const variationPrompts = generateVariationPrompts(prompt, numberOfVariations);

      // Generate all variations in parallel
      const variationResults = await Promise.all(
        variationPrompts.map(varPrompt => generateLayout(varPrompt, designSystem, apiKey))
      );

      // Send all variations to the plugin code for rendering
      parent.postMessage(
        {
          pluginMessage: {
            type: 'generate-variations',
            payload: {
              variations: variationResults,
              numberOfVariations,
            },
          },
        },
        '*'
      );

      // The plugin will send back generation-complete or generation-error
    } catch (err) {
      setIsGeneratingVariations(false);
      setIsLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to generate variations');
      console.error('Generation error:', err);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      if (mode === 'iterate') {
        handleIterate();
      } else {
        handleGenerateVariations();
      }
    }
  };

  // Handle iterate button click
  const handleIterate = async () => {
    if (!iterationPrompt.trim()) {
      setError('Please enter an iteration request');
      return;
    }

    if (!selectedFrame || !frameId) {
      setError('No frame selected');
      return;
    }

    if (!designSystem) {
      setError('Design system not loaded. Please scan first.');
      return;
    }

    setIsIterating(true);
    setError('');
    setResult('');

    try {
      const iterationResult = await iterateLayout(selectedFrame, iterationPrompt, designSystem);

      // Send the iteration result to the plugin code for applying
      parent.postMessage(
        {
          pluginMessage: {
            type: 'iterate-design',
            payload: {
              updatedLayout: iterationResult.updatedLayout,
              frameId: frameId,
            },
          },
        },
        '*'
      );

      // The plugin will send back iteration-complete or iteration-error
    } catch (err) {
      setIsIterating(false);
      setError(err instanceof Error ? err.message : 'Failed to iterate design');
      console.error('Iteration error:', err);
    }
  };

  // Handle export button click
  const handleExport = () => {
    parent.postMessage(
      {
        pluginMessage: {
          type: 'export-frame-json',
        },
      },
      '*'
    );
  };

  return (
    <div className="container">
      {/* Step 1: Centered initial screen */}
      {!designSystem && (
        <div className="initial-screen">
          <div className="header">
            <h1 className="title">The AI Twin For Designers</h1>
            <p className="subtitle">Ideate with your design system</p>
          </div>
          <button
            className="button scan-button"
            onClick={handleScanDesignSystem}
            disabled={isScanning}
          >
            {isScanning && <div className="spinner" />}
            {isScanning ? 'Scanning...' : 'Scan Design System'}
          </button>
        </div>
      )}

      {/* Step 2: Show design tools after scanning (header hidden) */}
      {designSystem && (
        <>
          {/* Iteration Mode */}
          {mode === 'iterate' && selectedFrame && (
            <div className="iteration-mode">
              <div className="mode-indicator">
                <p className="mode-label">Iterating on:</p>
                <p className="frame-name">{selectedFrame.name}</p>
              </div>

              <div className="input-group">
                <label htmlFor="iteration-prompt" className="label">
                  Iteration Request
                </label>
                <textarea
                  id="iteration-prompt"
                  className="textarea"
                  value={iterationPrompt}
                  onChange={(e) => setIterationPrompt(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="e.g., Make it more compact and minimal"
                  rows={3}
                  disabled={isIterating}
                />
              </div>

              <button
                className="button button-generate"
                onClick={handleIterate}
                disabled={isIterating}
              >
                {isIterating && <div className="spinner" />}
                {isIterating ? 'Iterating...' : 'Iterate Design'}
              </button>
            </div>
          )}

          {/* Ideation Mode */}
          {mode === 'ideation' && (
            <>
              {/* Prompt Input */}
              <div className="input-group">
                <label htmlFor="prompt" className="label">
                  Design Prompt
                </label>
                <textarea
                  id="prompt"
                  className="textarea"
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setPromptError('');
                  }}
                  onKeyDown={handleKeyPress}
                  placeholder="e.g., Create a banking dashboard with account overview and transactions"
                  rows={4}
                  disabled={isGeneratingVariations || isLoading}
                />
                {promptError && <p className="error-text">{promptError}</p>}
              </div>

              {/* Number of Variations Selector */}
              <div className="input-group">
                <label htmlFor="variations" className="label">
                  Number of Variations
                </label>
                <div className="variations-selector">
                  {[1, 2, 3].map((num) => (
                    <button
                      key={num}
                      className={`variation-button ${numberOfVariations === num ? 'active' : ''}`}
                      onClick={() => setNumberOfVariations(num as 1 | 2 | 3)}
                      disabled={isGeneratingVariations || isLoading}
                    >
                      {num}
                    </button>
                  ))}
                </div>
                <p className="hint-text">
                  {numberOfVariations === 1
                    ? 'Generate 1 design variation'
                    : `Generate ${numberOfVariations} design variations side-by-side`
                  }
                </p>
              </div>

              {/* Generate Variations Button */}
              <button
                className="button button-generate"
                onClick={handleGenerateVariations}
                disabled={isGeneratingVariations || isLoading}
              >
                {isGeneratingVariations && <div className="spinner" />}
                {isGeneratingVariations
                  ? `Generating ${numberOfVariations} variation${numberOfVariations > 1 ? 's' : ''}...`
                  : `Generate ${numberOfVariations} Variation${numberOfVariations > 1 ? 's' : ''}`
                }
              </button>
            </>
          )}

          {/* Results */}
          {result && <div className="result success">{result}</div>}
          {error && <div className="result error">{error}</div>}

          {/* Design System Info */}
          <div className="design-system-info">
            <div className="info-badge">
              <span className="badge-label">Components</span>
              <span className="badge-value">{designSystem.components.length}</span>
            </div>
            <div className="info-badge">
              <span className="badge-label">Colors</span>
              <span className="badge-value">{designSystem.colors.length}</span>
            </div>
            <div className="info-badge">
              <span className="badge-label">Text Styles</span>
              <span className="badge-value">{designSystem.textStyles.length}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="button-group">
            <button
              className="button button-secondary"
              onClick={handleExport}
              disabled={isScanning || isLoading}
            >
              Export Frame to JSON
            </button>

            <button
              className="button button-secondary"
              onClick={handleScanDesignSystem}
              disabled={isScanning || isLoading}
            >
              {isScanning && <div className="spinner" />}
              {isScanning ? 'Scanning...' : 'Re-scan Design System'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// Render the app
function initApp() {
  console.log('Initializing Crafter UI...');
  console.log('React version:', React.version);
  console.log('ReactDOM:', ReactDOM);

  const rootElement = document.getElementById('root');

  if (!rootElement) {
    console.error('Root element not found!');
    document.body.innerHTML = '<div style="padding: 20px; color: red;">ERROR: Root element not found!</div>';
    return;
  }

  try {
    console.log('Root element found, rendering React app...');
    // Clear the loading message
    rootElement.innerHTML = '';
    const root = ReactDOM.createRoot(rootElement);
    root.render(<App />);
    console.log('React app rendered successfully');
  } catch (error) {
    console.error('Error rendering React app:', error);
    rootElement.innerHTML = `<div style="padding: 20px; color: red;">ERROR: ${error instanceof Error ? error.message : 'Unknown error'}</div>`;
  }
}

// Wait for DOM to be ready
console.log('UI script loaded');
if (document.readyState === 'loading') {
  console.log('Waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  console.log('DOM already ready, initializing...');
  initApp();
}
