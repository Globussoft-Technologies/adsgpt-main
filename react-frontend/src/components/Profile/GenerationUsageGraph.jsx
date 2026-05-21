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
        className="flex min-w-[90px] items-center justify-between gap-1 rounded-sm px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#464951]"
      >
        {renderLabel(value)}
        <FiChevronDown size={14} className="opacity-70" />
      </button>

      {open && (
        <div className="scrollbar-thin absolute top-full left-0 z-[60] mt-1 max-h-[220px] w-max min-w-[110px] overflow-y-auto rounded-md border border-[#3a3c44] bg-[#303030] py-1 shadow-lg">
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
                  ? 'bg-[#464951] text-white'
                  : 'text-white/80 hover:bg-[#464951] hover:text-white'
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
  return (
    <div className="relative h-[260px] w-full rounded-lg bg-[#303030]/50 p-4">
      <div className="absolute top-0 right-4 mt-4 flex gap-3">
        <Skeleton
          width={80}
          height={50}
          borderRadius={8}
          baseColor="#2A2A2A"
          highlightColor="#3A3A3A"
        />
        <Skeleton
          width={80}
          height={50}
          borderRadius={8}
          baseColor="#2A2A2A"
          highlightColor="#3A3A3A"
        />
      </div>

      {/* Chart area */}
      <div className="mt-12">
        <Skeleton height={140} borderRadius={8} baseColor="#2A2A2A" highlightColor="#3A3A3A" />
      </div>

      {/* Fake X-axis labels */}
      <div className="mt-4 flex justify-between px-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width={40} height={10} baseColor="#2A2A2A" highlightColor="#3A3A3A" />
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
      <div className="mb-3 flex items-center gap-2" ref={pickerRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-2 rounded-md border bg-black px-3 py-2 text-sm"
        >
          <FiCalendar />
          <span className="text-xs">
            {range[0].startDate && range[0].endDate
              ? `${formatForBackend(range[0].startDate)} → ${formatForBackend(range[0].endDate)}`
              : 'Select date range'}
          </span>
        </button>

        <button onClick={handleReset} title="Reset" className="rounded-md border bg-black p-2">
          <GrPowerReset />
        </button>

        <div className="relative">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="appearance-none rounded-md border border-white/10 bg-black px-4 py-2 pr-10 text-xs text-white/90 shadow-sm transition-all hover:border-white/20 focus:border-[#6366F1] focus:ring-1 focus:ring-[#6366F1]/50 focus:outline-none"
          >
            <option value="both" className="bg-[#1a1a1a] py-2">
              Select Type
            </option>
            <option value="images" className="bg-[#1a1a1a] py-2">
              Images Only
            </option>
            <option value="videos" className="bg-[#1a1a1a] py-2">
              Videos Only
            </option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-white/50">
            <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
              <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
            </svg>
          </div>
        </div>

        {isOpen && (
          <div className="absolute z-50 mt-2 rounded-md border bg-white shadow-lg backdrop-blur-xl dark:bg-[#303030]/50">
            <DateRange
              ranges={tempRange}
              onChange={(r) => setTempRange([r.selection])}
              moveRangeOnFirstSelection={false}
              rangeColors={['#434343']}
              maxDate={new Date()}
              navigatorRenderer={(currentFocusedDate, changeShownDate) => {
                const month = currentFocusedDate.getMonth();
                const year = currentFocusedDate.getFullYear();

                return (
                  <div className="flex items-center justify-between px-2 pt-3 pb-2">
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md bg-[#464951] text-white hover:bg-[#5b5e67]"
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
                      className="flex size-7 items-center justify-center rounded-md bg-[#464951] text-white hover:bg-[#5b5e67] disabled:opacity-50"
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
                className="rounded-sm border border-[#EFEFEF]/60 bg-transparent px-6 py-1 text-sm font-semibold text-[#E3E3E3] hover:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                className="rounded-sm bg-white px-8 py-1 text-sm font-bold text-[#151515] shadow-sm hover:bg-white/70"
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
            <div className="top-[50px] rounded-lg border bg-white px-4 py-3 shadow-sm dark:bg-[#303030]/50">
              <p className="text-[11px] tracking-wide text-gray-500 uppercase dark:text-white/70">
                Total Videos
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                {totalVideos}
              </p>
            </div>
          )}
          {(selectedType === 'both' || selectedType === 'images') && (
            <div className="rounded-lg border bg-white px-4 py-3 shadow-sm dark:bg-[#303030]/50">
              <p className="text-[11px] tracking-wide text-gray-500 uppercase dark:text-white/70">
                Total Images
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                {totalImages}
              </p>
            </div>
          )}
        </div>

        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            No usage data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />

              <XAxis
                dataKey="date"
                stroke="#9ca3af"
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                  })
                }
              />

              <YAxis stroke="#9ca3af" allowDecimals={false} />

              <Tooltip
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: 8,
                  fontSize: 12,
                }}
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
