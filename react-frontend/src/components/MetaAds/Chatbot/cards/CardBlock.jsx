import React from 'react';
import StatCard from './StatCard';
import BarBreakdownCard from './BarBreakdownCard';
import ComparisonCard from './ComparisonCard';
import SuggestionChips from './SuggestionChips';
import FindingCard from './FindingCard';
import AdPreviewCard from './AdPreviewCard';
import TrendChartCard from './TrendChartCard';
import DonutChartCard from './DonutChartCard';
import BudgetPacingCard from './BudgetPacingCard';
import LeadsTableCard from './LeadsTableCard';
import AudiencesListCard from './AudiencesListCard';
import CreativeGalleryCard from './CreativeGalleryCard';
import OpportunityScoreCard from './OpportunityScoreCard';
import PixelHealthCard from './PixelHealthCard';
import DiagnosticsCard from './DiagnosticsCard';
import AdRulesCard from './AdRulesCard';
import AbTestResultsCard from './AbTestResultsCard';
import BillingSummaryCard from './BillingSummaryCard';
import ActivityTimelineCard from './ActivityTimelineCard';
import AccountPickerCard from './AccountPickerCard';
import ConnectionStatusCard from './ConnectionStatusCard';

// Dispatches a `card` payload (from the backend's render tools) to its
// renderer by `kind`. `onAction` is used by action chips to seed a new turn;
// `disabled` freezes chips while a turn is streaming.
const CardBlock = ({ card, onAction, disabled }) => {
  switch (card.kind) {
    case 'account_picker':
      return <AccountPickerCard title={card.title} accounts={card.accounts} onAction={onAction} disabled={disabled} />;
    case 'connection_status':
      return <ConnectionStatusCard />;
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
    case 'trend':
      return <TrendChartCard title={card.title} unit={card.unit} series={card.series} />;
    case 'donut':
      return <DonutChartCard title={card.title} items={card.items} />;
    case 'budget_pacing':
      return (
        <BudgetPacingCard
          title={card.title}
          period={card.period}
          spent={card.spent}
          budget={card.budget}
          unit={card.unit}
        />
      );
    case 'leads':
      return <LeadsTableCard title={card.title} leads={card.leads} />;
    case 'audiences':
      return <AudiencesListCard title={card.title} audiences={card.audiences} />;
    case 'gallery':
      return <CreativeGalleryCard title={card.title} items={card.items} />;
    case 'opportunity_score':
      return (
        <OpportunityScoreCard
          title={card.title}
          score={card.score}
          recommendations={card.recommendations}
        />
      );
    case 'pixel_health':
      return (
        <PixelHealthCard
          pixelName={card.pixelName}
          lastFiredAt={card.lastFiredAt}
          matchRate={card.matchRate}
          status={card.status}
          notes={card.notes}
        />
      );
    case 'diagnostics':
      return <DiagnosticsCard title={card.title} issues={card.issues} />;
    case 'ad_rules':
      return <AdRulesCard title={card.title} rules={card.rules} />;
    case 'ab_test':
      return (
        <AbTestResultsCard
          title={card.title}
          metricLabel={card.metricLabel}
          confidence={card.confidence}
          variants={card.variants}
        />
      );
    case 'billing':
      return (
        <BillingSummaryCard
          paymentMethod={card.paymentMethod}
          amountDue={card.amountDue}
          nextBillDate={card.nextBillDate}
          accountStatus={card.accountStatus}
        />
      );
    case 'timeline':
      return <ActivityTimelineCard title={card.title} events={card.events} />;
    default:
      return null;
  }
};

export default CardBlock;
