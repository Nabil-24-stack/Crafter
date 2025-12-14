// UI code - Chat-based iteration interface
// Refactored from tab-based to chat-based design

import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import {
  Chat,
  ChatMessage,
  DesignSystemData,
  IterationData,
  Message,
  VariationStatus,
} from './types';
import { ChatInterface } from './components/ChatInterface';
import { generateLayout, iterateLayout } from './claudeService';
import { subscribeToReasoningChunks, unsubscribeFromReasoningChunks } from './supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './ui.css';
// @ts-ignore
import crafterLogo from '../Logo/crafter_logo.png';
// @ts-ignore
import figmaIcon from '../Icons/Figma_icon.svg';
// @ts-ignore
import scanIcon from '../Icons/scan_icon.svg';

// Feature flag: Set to false to disable authentication (while OAuth app is pending approval)
// Set to true when Figma OAuth app is approved
const REQUIRE_AUTHENTICATION = true;

/**
 * Convert SVG string to PNG Uint8Array for Figma
 * Used as fallback when createNodeFromSvg fails
 */
async function convertSvgToPng(svgString: string, width: number = 1440, height: number = 1024): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    // Create image from SVG
    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      // Draw SVG to canvas
      ctx.drawImage(img, 0, 0, width, height);

      // Convert canvas to PNG blob
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error('Failed to convert canvas to blob'));
          return;
        }

        // Convert blob to Uint8Array
        const reader = new FileReader();
        reader.onload = () => {
          const arrayBuffer = reader.result as ArrayBuffer;
          const uint8Array = new Uint8Array(arrayBuffer);
          URL.revokeObjectURL(url);
          resolve(uint8Array);
        };
        reader.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to read PNG blob'));
        };
        reader.readAsArrayBuffer(pngBlob);
      }, 'image/png');
    };

    img.onerror = (error) => {
      URL.revokeObjectURL(url);
      console.error('SVG that failed to render:', svgString.substring(0, 500) + '...');
      reject(new Error('Failed to load SVG as image - SVG is malformed or contains unsupported features'));
    };

    img.src = url;
  });
}

