import React from 'react';
import StatCard from './StatCard';
import BarBreakdownCard from './BarBreakdownCard';
import ComparisonCard from './ComparisonCard';
import SuggestionChips from './SuggestionChips';
import FindingCard from './FindingCard';
import AdPreviewCard from './AdPreviewCard';

// Dispatches a `card` payload (from the backend's render tools) to its
// renderer by `kind`. `onAction` is used by action chips to seed a new turn;
// `disabled` freezes chips while a turn is streaming.
const CardBlock = ({ card, onAction, disabled }) => {
  switch (card.kind) {
    case 'stat':
      return (
        <StatCard title={card.title} subtitle={card.subtitle} badge={card.badge} stats={card.stats} />
      );
    case 'bars':
      return <BarBreakdownCard title={card.title} unit={card.unit} items={card.items} />;
    case 'comparison':
      return (
        <ComparisonCard
          title={card.title}
          columns={card.columns}
          rows={card.rows}
          highlightIndex={card.highlightIndex}
        />
      );
    case 'actions':
      return <SuggestionChips actions={card.actions} onAction={onAction} disabled={disabled} />;
    case 'findings':
      return (
        <FindingCard
          title={card.title}
          findings={card.findings}
          onAction={onAction}
          disabled={disabled}
        />
      );
    case 'ad_preview':
      return <AdPreviewCard title={card.title} format={card.format} previewUrl={card.previewUrl} />;
    default:
      return null;
  }
};

export default CardBlock;
