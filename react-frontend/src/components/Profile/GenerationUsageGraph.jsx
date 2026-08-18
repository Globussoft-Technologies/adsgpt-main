import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { DateRange } from 'react-date-range';
import { FiCalendar, FiChevronLeft, FiChevronRight, FiChevronDown } from 'react-icons/fi';
import { GrPowerReset } from 'react-icons/gr';
import { fetchGenerationStats } from '@/store/actions/profile/usageActions';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 30 }, (_, i) => currentYear - i);

/* ---- Inline dropdown (NO portal, stays in DOM tree) ---- */
const InlineDropdown = ({ value, options, onChange, renderLabel }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[90px] items-center justify-between gap-1 rounded-sm px-3 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 dark:text-white dark:hover:bg-[#464951]"
      >
        {renderLabel(value)}
        <FiChevronDown size={14} className="opacity-70" />
      </button>

      {open && (
        <div className="scrollbar-thin absolute top-full left-0 z-[60] mt-1 max-h-[220px] w-max min-w-[110px] overflow-y-auto rounded-md border border-[#DDD7CD] bg-[var(--ws-surface-control)] py-1 shadow-lg dark:border-[#3a3c44] dark:bg-[#303030]">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`mt-1 block w-full px-3 py-1.5 text-left text-sm ${
                opt.value === value
                  ? 'bg-[var(--ws-surface-header)] text-[#24211D] dark:bg-[#464951] dark:text-white'
                  : 'text-[#7A7369] hover:bg-[var(--ws-surface-header)] hover:text-[#24211D] dark:text-white/80 dark:hover:bg-[#464951] dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ---------- Utils ---------- */
const formatForBackend = (date) => {
  if (!date) return undefined;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const GraphSkeleton = () => {
  const isDark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const baseColor = isDark ? '#2A2A2A' : '#e4e4e7';
  const highlightColor = isDark ? '#3A3A3A' : '#f4f4f5';

  return (
    <div className="relative h-[260px] w-full rounded-lg bg-zinc-50 p-4 dark:bg-[#303030]/50">
      <div className="absolute top-0 right-4 mt-4 flex gap-3">
        <Skeleton
          width={80}
          height={50}
          borderRadius={8}
          baseColor={baseColor}
          highlightColor={highlightColor}
        />
        <Skeleton
          width={80}
          height={50}
          borderRadius={8}
          baseColor={baseColor}
          highlightColor={highlightColor}
        />
      </div>

      {/* Chart area */}
      <div className="mt-12">
        <Skeleton height={140} borderRadius={8} baseColor={baseColor} highlightColor={highlightColor} />
      </div>

      {/* Fake X-axis labels */}
      <div className="mt-4 flex justify-between px-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width={40} height={10} baseColor={baseColor} highlightColor={highlightColor} />
        ))}
      </div>
    </div>
  );
};

const GenerationUsageGraph = ({ userId }) => {
  const dispatch = useDispatch();
  const {
    generationStats = [],
    totalImages,
    totalVideos,
    loading,
  } = useSelector((s) => s.usage || {});
  const isDarkMode = useSelector((s) => s.theme?.isDarkMode);

  /* ---------- Date Filter State ---------- */
  const [range, setRange] = useState([{ startDate: null, endDate: null, key: 'selection' }]);
  const [tempRange, setTempRange] = useState(range);
  const [selectedType, setSelectedType] = useState('both');
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef(null);

  /* ---------- Initial Load ---------- */
  useEffect(() => {
    if (userId) {
      dispatch(fetchGenerationStats({ userId }));
    }
  }, [userId, dispatch]);

  /* ---------- Outside Click ---------- */
  useEffect(() => {
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsOpen(false);
        setTempRange(range);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [range]);

  /* ---------- Apply ---------- */
  const handleApply = () => {
    setRange(tempRange);
    setIsOpen(false);

    dispatch(
      fetchGenerationStats({
        userId,
        from: formatForBackend(tempRange[0].startDate),
        to: formatForBackend(tempRange[0].endDate),
      })
    );
  };

  /* ---------- Reset ---------- */
  const handleReset = () => {
    const empty = [{ startDate: null, endDate: null, key: 'selection' }];
    setRange(empty);
    setTempRange(empty);
    setIsOpen(false);
    setSelectedType('both');

    dispatch(fetchGenerationStats({ userId }));
  };

  const chartData = useMemo(() => {
    return generationStats.map((item) => ({
      date: item.date,
      imageCount: Number(item.image_count) || 0,
      videoCount: Number(item.video_count) || 0,
    }));
  }, [generationStats]);

  if (loading) {
    return <GraphSkeleton />;
  }

  // if (!chartData.length) {
  //   return (
  //     <div className="flex h-[260px] items-center justify-center text-sm text-gray-400">
  //       No usage data available
  //     </div>
  //   );
  // }

  const monthOptions = MONTHS.map((m, i) => ({ value: i, label: m }));
  const yearOptions = YEARS.map((y) => ({ value: y, label: y.toString() }));

  return (
    <div className="w-full">
      {/* ---------- FILTER BAR ---------- */}
      <div className="relative mb-3 flex items-center gap-2" ref={pickerRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-2 rounded-xl border border-[#DDD7CD] bg-[var(--ws-surface-control)] px-3.5 py-2 text-xs font-semibold text-[#24211D] shadow-[0_1px_3px_rgba(80,70,58,0.04)] transition-all hover:bg-[var(--ws-surface-header)] dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-white dark:shadow-none dark:hover:bg-white/10"
        >
          <FiCalendar />
          <span className="text-xs">
            {range[0].startDate && range[0].endDate
              ? `${formatForBackend(range[0].startDate)} → ${formatForBackend(range[0].endDate)}`
              : 'Select date range'}
          </span>
        </button>

        <button
          onClick={handleReset}
          title="Reset"
          className="rounded-xl border border-[#DDD7CD] bg-[var(--ws-surface-control)] p-2 text-[#24211D] shadow-[0_1px_3px_rgba(80,70,58,0.04)] transition-all hover:bg-[var(--ws-surface-header)] dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-white dark:shadow-none dark:hover:bg-white/10"
        >
          <GrPowerReset />
        </button>

        <div className="relative">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="usage-graph-select appearance-none rounded-xl border border-[#DDD7CD] bg-[var(--ws-surface-control)] px-4 py-2 pr-10 text-xs font-semibold text-[#24211D] shadow-[0_1px_3px_rgba(80,70,58,0.04)] transition-all hover:bg-[var(--ws-surface-header)] focus:outline-none dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-white/90 dark:shadow-none"
          >
            <option value="both" className="bg-[var(--ws-surface-control)] py-2 text-[#24211D] dark:bg-[#1a1a1a] dark:text-white">
              Select Type
            </option>
            <option value="images" className="bg-[var(--ws-surface-control)] py-2 text-[#24211D] dark:bg-[#1a1a1a] dark:text-white">
              Images Only
            </option>
            <option value="videos" className="bg-[var(--ws-surface-control)] py-2 text-[#24211D] dark:bg-[#1a1a1a] dark:text-white">
              Videos Only
            </option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[#7A7369] dark:text-white/50">
            <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
              <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
            </svg>
          </div>
        </div>

        {isOpen && (
          <div className="absolute top-full left-0 z-50 mt-2 rounded-xl border border-[#DDD7CD] bg-[var(--ws-surface-control)] shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-[#303030]/50">
            <DateRange
              ranges={tempRange}
              onChange={(r) => setTempRange([r.selection])}
              moveRangeOnFirstSelection={false}
              rangeColors={[isDarkMode ? '#434343' : '#e4e4e7']}
              maxDate={new Date()}
              navigatorRenderer={(currentFocusedDate, changeShownDate) => {
                const month = currentFocusedDate.getMonth();
                const year = currentFocusedDate.getFullYear();

                return (
                  <div className="flex items-center justify-between px-2 pt-3 pb-2">
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-[#464951] dark:text-white dark:hover:bg-[#5b5e67]"
                      onClick={() => {
                        const d = new Date(currentFocusedDate);
                        d.setMonth(d.getMonth() - 1);
                        changeShownDate(d);
                      }}
                    >
                      <FiChevronLeft size={16} />
                    </button>

                    <div className="flex items-center gap-1">
                      <InlineDropdown
                        value={month}
                        options={monthOptions}
                        onChange={(val) => {
                          const d = new Date(currentFocusedDate);
                          d.setMonth(val);
                          changeShownDate(d);
                        }}
                        renderLabel={(v) => MONTHS[v]}
                      />
                      <InlineDropdown
                        value={year}
                        options={yearOptions}
                        onChange={(val) => {
                          const d = new Date(currentFocusedDate);
                          d.setFullYear(val);
                          changeShownDate(d);
                        }}
                        renderLabel={(v) => v}
                      />
                    </div>

                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md bg-zinc-200 text-zinc-800 hover:bg-zinc-300 disabled:opacity-50 dark:bg-[#464951] dark:text-white dark:hover:bg-[#5b5e67]"
                      onClick={() => {
                        const d = new Date(currentFocusedDate);
                        d.setMonth(d.getMonth() + 1);
                        changeShownDate(d);
                      }}
                      disabled={year === currentYear && month === new Date().getMonth()}
                    >
                      <FiChevronRight size={16} />
                    </button>
                  </div>
                );
              }}
            />
            <div className="flex items-center justify-end gap-2 p-2">
              <button
                onClick={() => {
                  setTempRange(range);
                  setIsOpen(false);
                }}
                className="rounded-sm border border-zinc-300 bg-transparent px-6 py-1 text-sm font-semibold text-zinc-700 hover:opacity-70 dark:border-[#EFEFEF]/60 dark:text-[#E3E3E3]"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                className="rounded-sm bg-zinc-900 px-8 py-1 text-sm font-bold text-white shadow-sm hover:bg-zinc-800 dark:bg-white dark:text-[#151515] dark:hover:bg-white/70"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="relative h-[260px] min-h-[260px] w-full">
        <div className="absolute top-[-90px] right-4 z-10 flex gap-3">
          {(selectedType === 'both' || selectedType === 'videos') && (
            <div className="rounded-xl border border-[#DDD7CD] bg-[var(--ws-surface-control)] px-4 py-2.5 shadow-[0_1px_3px_rgba(80,70,58,0.04)] dark:border-white/[0.06] dark:bg-white/[0.035] dark:shadow-none">
              <p className="text-[10px] font-bold tracking-wider text-[#7A7369] uppercase dark:text-white/70">
                Total Videos
              </p>
              <p className="mt-0.5 text-base font-bold text-[#24211D] dark:text-white">
                {totalVideos}
              </p>
            </div>
          )}
          {(selectedType === 'both' || selectedType === 'images') && (
            <div className="rounded-xl border border-[#DDD7CD] bg-[var(--ws-surface-control)] px-4 py-2.5 shadow-[0_1px_3px_rgba(80,70,58,0.04)] dark:border-white/[0.06] dark:bg-white/[0.035] dark:shadow-none">
              <p className="text-[10px] font-bold tracking-wider text-[#7A7369] uppercase dark:text-white/70">
                Total Images
              </p>
              <p className="mt-0.5 text-base font-bold text-[#24211D] dark:text-white">
                {totalImages}
              </p>
            </div>
          )}
        </div>

        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-gray-400">
            No usage data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#2a2a2a' : '#e4e4e7'} />

              <XAxis
                dataKey="date"
                stroke={isDarkMode ? '#9ca3af' : '#71717a'}
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                  })
                }
              />

              <YAxis stroke={isDarkMode ? '#9ca3af' : '#71717a'} allowDecimals={false} />

              <Tooltip
                contentStyle={
                  isDarkMode
                    ? {
                        backgroundColor: '#111827',
                        border: '1px solid #374151',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#fff',
                      }
                    : {
                        backgroundColor: '#ffffff',
                        border: '1px solid rgba(0,0,0,0.1)',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#18181b',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      }
                }
                labelStyle={{ color: isDarkMode ? '#e5e7eb' : '#52525b' }}
              />

              <Legend verticalAlign="bottom" height={36} />
              {(selectedType === 'both' || selectedType === 'images') && (
                <Line
                  type="monotone"
                  dataKey="imageCount"
                  stroke="#6366F1"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  isAnimationActive={false}
                  name="Images"
                />
              )}
              {(selectedType === 'both' || selectedType === 'videos') && (
                <Line
                  type="monotone"
                  dataKey="videoCount"
                  stroke="#F16363"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  isAnimationActive={false}
                  name="Videos"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default GenerationUsageGraph;