const App = () => {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [authToken, setAuthToken] = React.useState<string | null>(null);
  const [userEmail, setUserEmail] = React.useState<string>('');
  const [showProfileMenu, setShowProfileMenu] = React.useState(false);

  // Design system state
  const [designSystem, setDesignSystem] = React.useState<DesignSystemData | null>(null);
  const [isScanning, setIsScanning] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(false);

  // Chat state
  const [chat, setChat] = React.useState<Chat>({
    id: generateId(),
    name: 'Blank Chat',
    messages: [],
    createdAt: Date.now(),
  });

  // Selected frame state (single or multiple frames)
  const [selectedFrameInfo, setSelectedFrameInfo] = React.useState<{
    frameId: string;
    frameName: string;
    isFlow?: boolean;
    frames?: Array<{ id: string; name: string }>;
  } | null>(null);

  // Generation state
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [activeJobIds, setActiveJobIds] = React.useState<string[]>([]);

  // Realtime channels for reasoning chunk streaming
  const reasoningChannelsRef = React.useRef<Map<string, RealtimeChannel>>(new Map());

  // Generate unique ID
  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Check for stored auth token on mount
  React.useEffect(() => {
    parent.postMessage({ pluginMessage: { type: 'check-auth' } }, '*');
  }, []);

  // Set up message listener on mount
  React.useEffect(() => {
    window.onmessage = (event) => {
      const msg: Message = event.data.pluginMessage;
      if (!msg) return;

      console.log('UI received message:', msg.type);

      switch (msg.type) {
        case 'auth-status':
          if (msg.payload.token) {
            setAuthToken(msg.payload.token);
            setIsAuthenticated(true);
            // Decode token to get user email
            try {
              const decoded = JSON.parse(atob(msg.payload.token));
              // Handle both old format (email) and new format (user.email)
              setUserEmail(decoded.user?.email || decoded.email || '');
            } catch (e) {
              console.error('Failed to decode token:', e);
            }
          }
          break;

        case 'auth-complete':
          setAuthToken(msg.payload.token);
          setIsAuthenticated(true);
          // Decode token to get user email
          try {
            const decoded = JSON.parse(atob(msg.payload.token));
            // Handle both old format (email) and new format (user.email)
            setUserEmail(decoded.user?.email || decoded.email || '');
          } catch (e) {
            console.error('Failed to decode token:', e);
          }
          break;

        case 'design-system-data':
          // Show success screen for 1 second before showing chat
          setShowSuccess(true);
          setTimeout(() => {
            setDesignSystem(msg.payload);
            setIsScanning(false);
            setShowSuccess(false);
          }, 1000);
          console.log('Design system received:', {
            components: msg.payload?.components?.length,
            colors: msg.payload?.colors?.length,
            textStyles: msg.payload?.textStyles?.length,
          });
          break;

        case 'selected-frame-data':
          console.log('Single frame payload received:', JSON.stringify(msg.payload));
          if (msg.payload.frameId && msg.payload.frameName) {
            setSelectedFrameInfo({
              frameId: msg.payload.frameId,
              frameName: msg.payload.frameName,
              isFlow: false,
            });
            console.log('Frame selected:', msg.payload.frameName);
          } else {
            setSelectedFrameInfo(null);
            console.log('No frame selected - payload:', JSON.stringify(msg.payload));
          }
          break;

        case 'selected-frames-data':
          console.log('Multiple frames payload received:', JSON.stringify(msg.payload));
          if (msg.payload.frames && msg.payload.frames.length > 0) {
            setSelectedFrameInfo({
              frameId: msg.payload.frames[0].id, // Use first frame ID as primary
              frameName: msg.payload.flowName || `${msg.payload.frames[0].name} flow`,
              isFlow: true,
              frames: msg.payload.frames,
            });
            console.log('Flow selected:', msg.payload.flowName, 'with', msg.payload.frames.length, 'frames');
          } else {
            setSelectedFrameInfo(null);
            console.log('No frames selected');
          }
          break;

        case 'frame-png-exported':
          if (msg.payload.imageData) {
            // Start iteration with the exported PNG and structural hints
            const pending = pendingIterationRef.current;
            if (pending) {
              startIterationWithPNG(
                msg.payload.imageData,
                msg.payload.structuralHints,
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

        case 'multiple-frames-png-exported':
          if (msg.payload.frames && msg.payload.frames.length > 0) {
            // Start flow iteration with multiple exported PNGs
            const pending = pendingIterationRef.current;
            if (pending) {
              startFlowIterationWithPNGs(
                msg.payload.frames,
                msg.payload.flowName,
                pending.prompt,
                pending.variations,
                pending.designSystem,
                pending.model
              );
              pendingIterationRef.current = null;
            }
          }
          break;

        case 'variation-status-update':
          if (msg.payload.variationIndex !== undefined) {
            updateVariationStatus(
              msg.payload.variationIndex,
              msg.payload.status,
              msg.payload.statusText,
              msg.payload.reasoning,
              msg.payload.error
            );
          }
          break;

        case 'all-variations-complete':
          console.log('All variations complete:', msg.payload);
          console.log('Current message ref:', currentMessageRef.current);
          if (currentMessageRef.current) {
            finalizeIteration(currentMessageRef.current);
          } else {
            console.error('No current message ref found');
          }
          break;

        case 'iteration-complete':
          console.log('Iteration complete:', msg.payload);
          break;

        case 'iteration-error':
          console.error('Iteration error:', msg.payload);
          handleVariationError(msg.payload.error);
          break;

        case 'generation-error':
          console.error('Generation error:', msg.payload);
          // Extract variation index from error message or payload
          if (msg.payload.variationIndex !== undefined) {
            updateVariationStatus(
              msg.payload.variationIndex,
              'error',
              'Failed to create design',
              undefined,
              msg.payload.error
            );
          } else {
            // Try to parse from error message
            handleVariationError(msg.payload.error);
          }
          break;

        case 'iteration-mvp-complete':
          // Handle MVP iteration completion
          console.log('MVP iteration complete:', msg.payload);
          if (msg.payload.success) {
            const { variationIndex, reasoning } = msg.payload;
            updateVariationStatus(variationIndex, 'complete', 'Iteration Complete', reasoning);
          } else {
            const { variationIndex, error } = msg.payload;
            updateVariationStatus(variationIndex, 'error', 'Error', undefined, error);
          }
          break;

        case 'mvp-call-railway':
          // Plugin is requesting UI to call Railway (plugin can't make HTTP requests)
          // DEPRECATED: Old HTML/CSS pipeline
          (async () => {
            try {
              const { frameSnapshot, designPalette, imagePNG, instructions, model, variationIndex } = msg.payload;
              console.log(`UI calling Railway for variation ${variationIndex}...`);

              const response = await fetch('https://crafter-production-6da6.up.railway.app/api/iterate-mvp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  frameSnapshot,
                  designPalette,
                  imagePNG,
                  instructions,
                  model,
                }),
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Railway error ${response.status}: ${errorText}`);
              }

              const result = await response.json();
              console.log(`✅ Railway responded for variation ${variationIndex}`);

              // Send result back to plugin
              parent.postMessage({
                pluginMessage: {
                  type: 'mvp-railway-response',
                  payload: {
                    variationIndex,
                    result,
                  },
                },
              }, '*');
            } catch (error) {
              console.error('Railway call failed:', error);
              // Send error back to plugin
              parent.postMessage({
                pluginMessage: {
                  type: 'mvp-railway-response',
                  payload: {
                    variationIndex: msg.payload.variationIndex,
                    error: error instanceof Error ? error.message : 'Unknown error',
                  },
                },
              }, '*');
            }
          })();
          break;

        case 'mvp-call-railway-json':
          // NEW: Direct Figma JSON generation pipeline
          (async () => {
            try {
              const { extractedStyle, imagePNG, instructions, model, variationIndex, previousErrors, attemptNumber } = msg.payload;
              console.log(`UI calling Railway for Figma JSON (attempt ${attemptNumber}) variation ${variationIndex}...`);

              const response = await fetch('https://crafter-production-6da6.up.railway.app/api/iterate-figma-json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  extractedStyle,
                  imagePNG,
                  instructions,
                  model,
                  previousErrors,
                }),
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Railway error ${response.status}: ${errorText}`);
              }

              const result = await response.json();
              console.log(`✅ Railway responded with Figma JSON for variation ${variationIndex}`);

              // Send result back to plugin
              parent.postMessage({
                pluginMessage: {
                  type: 'mvp-railway-response',
                  payload: {
                    variationIndex,
                    result,
                  },
                },
              }, '*');
            } catch (error) {
              console.error('Railway call failed:', error);
              // Send error back to plugin
              parent.postMessage({
                pluginMessage: {
                  type: 'mvp-railway-response',
                  payload: {
                    variationIndex: msg.payload.variationIndex,
                    error: error instanceof Error ? error.message : 'Unknown error',
                  },
                },
              }, '*');
            }
          })();
          break;

        case 'convert-svg-to-png':
          // Handle SVG-to-PNG conversion request (fallback when createNodeFromSvg fails)
          (async () => {
            try {
              const { svg, variationIndex, frameId } = msg.payload;
              const pngBytes = await convertSvgToPng(svg);

              // Send PNG bytes back to plugin
              parent.postMessage({
                pluginMessage: {
                  type: 'svg-converted-to-png',
                  payload: {
                    pngBytes: Array.from(pngBytes), // Convert Uint8Array to regular array for postMessage
                    variationIndex,
                    frameId,
                  }
                }
              }, '*');
            } catch (error) {
              console.error('Failed to convert SVG to PNG:', error);
              // Notify plugin of conversion failure
              parent.postMessage({
                pluginMessage: {
                  type: 'svg-conversion-failed',
                  payload: {
                    variationIndex: msg.payload.variationIndex,
                    error: error instanceof Error ? error.message : 'Unknown error'
                  }
                }
              }, '*');
            }
          })();
          break;

        default:
          break;
      }
    };

    // Request selected frame info on mount (but don't auto-scan design system)
    parent.postMessage({ pluginMessage: { type: 'get-selected-frame' } }, '*');
  }, []);

  // Note: Realtime subscription cleanup removed - MVP doesn't use Supabase job queue
  React.useEffect(() => {
    return () => {
      console.log('Component unmounting...');
    };
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

  // Handle Figma login with Supabase Auth
  const handleGoogleLogin = () => {
    // Generate random state for security
    const state = Math.random().toString(36).substring(7);

    // Open OAuth popup with Supabase Auth
    const authUrl = `https://crafter-ai-kappa.vercel.app/api/auth?action=figma&state=${state}`;
    window.open(authUrl, '_blank', 'width=600,height=700');

    // Start polling for auth completion
    let pollCount = 0;
    const maxPolls = 60; // Poll for max 2 minutes (60 * 2 seconds)

    const pollInterval = setInterval(async () => {
      pollCount++;

      if (pollCount > maxPolls) {
        console.log('Polling timeout - authentication may have failed');
        clearInterval(pollInterval);
        return;
      }

      try {
        const response = await fetch(
          `https://crafter-ai-kappa.vercel.app/api/auth?action=poll&state=${state}`
        );

        if (response.ok) {
          const data = await response.json();

          if (data.access_token) {
            console.log('Tokens received from polling, storing in plugin');
            clearInterval(pollInterval);

            // Create session token with Supabase tokens
            const sessionToken = btoa(JSON.stringify({
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              user: data.user
            }));

            // Store token in plugin
            parent.postMessage({
              pluginMessage: {
                type: 'store-auth-token',
                payload: { token: sessionToken }
              }
            }, '*');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 2000); // Poll every 2 seconds
  };

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

  // Handle logout
  const handleLogout = () => {
    parent.postMessage({ pluginMessage: { type: 'logout' } }, '*');
    setIsAuthenticated(false);
    setAuthToken(null);
    setUserEmail('');
    // Clear design system on logout to force re-authentication
    setDesignSystem(null);
    // Reset chat
    setChat({
      id: generateId(),
      name: 'Blank Chat',
      messages: [],
      createdAt: Date.now(),
    });
  };

  // Analyze variation needs
  const analyzeVariationNeeds = async (
    prompt: string,
    model: 'claude' | 'gemini'
  ): Promise<{ variationCount: number; rationale: string; categories: string[] }> => {
    if (!designSystem) {
      console.warn('No design system available, using default variation count');
      return { variationCount: 3, rationale: 'Using default count', categories: ['design alternatives'] };
    }

    try {
      const response = await fetch('https://crafter-ai-kappa.vercel.app/api/analyze-variation-needs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          designSystem,
          frameContext: selectedFrameInfo ? {
            name: selectedFrameInfo.frameName,
            type: 'FRAME',
          } : undefined,
          model,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze variation needs');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error analyzing variation needs:', error);
      // Fallback to reasonable default
      return { variationCount: 3, rationale: 'Using default count due to error', categories: ['design alternatives'] };
    }
  };

  // Handle send message
  const handleSendMessage = async (
    prompt: string,
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

    // Add user message immediately
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    setChat((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      currentFrameId: lockedFrameId,
    }));

    setIsGenerating(true);

    // Wait 1 second before showing AI response
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Add assistant message with "analyzing" status
    const assistantMessageId = generateId();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: `Analyzing your request...`,
      timestamp: Date.now(),
      iterationData: {
        frameId: lockedFrameId,
        frameName: lockedFrameName,
        model,
        status: 'analyzing',
        startTime: Date.now(),
        variations: [],
      },
    };

    setChat((prev) => ({
      ...prev,
      messages: [...prev.messages, assistantMessage],
    }));

    currentMessageRef.current = assistantMessageId;

    // Analyze how many variations are needed
    const analysis = await analyzeVariationNeeds(prompt, model);
    const numVariations = analysis.variationCount;

    // Update message with analysis results
    setChat((prev) => ({
      ...prev,
      messages: prev.messages.map((msg) =>
        msg.id === assistantMessageId && msg.iterationData
          ? {
              ...msg,
              content: `Generating ${numVariations} variation${numVariations > 1 ? 's' : ''} of ${prompt.toLowerCase()}...`,
              iterationData: {
                ...msg.iterationData,
                status: 'generating',
                numVariations,
                analysisRationale: analysis.rationale,
                variationCategories: analysis.categories,
              },
            }
          : msg
      ),
    }));

    // Small delay before showing variation cards
    await new Promise(resolve => setTimeout(resolve, 500));

    // Add variation cards with staggered animation
    // Show cards 1 second apart
    for (let i = 0; i < numVariations; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      setChat((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) =>
          msg.id === assistantMessageId && msg.iterationData
            ? {
                ...msg,
                iterationData: {
                  ...msg.iterationData,
                  variations: [
                    ...msg.iterationData.variations,
                    {
                      index: i,
                      status: 'thinking',
                      statusText: 'Thinking of approach',
                      isExpanded: false,
                    },
                  ],
                },
              }
            : msg
        ),
      }));
    }

    // Store pending iteration and request PNG export
    pendingIterationRef.current = {
      prompt,
      variations: numVariations,  // Now uses the analyzed count
      designSystem,
      frameId: lockedFrameId,
      model,
    };

    // Check if this is a flow (multiple frames) or single frame
    if (selectedFrameInfo.isFlow && selectedFrameInfo.frames) {
      // Export multiple frames for flow iteration
      parent.postMessage(
        {
          pluginMessage: {
            type: 'export-multiple-frames-png',
            payload: { frameIds: selectedFrameInfo.frames.map(f => f.id) },
          },
        },
        '*'
      );
    } else {
      // Export single frame
      parent.postMessage(
        {
          pluginMessage: {
            type: 'export-frame-png',
            payload: { frameId: lockedFrameId },
          },
        },
        '*'
      );
    }
  };

  // Generate variation prompts using LLM
  const generateVariationPrompts = async (
    masterPrompt: string,
    n: number,
    ds?: DesignSystemData,
    model?: 'claude' | 'gemini'
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
      const response = await fetch('https://crafter-ai-kappa.vercel.app/api/generate-variation-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: masterPrompt,
          numVariations: n,
          designSystem: systemToUse,
          model: model || 'claude', // Pass selected model to use same LLM for variations
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

  // Build chat history context for multi-iteration chats
  const buildChatHistory = (): string => {
    if (chat.messages.length <= 2) {
      // First iteration, no history
      return '';
    }

    // Build context from previous iterations (excluding current message)
    let context = 'Previous iterations in this conversation:\n\n';

    // Get all messages except the last two (current user message and assistant response)
    const previousMessages = chat.messages.slice(0, -2);

    for (let i = 0; i < previousMessages.length; i += 2) {
      const userMsg = previousMessages[i];
      const assistantMsg = previousMessages[i + 1];

      if (!userMsg || !assistantMsg) continue;

      context += `Iteration ${Math.floor(i / 2) + 1}:\n`;
      context += `User request: "${userMsg.content}"\n`;

      if (assistantMsg.iterationData?.summary) {
        context += `Result: ${assistantMsg.iterationData.summary}\n`;
      }

      context += '\n';
    }

    return context;
  };

  // Start iteration after PNG is exported
  const startIterationWithPNG = async (
    imageData: string,
    structuralHints: any,
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

      // Generate variation prompts using the same model selected for generation
      const variationPrompts = await generateVariationPrompts(iterPrompt, variations, ds, model);
      console.log('Generated variation prompts:', variationPrompts);

      // Build chat history for context
      const chatHistory = buildChatHistory();

      // Start all iteration variations using the pure SVG pipeline
      const variationPromises = variationPrompts.map(async (varPrompt, index) => {
        try {
          // Update status: designing
          updateVariationStatus(index, 'designing', 'AI is designing');

          console.log(`Starting pure SVG generation for variation ${index + 1}`);

          // Use claudeService to generate SVG through Vercel/Supabase/Railway pipeline
          const result = await iterateLayout(
            imageData,
            structuralHints,
            varPrompt,
            ds,
            model,
            chatHistory,
            (jobId) => {
              // Callback when job starts - subscribe to live reasoning chunks
              console.log(`Job ${jobId} started for variation ${index + 1}`);
              updateVariationStatus(index, 'designing', 'AI is thinking...', undefined);

              // Subscribe to reasoning chunks for live streaming
              const reasoningChannel = subscribeToReasoningChunks(
                jobId,
                (chunk) => {
                  // Update the variation with the new reasoning chunk
                  console.log(`Received reasoning chunk ${chunk.chunk_index}: ${chunk.chunk_text}`);
                  updateStreamingReasoning(index, chunk.chunk_text, true);
                },
                (error) => {
                  console.error(`Reasoning subscription error for job ${jobId}:`, error);
                }
              );

              // Store the channel so we can unsubscribe later
              reasoningChannelsRef.current.set(jobId, reasoningChannel);
            }
          );

          // Send SVG to plugin for rendering
          if (result.svg) {
            parent.postMessage(
              {
                pluginMessage: {
                  type: 'generate-single-variation',
                  payload: {
                    variation: {
                      svg: result.svg,
                      reasoning: result.reasoning,
                    },
                    variationIndex: index,
                    totalVariations: variations,
                    frameId: fid, // Pass the original frame ID for positioning
                  },
                },
              },
              '*'
            );

            // Update status: complete and stop live streaming indicator
            updateStreamingReasoning(index, '', false); // Stop the live indicator
            updateVariationStatus(
              index,
              'complete',
              'Iteration Complete',
              result.reasoning || 'SVG design generated successfully'
            );

            // Unsubscribe from reasoning chunks
            if (result.job_id && reasoningChannelsRef.current.has(result.job_id)) {
              const channel = reasoningChannelsRef.current.get(result.job_id);
              if (channel) {
                await unsubscribeFromReasoningChunks(channel);
                reasoningChannelsRef.current.delete(result.job_id);
              }
            }
          } else {
            throw new Error('No SVG returned from generation');
          }
        } catch (err) {
          console.error(`Error iterating variation ${index + 1}:`, err);

          // Stop the live streaming indicator on error
          updateStreamingReasoning(index, '', false);

          updateVariationStatus(
            index,
            'error',
            'Error when trying to create the design',
            undefined,
            err instanceof Error ? err.message : 'Unknown error'
          );

          // Clean up subscription on error (if result was partially available)
          // Note: We don't have result.job_id here in catch block, channels will be cleaned up on component unmount
        }
      });

      // Wait for all variations to complete (or fail)
      await Promise.allSettled(variationPromises);
      console.log('✅ All variation jobs completed');

      // Check completion after all finish
      checkAllVariationsComplete(variations);
    } catch (err) {
      setIsGenerating(false);
      console.error('Iteration error:', err);
    }
  };

  // Start flow iteration after multiple PNGs are exported
  const startFlowIterationWithPNGs = async (
    frames: Array<{
      frameId: string;
      frameName: string;
      imageData: string;
      structuralHints: any;
    }>,
    flowName: string,
    iterPrompt: string,
    variations: number,
    ds: DesignSystemData,
    model: 'claude' | 'gemini'
  ) => {
    try {
      console.log('Starting flow iteration with', frames.length, 'frames...');

      // Update status: analyzing flow
      updateIterationStatus('in-progress');

      // Analyze flow needs using the new API endpoint
      const flowAnalysis = await analyzeFlowNeeds(frames, flowName, iterPrompt, ds, model);
      console.log('Flow analysis:', flowAnalysis);

      // For now, use the same variation generation as single frame
      // In the next phase, we'll implement flow-specific variation logic in worker.mjs
      const variationPrompts = await generateVariationPrompts(iterPrompt, variations, ds, model);
      console.log('Generated flow variation prompts:', variationPrompts);

      // Build chat history for context
      const chatHistory = buildChatHistory();

      // Start flow variation generation
      // TODO: Implement flow-specific generation logic that considers all frames
      // For now, we'll iterate on the first frame as a placeholder
      const primaryFrame = frames[0];

      // Start all iteration variations using the pure SVG pipeline
      const variationPromises = variationPrompts.map(async (varPrompt, index) => {
        try {
          // Update status: designing
          updateVariationStatus(index, 'designing', 'AI is designing flow improvements');

          console.log(`Starting flow variation ${index + 1}`);

          // Use iterateLayout for flow iterations
          const result = await iterateLayout(
            primaryFrame.imageData,
            primaryFrame.structuralHints,
            varPrompt,
            ds,
            model,
            chatHistory,
            (jobId) => {
              // Callback when job starts - subscribe to live reasoning chunks
              console.log(`Flow job ${jobId} started for variation ${index + 1}`);
              updateVariationStatus(index, 'designing', 'AI is thinking about flow improvements...', undefined);

              // Subscribe to reasoning chunks for live streaming
              const reasoningChannel = subscribeToReasoningChunks(
                jobId,
                (chunk) => {
                  console.log(`Flow reasoning chunk ${chunk.chunk_index}: ${chunk.chunk_text}`);
                  updateStreamingReasoning(index, chunk.chunk_text, true);
                },
                (error) => {
                  console.error(`Flow reasoning subscription error for job ${jobId}:`, error);
                }
              );

              // Store the channel so we can unsubscribe later
              reasoningChannelsRef.current.set(jobId, reasoningChannel);
            }
          );

          // Send SVG to plugin for rendering
          if (result.svg) {
            console.log(`Flow variation ${index + 1} generated successfully`);

            parent.postMessage(
              {
                pluginMessage: {
                  type: 'generate-single-variation',
                  payload: {
                    variation: {
                      svg: result.svg,
                      reasoning: result.reasoning,
                    },
                    variationIndex: index,
                    totalVariations: variations,
                    frameId: primaryFrame.frameId,
                    isFlowVariation: true,
                  },
                },
              },
              '*'
            );

            // Update status: complete and stop live streaming indicator
            updateStreamingReasoning(index, '', false);
            updateVariationStatus(
              index,
              'complete',
              'Flow Iteration Complete',
              result.reasoning || 'Flow improvements generated successfully'
            );

            // Unsubscribe from reasoning chunks
            if (result.job_id && reasoningChannelsRef.current.has(result.job_id)) {
              const channel = reasoningChannelsRef.current.get(result.job_id);
              if (channel) {
                await unsubscribeFromReasoningChunks(channel);
                reasoningChannelsRef.current.delete(result.job_id);
              }
            }
          } else {
            throw new Error('No SVG returned from flow generation');
          }
        } catch (err) {
          console.error(`Error in flow variation ${index + 1}:`, err);

          // Stop the live streaming indicator on error
          updateStreamingReasoning(index, '', false);

          updateVariationStatus(
            index,
            'error',
            'Error creating flow design',
            undefined,
            err instanceof Error ? err.message : 'Unknown error'
          );
        }
      });

      // Wait for all variations to complete
      await Promise.allSettled(variationPromises);
      console.log('✅ All flow variations completed');

      checkAllVariationsComplete(variations);
    } catch (err) {
      setIsGenerating(false);
      console.error('Flow iteration error:', err);
    }
  };

  // Analyze flow needs using the new API endpoint
  const analyzeFlowNeeds = async (
    frames: Array<{
      frameId: string;
      frameName: string;
      imageData: string;
      structuralHints: any;
    }>,
    flowName: string,
    prompt: string,
    ds: DesignSystemData,
    model: 'claude' | 'gemini'
  ) => {
    try {
      const response = await fetch('https://crafter-ai-kappa.vercel.app/api/analyze-flow-needs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          frames,
          flowName,
          designSystem: ds,
          model,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze flow needs');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error analyzing flow needs:', error);
      // Return default flow analysis
      return {
        variationCount: 3,
        rationale: 'Creating 3 flow variations to explore different approaches',
        flowImprovements: ['Improve consistency', 'Optimize navigation', 'Add transitions'],
        frameSpecificNeeds: [],
      };
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

  // Update streaming reasoning for a variation
  const updateStreamingReasoning = (index: number, chunk: string, isLive: boolean) => {
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
                        // Keep accumulated text, just update live indicator
                        streamingReasoning: chunk ? (v.streamingReasoning || '') + chunk : v.streamingReasoning,
                        isStreamingLive: isLive,
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
        (v) => v.status === 'complete' || v.status === 'error' || v.status === 'stopped'
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
  const finalizeIteration = React.useCallback(async (messageId: string) => {
    console.log('Finalizing iteration...', 'Looking for message ID:', messageId);

    // Get the current chat state synchronously
    let currentMessage: ChatMessage | undefined;
    let currentUserPrompt = '';

    // Use a promise to ensure we get the updated state
    await new Promise<void>((resolve) => {
      setChat((prev) => {
        const messageIds = prev.messages.map(m => ({ id: m.id, role: m.role, hasIterationData: !!m.iterationData }));
        console.log('All messages in chat:', JSON.stringify(messageIds, null, 2));
        console.log('Looking for message ID:', messageId);
        currentMessage = prev.messages.find((m) => m.id === messageId);
        console.log('Found message:', !!currentMessage, 'Message ID matches:', currentMessage?.id === messageId);
        currentUserPrompt = prev.messages.find(m => m.role === 'user')?.content || '';
        resolve();
        return prev;
      });
    });

    if (!currentMessage || !currentMessage.iterationData) {
      console.error('Message not found for finalization. MessageId:', messageId);
      console.error('Message found:', !!currentMessage, 'Has iterationData:', !!currentMessage?.iterationData);
      return;
    }

    const message = currentMessage;
    const userPrompt = currentUserPrompt;

    console.log('Message found, generating summary...');

    // Prepare variation results for summary generation
    const iterationData = message.iterationData!; // We already checked it exists
    const variationResults = iterationData.variations.map((v) => ({
      index: v.index,
      status: v.status,
      subPrompt: v.subPrompt,
      reasoning: v.reasoning,
      error: v.error,
    }));

    // Get the model that was used for generation
    const selectedModel = iterationData.model || 'claude';

    let summary = '';

    try {
      // Generate summary using the same model that generated the variations
      console.log(`Calling summary API with ${selectedModel}...`);
      const response = await fetch('https://crafter-ai-kappa.vercel.app/api/generate-iteration-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterPrompt: userPrompt,
          variations: variationResults,
          model: selectedModel, // Pass the model to the summary API
        }),
      });

      if (response.ok) {
        const data = await response.json();
        summary = data.summary || '';
        console.log('Summary generated:', summary);
      } else {
        console.error('Failed to generate summary:', response.status, await response.text());
      }
    } catch (error) {
      console.error('Error generating summary:', error);
    }

    // Fallback summary if LLM fails
    if (!summary) {
      console.log('Using fallback summary');
      const completedCount = iterationData.variations.filter(
        (v) => v.status === 'complete'
      ).length;

      const totalVariations = iterationData.numVariations || iterationData.variations.length;
      summary = `I've designed ${completedCount} out of ${totalVariations} variations for your design. ${
        completedCount < totalVariations
          ? 'Some variations encountered errors during generation.'
          : 'Here are the differences in the variations:'
      }`;
    }

    console.log('Setting summary in state...');
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
                // Auto-collapse all variation cards when complete
                variations: msg.iterationData.variations.map((v) => ({
                  ...v,
                  isExpanded: false,
                })),
              },
            }
          : msg
      ),
    }));

    setIsGenerating(false);
    currentMessageRef.current = null;
    console.log('Finalization complete');
  }, []);

  // Handle stop
  const handleStop = async () => {
    console.log('Stopping iteration...');
    setIsGenerating(false);

    // Note: Job cancellation removed - MVP uses direct Railway calls (no job queue)
    console.log('Stop requested - MVP iterations will complete but new ones will not start');

    // Update all in-progress variations to 'stopped' status
    if (currentMessageRef.current) {
      const messageId = currentMessageRef.current;
      setChat((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) =>
          msg.id === messageId && msg.iterationData
            ? {
                ...msg,
                iterationData: {
                  ...msg.iterationData,
                  status: 'stopped',
                  endTime: Date.now(),
                  wasStopped: true,
                  variations: msg.iterationData.variations.map((v) =>
                    v.status === 'thinking' || v.status === 'designing' || v.status === 'rendering'
                      ? {
                          ...v,
                          status: 'stopped' as const,
                          statusText: 'Stopped',
                          isStreamingLive: false,
                        }
                      : v
                  ),
                },
              }
            : msg
        ),
      }));

      // Generate summary for stopped iteration
      finalizeIteration(messageId);
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

  // No longer blocking on authentication - users can scan without login

  // Initial screen (before design system scanned)
  if (!designSystem) {
    // Success screen - show for 1 second after scanning completes
    if (showSuccess) {
      return (
        <div className="container">
          <div className="initial-screen">
            <div className="success-icon">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <circle cx="40" cy="40" r="40" fill="#22C55E"/>
                <path d="M25 40L35 50L55 30" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="scanning-title">Scanning complete!</h2>
          </div>
        </div>
      );
    }

    // Scanning screen - show simple loading message
    if (isScanning) {
      return (
        <div className="container">
          <div className="initial-screen">
            <div className="welcome-content">
              <h2 className="scanning-title">Scanning components...</h2>
              <p className="welcome-subtitle">You won't be able to move in this file briefly as scanning takes place. This will take a moment.</p>
            </div>
          </div>
        </div>
      );
    }

    // Authentication screen - show first if user is not authenticated
    if (REQUIRE_AUTHENTICATION && !isAuthenticated) {
      return (
        <div className="container">
          <div className="initial-screen">
            <div className="welcome-logo">
              <img src={crafterLogo} alt="Crafter" className="logo-image" />
            </div>
            <div className="welcome-content">
              <h1 className="welcome-title">Vibe design ideas in seconds</h1>
              <p className="welcome-subtitle">Generate UI designs with your design system</p>
            </div>
            <div className="initial-buttons">
              <button
                className="button scan-button"
                onClick={handleGoogleLogin}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              >
                <img src={figmaIcon} alt="" style={{ width: '24px', height: '24px' }} />
                Continue with Figma
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Design system scan screen - show after authentication
    return (
      <div className="container">
        <div className="initial-screen">
          <div className="welcome-icon">
            <img src={scanIcon} alt="" style={{ width: '64px', height: '64px' }} />
          </div>
          <div className="welcome-content">
            <h1 className="welcome-title">Scan your design system so I can use it to generate on-brand designs.</h1>
            <p className="welcome-subtitle">This may take time depending on how large you file is.</p>
          </div>
          <div className="initial-buttons">
            <button
              className="button scan-button"
              onClick={handleScanDesignSystem}
            >
              Start Scan
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
        isAuthenticated={REQUIRE_AUTHENTICATION ? isAuthenticated : true}
        onSendMessage={handleSendMessage}
        onStop={handleStop}
        onNewChat={handleNewChat}
        onExpandVariation={handleExpandVariation}
        onLogin={handleGoogleLogin}
        userEmail={userEmail}
        onLogout={handleLogout}
      />
    </div>
  );
};

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
