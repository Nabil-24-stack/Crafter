// UI code - Chat-based iteration interface
// Refactored from tab-based to chat-based design

import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { iterateLayout } from './claudeService';
import {
  Chat,
  ChatMessage,
  DesignSystemData,
  IterationData,
  Message,
  VariationStatus,
} from './types';
import { ChatInterface } from './components/ChatInterface';
import './ui.css';

const App = () => {
  // Design system state
  const [designSystem, setDesignSystem] = React.useState<DesignSystemData | null>(null);
  const [isScanning, setIsScanning] = React.useState(false);

  // Chat state
  const [chat, setChat] = React.useState<Chat>({
    id: generateId(),
    name: 'Blank Chat',
    messages: [],
    createdAt: Date.now(),
  });

  // Selected frame state
  const [selectedFrameInfo, setSelectedFrameInfo] = React.useState<{
    frameId: string;
    frameName: string;
  } | null>(null);

  // Generation state
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [activeJobIds, setActiveJobIds] = React.useState<string[]>([]);

  // Generate unique ID
  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Set up message listener on mount
  React.useEffect(() => {
    window.onmessage = (event) => {
      const msg: Message = event.data.pluginMessage;
      if (!msg) return;

      console.log('UI received message:', msg.type);

      switch (msg.type) {
        case 'design-system-data':
          setDesignSystem(msg.payload);
          setIsScanning(false);
          console.log('Design system received:', {
            components: msg.payload?.components?.length,
            colors: msg.payload?.colors?.length,
            textStyles: msg.payload?.textStyles?.length,
          });
          break;

        case 'selected-frame-data':
          if (msg.payload.frameId && msg.payload.frameName) {
            setSelectedFrameInfo({
              frameId: msg.payload.frameId,
              frameName: msg.payload.frameName,
            });
            console.log('Frame selected:', msg.payload.frameName);
          } else {
            setSelectedFrameInfo(null);
            console.log('No frame selected');
          }
          break;

        case 'frame-png-exported':
          if (msg.payload.imageData) {
            // Start iteration with the exported PNG
            const pending = pendingIterationRef.current;
            if (pending) {
              startIterationWithPNG(
                msg.payload.imageData,
                pending.prompt,
                pending.variations,
                pending.designSystem,
                pending.frameId,
                pending.model
              );
              pendingIterationRef.current = null;
            }
          }
          break;

        case 'iteration-complete':
          console.log('Iteration complete:', msg.payload);
          break;

        case 'iteration-error':
          console.error('Iteration error:', msg.payload);
          handleVariationError(msg.payload.error);
          break;

        default:
          break;
      }
    };

    // Request design system on mount
    parent.postMessage({ pluginMessage: { type: 'get-design-system' } }, '*');
  }, []);

  // Ref to store pending iteration request (waiting for PNG export)
  const pendingIterationRef = React.useRef<{
    prompt: string;
    variations: number;
    designSystem: DesignSystemData;
    frameId: string;
    model: 'claude' | 'gemini';
  } | null>(null);

  // Ref to track current message being generated
  const currentMessageRef = React.useRef<string | null>(null);

  // Scan design system
  const handleScanDesignSystem = () => {
    setIsScanning(true);
    parent.postMessage({ pluginMessage: { type: 'get-design-system' } }, '*');
  };

  // Handle new chat
  const handleNewChat = () => {
    setChat({
      id: generateId(),
      name: 'Blank Chat',
      messages: [],
      createdAt: Date.now(),
    });
    setIsGenerating(false);
    setActiveJobIds([]);
    currentMessageRef.current = null;
  };

  // Handle send message
  const handleSendMessage = async (
    prompt: string,
    numVariations: number,
    model: 'claude' | 'gemini'
  ) => {
    if (!selectedFrameInfo || !designSystem) {
      console.error('No frame selected or design system not loaded');
      return;
    }

    // Lock the frame for this iteration
    const lockedFrameId = selectedFrameInfo.frameId;
    const lockedFrameName = selectedFrameInfo.frameName;

    // Update chat name on first message
    if (chat.messages.length === 0) {
      setChat((prev) => ({
        ...prev,
        name: `Iterating on ${lockedFrameName}`,
        lockedFrameName,
      }));
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    // Add assistant message with iteration data
    const assistantMessageId = generateId();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: `Ok. I'll iterate on this design to create ${numVariations} variation${numVariations > 1 ? 's' : ''} of ${prompt.toLowerCase()}.`,
      timestamp: Date.now(),
      iterationData: {
        frameId: lockedFrameId,
        frameName: lockedFrameName,
        model,
        numVariations,
        status: 'generating-prompts',
        startTime: Date.now(),
        variations: Array.from({ length: numVariations }, (_, i) => ({
          index: i,
          status: 'thinking',
          statusText: 'Thinking of approach',
          isExpanded: false,
        })),
      },
    };

    setChat((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage, assistantMessage],
      currentFrameId: lockedFrameId,
    }));

    currentMessageRef.current = assistantMessageId;
    setIsGenerating(true);

    // Store pending iteration and request PNG export
    pendingIterationRef.current = {
      prompt,
      variations: numVariations,
      designSystem,
      frameId: lockedFrameId,
      model,
    };

    parent.postMessage(
      {
        pluginMessage: {
          type: 'export-frame-png',
          payload: { frameId: lockedFrameId },
        },
      },
      '*'
    );
  };

  // Generate variation prompts using LLM
  const generateVariationPrompts = async (
    masterPrompt: string,
    n: number,
    ds?: DesignSystemData
  ): Promise<string[]> => {
    const systemToUse = ds || designSystem;

    if (!systemToUse) {
      console.warn('No design system available, using fallback variations');
      return Array.from(
        { length: n },
        (_, i) => `${masterPrompt} — Variation ${i + 1}`
      );
    }

    try {
      const response = await fetch('https://crafter-worker.nabilhasan24.workers.dev/api/generate-variation-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: masterPrompt,
          numVariations: n,
          designSystem: systemToUse,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate variation prompts');
      }

      const data = await response.json();
      return data.variationPrompts || [];
    } catch (error) {
      console.error('Error generating variation prompts:', error);
      return Array.from(
        { length: n },
        (_, i) => `${masterPrompt} — Variation ${i + 1}`
      );
    }
  };

  // Start iteration after PNG is exported
  const startIterationWithPNG = async (
    imageData: string,
    iterPrompt: string,
    variations: number,
    ds: DesignSystemData,
    fid: string,
    model: 'claude' | 'gemini'
  ) => {
    try {
      console.log('Starting iteration with exported PNG...');

      // Update status: generating variation prompts
      updateIterationStatus('in-progress');

      // Generate variation prompts
      const variationPrompts = await generateVariationPrompts(iterPrompt, variations, ds);
      console.log('Generated variation prompts:', variationPrompts);

      // Update variations with sub-prompts
      updateVariationsWithPrompts(variationPrompts);

      // Start all iteration variations in parallel
      variationPrompts.forEach(async (varPrompt, index) => {
        try {
          // Update status: designing
          updateVariationStatus(index, 'designing', 'AI is designing');

          const iterationResult = await iterateLayout(imageData, varPrompt, ds, model);
          console.log(`Iteration variation ${index + 1} result received:`, iterationResult);

          // Update status: rendering
          updateVariationStatus(index, 'rendering', 'Creating in Figma');

          // Send to plugin for rendering
          parent.postMessage(
            {
              pluginMessage: {
                type: 'iterate-design-variation',
                payload: {
                  svg: iterationResult.svg,
                  reasoning: iterationResult.reasoning,
                  frameId: fid,
                  variationIndex: index,
                  totalVariations: variations,
                },
              },
            },
            '*'
          );

          // Update status: complete
          updateVariationStatus(index, 'complete', 'Iteration Complete', iterationResult.reasoning);
        } catch (err) {
          console.error(`Error iterating variation ${index + 1}:`, err);
          updateVariationStatus(
            index,
            'error',
            'Error when trying to create the design',
            undefined,
            err instanceof Error ? err.message : 'Unknown error'
          );
        }
      });

      // Check completion after all start
      setTimeout(() => checkAllVariationsComplete(variations), 1000);
    } catch (err) {
      setIsGenerating(false);
      console.error('Iteration error:', err);
    }
  };

  // Update iteration data status
  const updateIterationStatus = (status: IterationData['status']) => {
    const messageId = currentMessageRef.current;
    if (!messageId) return;

    setChat((prev) => ({
      ...prev,
      messages: prev.messages.map((msg) =>
        msg.id === messageId && msg.iterationData
          ? {
              ...msg,
              iterationData: {
                ...msg.iterationData,
                status,
              },
            }
          : msg
      ),
    }));
  };

  // Update variations with generated sub-prompts
  const updateVariationsWithPrompts = (prompts: string[]) => {
    const messageId = currentMessageRef.current;
    if (!messageId) return;

    setChat((prev) => ({
      ...prev,
      messages: prev.messages.map((msg) =>
        msg.id === messageId && msg.iterationData
          ? {
              ...msg,
              iterationData: {
                ...msg.iterationData,
                variations: msg.iterationData.variations.map((v, i) => ({
                  ...v,
                  subPrompt: prompts[i] || '',
                })),
              },
            }
          : msg
      ),
    }));
  };

  // Update individual variation status
  const updateVariationStatus = (
    index: number,
    status: VariationStatus['status'],
    statusText: string,
    reasoning?: string,
    error?: string
  ) => {
    const messageId = currentMessageRef.current;
    if (!messageId) return;

    setChat((prev) => ({
      ...prev,
      messages: prev.messages.map((msg) =>
        msg.id === messageId && msg.iterationData
          ? {
              ...msg,
              iterationData: {
                ...msg.iterationData,
                variations: msg.iterationData.variations.map((v) =>
                  v.index === index
                    ? {
                        ...v,
                        status,
                        statusText,
                        reasoning: reasoning || v.reasoning,
                        error: error || v.error,
                      }
                    : v
                ),
              },
            }
          : msg
      ),
    }));
  };

  // Handle variation error
  const handleVariationError = (errorMessage: string) => {
    // Extract variation index if possible (format: "Variation N failed: ...")
    const match = errorMessage.match(/Variation (\d+) failed/);
    if (match) {
      const index = parseInt(match[1]) - 1;
      updateVariationStatus(index, 'error', 'Error when trying to create the design', undefined, errorMessage);
    }
  };

  // Check if all variations are complete
  const checkAllVariationsComplete = (totalVariations: number) => {
    const messageId = currentMessageRef.current;
    if (!messageId) return;

    setChat((prev) => {
      const message = prev.messages.find((m) => m.id === messageId);
      if (!message || !message.iterationData) return prev;

      const allComplete = message.iterationData.variations.every(
        (v) => v.status === 'complete' || v.status === 'error'
      );

      if (!allComplete) {
        // Check again in 1 second
        setTimeout(() => checkAllVariationsComplete(totalVariations), 1000);
        return prev;
      }

      // All complete - generate summary and finalize
      finalizeIteration(messageId);
      return prev;
    });
  };

  // Finalize iteration (generate summary)
  const finalizeIteration = async (messageId: string) => {
    console.log('Finalizing iteration...');

    // TODO: Generate summary using LLM
    // For now, use a simple summary
    const message = chat.messages.find((m) => m.id === messageId);
    if (!message || !message.iterationData) return;

    const completedCount = message.iterationData.variations.filter(
      (v) => v.status === 'complete'
    ).length;

    const summary = `I've designed ${completedCount} out of ${message.iterationData.numVariations} variations for your design. ${
      completedCount < message.iterationData.numVariations
        ? 'Some variations encountered errors during generation.'
        : 'Here are the differences in the variations:'
    }`;

    setChat((prev) => ({
      ...prev,
      messages: prev.messages.map((msg) =>
        msg.id === messageId && msg.iterationData
          ? {
              ...msg,
              iterationData: {
                ...msg.iterationData,
                status: 'complete',
                endTime: Date.now(),
                summary,
              },
            }
          : msg
      ),
    }));

    setIsGenerating(false);
    currentMessageRef.current = null;
  };

  // Handle stop
  const handleStop = () => {
    console.log('Stopping iteration...');
    // TODO: Cancel pending jobs
    setIsGenerating(false);

    if (currentMessageRef.current) {
      finalizeIteration(currentMessageRef.current);
    }
  };

  // Handle expand variation
  const handleExpandVariation = (messageId: string, variationIndex: number) => {
    setChat((prev) => ({
      ...prev,
      messages: prev.messages.map((msg) =>
        msg.id === messageId && msg.iterationData
          ? {
              ...msg,
              iterationData: {
                ...msg.iterationData,
                variations: msg.iterationData.variations.map((v) =>
                  v.index === variationIndex
                    ? { ...v, isExpanded: !v.isExpanded }
                    : v
                ),
              },
            }
          : msg
      ),
    }));
  };

  // Initial screen (before design system scanned)
  if (!designSystem) {
    return (
      <div className="container">
        <div className="initial-screen">
          <div className="header">
            <h1 className="title">Crafter: Ideate With Your Design System</h1>
            <p className="subtitle">Chat-based AI iteration powered by your design system</p>
          </div>
          <div className="initial-buttons">
            <button
              className="button scan-button"
              onClick={handleScanDesignSystem}
              disabled={isScanning}
            >
              {isScanning && <div className="spinner" />}
              {isScanning ? 'Scanning...' : 'Scan Design System'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main chat interface (after design system scanned)
  return (
    <div className="container">
      <ChatInterface
        chat={chat}
        designSystem={designSystem}
        selectedFrameInfo={selectedFrameInfo}
        isGenerating={isGenerating}
        onSendMessage={handleSendMessage}
        onStop={handleStop}
        onNewChat={handleNewChat}
        onExpandVariation={handleExpandVariation}
      />
    </div>
  );
};

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
