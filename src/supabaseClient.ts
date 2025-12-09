/**
 * Supabase client for realtime reasoning updates
 */
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { config } from './config';

// Create Supabase client for realtime subscriptions
export const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);

/**
 * Subscribe to reasoning chunks for a specific job
 */
export function subscribeToReasoningChunks(
  jobId: string,
  onChunk: (chunk: { chunk_text: string; chunk_index: number }) => void,
  onError?: (error: Error) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`reasoning-${jobId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'reasoning_chunks',
        filter: `job_id=eq.${jobId}`,
      },
      (payload) => {
        console.log('Received reasoning chunk:', payload);
        if (payload.new) {
          onChunk({
            chunk_text: payload.new.chunk_text as string,
            chunk_index: payload.new.chunk_index as number,
          });
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`✅ Subscribed to reasoning chunks for job ${jobId}`);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        console.error(`❌ Subscription error for job ${jobId}:`, status);
        if (onError) {
          onError(new Error(`Subscription status: ${status}`));
        }
      }
    });

  return channel;
}

/**
 * Unsubscribe from a reasoning chunks channel
 */
export async function unsubscribeFromReasoningChunks(
  channel: RealtimeChannel
): Promise<void> {
  await supabase.removeChannel(channel);
  console.log('🔌 Unsubscribed from reasoning chunks');
}

/**
 * Subscribe to SVG chunks for a specific job
 */
export function subscribeToSVGChunks(
  jobId: string,
  onChunk: (chunk: { chunk_text: string; chunk_index: number }) => void,
  onError?: (error: Error) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`svg-${jobId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'svg_chunks',
        filter: `job_id=eq.${jobId}`,
      },
      (payload) => {
        console.log('Received SVG chunk:', payload);
        if (payload.new) {
          onChunk({
            chunk_text: payload.new.chunk_text as string,
            chunk_index: payload.new.chunk_index as number,
          });
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`✅ Subscribed to SVG chunks for job ${jobId}`);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        console.error(`❌ SVG subscription error for job ${jobId}:`, status);
        if (onError) {
          onError(new Error(`Subscription status: ${status}`));
        }
      }
    });

  return channel;
}

/**
 * Unsubscribe from an SVG chunks channel
 */
export async function unsubscribeFromSVGChunks(
  channel: RealtimeChannel
): Promise<void> {
  await supabase.removeChannel(channel);
  console.log('🔌 Unsubscribed from SVG chunks');
}
