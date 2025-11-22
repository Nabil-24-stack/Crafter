/**
 * IterationStatus - Shows variation status cards and summary
 */

import * as React from 'react';
import { IterationData } from '../types';
import { VariationCard } from './VariationCard';

interface IterationStatusProps {
  data: IterationData;
  messageId: string;
  onExpandVariation: (messageId: string, variationIndex: number) => void;
}

export const IterationStatus: React.FC<IterationStatusProps> = ({
  data,
  messageId,
  onExpandVariation,
}) => {
  // Calculate duration
  const getDuration = (): string => {
    if (!data.endTime) {
      return 'Reasoning...';
    }

    const durationMs = data.endTime - data.startTime;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);

    if (minutes > 0) {
      return `Reasoned for ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
    return `Reasoned for ${seconds} second${seconds > 1 ? 's' : ''}`;
  };

  return (
    <div className="iteration-status">
      <div className="status-header">
        {data.status === 'in-progress' && (
          <>
            <span className="reasoning-spinner"></span>
            <span className="status-text">Reasoning...</span>
          </>
        )}
        {(data.status === 'complete' || data.status === 'stopped') && (
          <span className="status-text">{getDuration()}</span>
        )}
      </div>

      <div className="variations-list">
        {data.variations.map((variation) => (
          <VariationCard
            key={variation.index}
            variation={variation}
            onToggleExpand={() => onExpandVariation(messageId, variation.index)}
          />
        ))}
      </div>

      {data.summary && (
        <div className="iteration-summary">
          <p className="summary-text">{data.summary}</p>
        </div>
      )}
    </div>
  );
};
