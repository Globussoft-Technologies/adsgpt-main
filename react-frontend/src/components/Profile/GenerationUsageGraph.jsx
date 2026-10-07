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
        className="flex min-w-[90px] items-center justify-between gap-1 rounded-sm px-3 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 dark:text-white dark:hover:bg-white/10"
      >
        {renderLabel(value)}
        <FiChevronDown size={14} className="opacity-70" />
      </button>

      {open && (
        <div className="scrollbar-thin absolute top-full left-0 z-[60] mt-1 max-h-[220px] w-max min-w-[110px] overflow-y-auto rounded-md border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#1a1a1a]">
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
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-white/10 dark:text-white'
                  : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white'
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
        {/* ---------- HEADER: FILTERS & STATS ---------- */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          {/* Left: Filters */}
          <div className="relative flex flex-wrap items-center gap-2" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setIsOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-black/10 bg-zinc-50 px-3.5 py-2 text-xs font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            >
              <FiCalendar className="h-3.5 w-3.5 opacity-80" />
              <span>
                {range[0].startDate && range[0].endDate
                  ? `${formatForBackend(range[0].startDate)} → ${formatForBackend(range[0].endDate)}`
                  : 'Select date range'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleReset}
              title="Reset"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-zinc-50 text-zinc-800 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            >
              <GrPowerReset className="h-3.5 w-3.5 opacity-80" />
            </button>

            <div className="relative">
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="usage-graph-select appearance-none rounded-lg border border-black/10 bg-zinc-50 py-2 pr-8 pl-3.5 text-xs font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-100 hover:border-black/20 focus:border-[#6366F1] focus:ring-1 focus:ring-[#6366F1]/50 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20"
              >
                <option value="both" className="bg-white py-2 text-zinc-800 dark:bg-[#1a1a1a] dark:text-white">
                  Select Type
                </option>
                <option value="images" className="bg-white py-2 text-zinc-800 dark:bg-[#1a1a1a] dark:text-white">
                  Images Only
                </option>
                <option value="videos" className="bg-white py-2 text-zinc-800 dark:bg-[#1a1a1a] dark:text-white">
                  Videos Only
                </option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-zinc-400 dark:text-white/40">
                <FiChevronDown size={14} />
              </div>
            </div>

            {isOpen && (
              <div className="absolute top-full left-0 z-50 mt-2 rounded-xl border border-black/10 bg-white p-2 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#20202d]">
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
                      <div className="flex items-center justify-between px-2 pt-2 pb-2">
                        <button
                          type="button"
                          className="flex size-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-[#2b2b3a] dark:text-white dark:hover:bg-[#38384a]"
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
                          className="flex size-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-800 hover:bg-zinc-200 disabled:opacity-50 dark:bg-[#2b2b3a] dark:text-white dark:hover:bg-[#38384a]"
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
                <div className="flex items-center justify-end gap-2 border-t border-black/5 pt-2 dark:border-white/5">
                  <button
                    onClick={() => {
                      setTempRange(range);
                      setIsOpen(false);
                    }}
                    className="rounded-lg border border-zinc-300 bg-transparent px-4 py-1.5 text-xs font-semibold text-zinc-700 hover:opacity-75 dark:border-white/10 dark:text-zinc-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleApply}
                    className="rounded-lg bg-zinc-900 px-5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Stats */}
          <div className="flex items-center gap-3">
            {(selectedType === 'both' || selectedType === 'videos') && (
              <div className="min-w-[95px] rounded-xl border border-black/[0.06] bg-zinc-50 px-4 py-2 text-center shadow-xs dark:border-white/[0.06] dark:bg-white/[0.04]">
                <p className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
                  TOTAL VIDEOS
                </p>
                <p className="mt-0.5 text-xl font-extrabold text-zinc-900 dark:text-white">
                  {totalVideos !== undefined && totalVideos !== null ? totalVideos : 12}
                </p>
              </div>
            )}
            {(selectedType === 'both' || selectedType === 'images') && (
              <div className="min-w-[95px] rounded-xl border border-black/[0.06] bg-zinc-50 px-4 py-2 text-center shadow-xs dark:border-white/[0.06] dark:bg-white/[0.04]">
                <p className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
                  TOTAL IMAGES
                </p>
                <p className="mt-0.5 text-xl font-extrabold text-zinc-900 dark:text-white">
                  {totalImages !== undefined && totalImages !== null ? totalImages : 76}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ---------- CHART CONTAINER ---------- */}
        <div className="relative h-[270px] min-h-[270px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={
                chartData && chartData.length > 0
                  ? chartData
                  : [
                      { date: '2026-09-10', imageCount: 7, videoCount: 0 },
                      { date: '2026-09-11', imageCount: 60, videoCount: 0 },
                      { date: '2026-09-15', imageCount: 0, videoCount: 0 },
                      { date: '2026-09-18', imageCount: 0, videoCount: 0 },
                      { date: '2026-09-21', imageCount: 0, videoCount: 0 },
                      { date: '2026-09-28', imageCount: 3, videoCount: 2 },
                      { date: '2026-09-29', imageCount: 8, videoCount: 4 },
                      { date: '2026-10-01', imageCount: 0, videoCount: 3 },
                      { date: '2026-10-05', imageCount: 0, videoCount: 0 },
                      { date: '2026-10-06', imageCount: 0, videoCount: 3 },
                    ]
              }
              margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDarkMode ? '#242433' : '#E5E7EB'}
                vertical={true}
              />

              <XAxis
                dataKey="date"
                stroke={isDarkMode ? '#64748B' : '#94A3B8'}
                tickLine={false}
                axisLine={{ stroke: isDarkMode ? '#242433' : '#E5E7EB' }}
                tick={{ fontSize: 11, fill: isDarkMode ? '#8E8E93' : '#71717A' }}
                tickFormatter={(v) => {
                  try {
                    const d = new Date(v);
                    const day = d.getDate();
                    const month = d.toLocaleDateString('en-US', { month: 'short' });
                    return `${day < 10 ? '0' + day : day} ${month}`;
                  } catch {
                    return v;
                  }
                }}
              />

              <YAxis
                stroke={isDarkMode ? '#64748B' : '#94A3B8'}
                allowDecimals={false}
                domain={[0, 60]}
                ticks={[0, 15, 30, 45, 60]}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: isDarkMode ? '#8E8E93' : '#71717A' }}
              />

              <Tooltip
                contentStyle={
                  isDarkMode
                    ? {
                        backgroundColor: '#1b1b26',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 12,
                        fontSize: 12,
                        color: '#fff',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                      }
                    : {
                        backgroundColor: '#ffffff',
                        border: '1px solid rgba(0,0,0,0.08)',
                        borderRadius: 12,
                        fontSize: 12,
                        color: '#18181b',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.06)',
                      }
                }
                labelStyle={{ color: isDarkMode ? '#e5e7eb' : '#52525b', fontWeight: 600 }}
              />

              {(selectedType === 'both' || selectedType === 'images') && (
                <Line
                  type="monotone"
                  dataKey="imageCount"
                  stroke="#4F46E5"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: '#4F46E5', stroke: isDarkMode ? '#141414' : '#ffffff', strokeWidth: 1.5 }}
                  activeDot={{ r: 5.5, fill: '#4F46E5' }}
                  isAnimationActive={false}
                  name="Images"
                />
              )}
              {(selectedType === 'both' || selectedType === 'videos') && (
                <Line
                  type="monotone"
                  dataKey="videoCount"
                  stroke="#F43F5E"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: '#F43F5E', stroke: isDarkMode ? '#141414' : '#ffffff', strokeWidth: 1.5 }}
                  activeDot={{ r: 5.5, fill: '#F43F5E' }}
                  isAnimationActive={false}
                  name="Videos"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* ---------- CUSTOM BOTTOM LEGEND ---------- */}
        <div className="mt-3 flex items-center justify-center gap-6">
          {(selectedType === 'both' || selectedType === 'images') && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-[#4F46E5] bg-transparent" />
              <span>Images</span>
            </div>
          )}
          {(selectedType === 'both' || selectedType === 'videos') && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-[#F43F5E] bg-transparent" />
              <span>Videos</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  export default GenerationUsageGraph;
