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
import { subscribeToReasoningChunks, unsubscribeFromReasoningChunks } from './supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './ui.css';
// @ts-ignore
import crafterLogo from '../Logo/crafter_logo.png';

const App = () => {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [authToken, setAuthToken] = React.useState<string | null>(null);

  // Design system state
  const [designSystem, setDesignSystem] = React.useState<DesignSystemData | null>(null);
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanningStatus, setScanningStatus] = React.useState<string>('');
  const [showSuccess, setShowSuccess] = React.useState(false);

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
  const activeJobIdsRef = React.useRef<Set<string>>(new Set());

  // Realtime subscription channels (keyed by job_id)
  const realtimeChannelsRef = React.useRef<Map<string, RealtimeChannel>>(new Map());

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
          }
          break;

        case 'auth-complete':
          setAuthToken(msg.payload.token);
          setIsAuthenticated(true);
          break;

        case 'design-system-scan-progress':
          setScanningStatus(msg.payload.status);
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
          console.log('Payload received:', JSON.stringify(msg.payload));
          if (msg.payload.frameId && msg.payload.frameName) {
            setSelectedFrameInfo({
              frameId: msg.payload.frameId,
              frameName: msg.payload.frameName,
            });
            console.log('Frame selected:', msg.payload.frameName);
          } else {
            setSelectedFrameInfo(null);
            console.log('No frame selected - payload:', JSON.stringify(msg.payload));
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

        default:
          break;
      }
    };

    // Request selected frame info on mount (but don't auto-scan design system)
    parent.postMessage({ pluginMessage: { type: 'get-selected-frame' } }, '*');
  }, []);

  // Cleanup realtime subscriptions on unmount
  React.useEffect(() => {
    return () => {
      console.log('Cleaning up all realtime subscriptions...');
      realtimeChannelsRef.current.forEach(async (channel, jobId) => {
        await unsubscribeFromReasoningChunks(channel);
        console.log(`Unsubscribed from job ${jobId}`);
      });
      realtimeChannelsRef.current.clear();
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

  // Handle Google login
  const handleGoogleLogin = () => {
    parent.postMessage({ pluginMessage: { type: 'start-oauth' } }, '*');
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
        variations: [], // Start with empty variations, we'll add them with stagger
      },
    };

    setChat((prev) => ({
      ...prev,
      messages: [...prev.messages, assistantMessage],
    }));

    currentMessageRef.current = assistantMessageId;

    // Add variation cards with staggered animation
    // Wait 1 second after AI message, then show cards 1 second apart
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
      const response = await fetch('https://crafter-ai-kappa.vercel.app/api/generate-variation-prompts', {
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

      // Update variations with sub-prompts (commented out - we show reasoning instead)
      // updateVariationsWithPrompts(variationPrompts);

      // Build chat history for context
      const chatHistory = buildChatHistory();

      // Start all iteration variations in TRUE PARALLEL
      // Use Promise.all() to ensure all jobs start simultaneously
      const variationPromises = variationPrompts.map(async (varPrompt, index) => {
        try {
          // Update status: designing
          updateVariationStatus(index, 'designing', 'AI is designing');

          const iterationResult = await iterateLayout(
            imageData,
            varPrompt,
            ds,
            model,
            chatHistory,
            // Subscribe immediately when job starts (before polling completes)
            (jobId) => {
              console.log(`Job started for variation ${index + 1}: ${jobId}`);
              console.log(`Subscribing to reasoning chunks for job ${jobId}`);

              // Track this job ID for potential cancellation
              activeJobIdsRef.current.add(jobId);

              const channel = subscribeToReasoningChunks(
                jobId,
                (chunk) => {
                  console.log(`Received chunk ${chunk.chunk_index} for variation ${index + 1}`);
                  updateStreamingReasoning(index, chunk.chunk_text, true);
                },
                (error) => {
                  console.error(`Realtime subscription error for variation ${index + 1}:`, error);
                }
              );

              // Store channel for cleanup
              realtimeChannelsRef.current.set(jobId, channel);
            }
          );
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

          // Update status: complete (with final reasoning, keeping streaming content)
          updateVariationStatus(index, 'complete', 'Iteration Complete', iterationResult.reasoning);

          // Stop streaming indicator and cleanup subscription after a brief delay
          // This gives users time to see the complete reasoning
          setTimeout(() => {
            if (iterationResult.job_id) {
              updateStreamingReasoning(index, '', false); // Turn off live indicator (keeps text)
              const channel = realtimeChannelsRef.current.get(iterationResult.job_id);
              if (channel) {
                unsubscribeFromReasoningChunks(channel);
                realtimeChannelsRef.current.delete(iterationResult.job_id);
              }
            }
          }, 2000); // 2 second delay to show complete streaming
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

      // Wait for all variations to complete (or fail)
      // This ensures true parallel execution
      await Promise.allSettled(variationPromises);
      console.log('✅ All variation jobs completed');

      // Check completion after all finish
      checkAllVariationsComplete(variations);
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

    let summary = '';

    try {
      // Generate summary using LLM
      console.log('Calling summary API...');
      const response = await fetch('https://crafter-ai-kappa.vercel.app/api/generate-iteration-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterPrompt: userPrompt,
          variations: variationResults,
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

      summary = `I've designed ${completedCount} out of ${iterationData.numVariations} variations for your design. ${
        completedCount < iterationData.numVariations
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

    // Cancel all active jobs in Supabase
    const jobsToCancel = Array.from(activeJobIdsRef.current);
    console.log(`Cancelling ${jobsToCancel.length} active jobs:`, jobsToCancel);

    for (const jobId of jobsToCancel) {
      try {
        await fetch('https://crafter-ai-kappa.vercel.app/api/cancel-job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId }),
        });
        console.log(`Cancelled job ${jobId}`);
      } catch (error) {
        console.error(`Failed to cancel job ${jobId}:`, error);
      }
    }
    activeJobIdsRef.current.clear();

    // Unsubscribe from all active realtime channels
    realtimeChannelsRef.current.forEach((channel) => {
      unsubscribeFromReasoningChunks(channel);
    });
    realtimeChannelsRef.current.clear();

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

  // Login screen (before authentication)
  if (!isAuthenticated) {
    return (
      <div className="container">
        <div className="login-container">
          <div className="login-header">
            <h2 className="login-heading">Log in/Create account</h2>
            <button className="google-login-button" onClick={handleGoogleLogin}>
              Continue with Figma
            </button>
          </div>
          <div className="login-content">
            <div className="welcome-logo">
              <img src={crafterLogo} alt="Crafter" className="logo-image" />
            </div>
            <div className="welcome-text">
              <h1 className="welcome-title">Ideate UI concepts at speed - all using your design system</h1>
              <p className="welcome-subtitle">Let's scan your design system so I can use it to generate on-brand designs.</p>
            </div>
            <div className="login-action">
              <button className="button scan-button-disabled" disabled>
                Start Scan
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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

    // Scanning screen - show progress messages
    if (isScanning) {
      return (
        <div className="container">
          <div className="initial-screen">
            <div className="loading-spinner">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="28" stroke="#E5E7EB" strokeWidth="8"/>
                <circle cx="32" cy="32" r="28" stroke="#36E4D8" strokeWidth="8" strokeLinecap="round" strokeDasharray="175.93" strokeDashoffset="44" className="spinner-circle"/>
              </svg>
            </div>
            <h2 className="scanning-title">{scanningStatus || 'Extracting design system from current file...'}</h2>
          </div>
        </div>
      );
    }

    // Initial welcome screen
    return (
      <div className="container">
        <div className="initial-screen">
          <div className="welcome-logo">
            <img src={crafterLogo} alt="Crafter" className="logo-image" />
          </div>
          <div className="welcome-content">
            <h1 className="welcome-title">Ideate UI concepts at speed - all using your design system</h1>
            <p className="welcome-subtitle">Let's scan your design system so I can use it to generate on-brand designs.</p>
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
