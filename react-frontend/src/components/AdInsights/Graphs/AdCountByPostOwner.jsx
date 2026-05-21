import { ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';

const AvatarTick = ({ x, y, payload, avatars = [] }) => {
  const size = Math.max(30, Math.min(30, (window.innerWidth / 1920) * 56));
  const radius = size / 2;
  const id = `avatar-clip-${payload?.index}`;
  const name = payload?.value;
  const avatar = avatars[payload?.index]?.pictureSettings?.src || '';

  return (
    <g transform={`translate(${x}, ${y})`}>
      <image
        className="border border-white"
        href={avatar}
        x={-radius}
        y={-radius}
        width={size}
        height={size}
        clipPath={`url(#${id})`}
      />
      <text dy={radius + 20} textAnchor="middle" fill="#ffffff" fontSize="12">
        {name}
      </text>
    </g>
  );
};

const AdCountByPostOwner = () => {
  const postOwnerData = useSelector((state) => state.addie?.postOwnerData);
  const ctaData = useSelector((state) => state.addie?.ctaData);
  const isLoading = useSelector((state) => state.addie?.loading);

  // for showing 2nd graph
  const [graphStep, setGraphStep] = useState(0);
  const prevStepRef = useRef(0);
  const [direction, setDirection] = useState(1);

  // Transform API data for the bar chart
  const data = useMemo(() => {
    if (!postOwnerData?.chartData || !Array.isArray(postOwnerData?.chartData)) {
      return [];
    }

    return postOwnerData.chartData.map((item, index) => ({
      name: item?.name || `Owner ${index + 1}`,
      value: item?.steps || 0,
      avatar: item?.pictureSettings?.src || '',
    }));
  }, [postOwnerData]);

  const dataCta = useMemo(() => {
    if (!ctaData?.chartData || !Array.isArray(ctaData?.chartData)) {
      return [];
    }

    return ctaData.chartData.map((item, index) => ({
      name: item?.country || `Cta ${index + 1}`,
      value: item?.value || 0,
      avatar: 'n/a',
    }));
  }, [ctaData]);

  const hasData = data?.length > 0 && data?.some((item) => item?.value > 0);
  const hasCtaData = dataCta?.length > 0 && dataCta?.some((item) => item?.value > 0);

  const COLORS = ['#EFC6FD', '#A586FF', '#86C5FF', '#3AA0FF', '#D8E7FF', '#B39DFF'];

  const formatYAxis = (val) => {
    return val?.toLocaleString?.();
  };

  // Reusable functional component for the graph (keeps original structure)
  const ChartView = ({ chartData }) => (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart
        data={chartData}
        margin={{ top: 10, right: 10, left: 10, bottom: 30 }}
        barCategoryGap="20%"
      >
        <CartesianGrid vertical={false} stroke="#2F2F2F" strokeDasharray="4 6" />
        <YAxis
          domain={[0, 'dataMax']}
          tickFormatter={formatYAxis}
          tick={{ fill: '#ffffff', fontSize: 10, fontFamily: 'Public Sans, sans-serif' }}
          tickLine={false}
          axisLine={{ stroke: '#ffffff20', strokeWidth: 1 }}
        />
        <Tooltip
          cursor={{ fill: '#0D0D0D' }}
          contentStyle={{
            background: '#0D0D0D90',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '10px 12px',
          }}
          itemStyle={{ color: '#ffffff' }}
          formatter={(v) => [v?.toLocaleString?.(), 'Ads']}
        />
        <Bar dataKey="value" radius={[12, 12, 0, 0]}>
          {chartData?.map?.((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Bar>
        {/* Render XAxis last so avatar ticks appear above bars */}
        {/* <XAxis
          dataKey="name"
          tick={(props) => <AvatarTick {...props} avatars={chartData} />}
          tickLine={true}
          axisLine={false}
          interval={0}
          tickMargin={-11}
          angle={-90} // Rotate labels 90 degrees
          textAnchor="end" // Adjust text alignment for rotated labels
        /> */}
        <XAxis
          dataKey="name"
          tick={(props) => <VerticalAvatarTick {...props} avatars={chartData} />}
          tickLine={true}
          axisLine={{ stroke: '#ffffff20', strokeWidth: 1 }}
          interval={0}
          tickMargin={-20} // Increase margin to accommodate vertical layout
          height={20} // Increase XAxis height to fit vertical content
        />
      </BarChart>
    </ResponsiveContainer>
  );

  // Shimmer loading component
  const ShimmerBar = () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="h-full w-full animate-pulse">
        <div className="flex h-full flex-wrap items-end justify-center space-x-4 px-8">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
            <div key={item} className="flex flex-col items-center">
              <div
                className="w-full rounded-t-lg bg-gradient-to-r from-[#2A2A2A] to-[#1E1E1E]"
                style={{
                  height: `${20 + item * 12}%`,
                  width: '60px',
                  animationDelay: `${item * 0.1}s`,
                }}
              />
              <div className="mt-4 h-8 w-8 rounded-full bg-gradient-to-r from-[#2A2A2A] to-[#1E1E1E]" />
              <div className="mt-2 h-4 w-16 rounded bg-gradient-to-r from-[#2A2A2A] to-[#1E1E1E]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  const NoDataMessage = () => (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-gray-200 bg-gray-100">
        <div className="text-3xl">📊</div>
      </div>
      <h3 className="mb-2 text-xl font-medium text-[#AFAFAF]">No Data Available</h3>
      <p className="max-w-md text-center text-sm text-[#7E7E7E]">
        There's no ad count data to display at the moment.
      </p>
    </div>
  );
  const VerticalAvatarTick = ({ x, y, payload, avatars = [] }) => {
    const size = Math.max(30, Math.min(30, (window.innerWidth / 1920) * 56));
    const radius = size / 2;
    const name = payload?.value;
    const avatar = avatars[payload?.index]?.pictureSettings?.src || '';

    return (
      <g transform={`translate(${x}, ${y}) rotate(-90)`}>
        {/* Avatar Image */}
        <image
          className="border border-white"
          href={avatar}
          x={-radius}
          y={-radius}
          width={size}
          height={size}
          clipPath={`url(#avatar-clip-${payload?.index})`}
        />

        {/* Name Text - positioned to the right of the avatar */}
        <text x={radius + 25} y={0} textAnchor="start" fill="#ffffff" fontSize="12" dy="0.3em">
          {name}
        </text>
      </g>
    );
  };

  return (
    <div
      id="tour_postowner_graph"
      className="backdrop-blur-100 relative flex min-h-[500px] w-full max-w-7xl flex-col rounded-3xl border border-white/20 bg-[#0D0D0D]/50 px-2 py-8 lg:px-8"
    >
      {/* "backdrop-blur-100 relative w-full max-w-7xl rounded-3xl border border-white/20 bg-[#0D0D0D]/50 px-2 py-8 lg:px-8" */}
      <h1 className="mx-auto w-[46vw] text-center text-lg font-medium text-[#AFAFAF] lg:w-full 2xl:text-2xl">
        {graphStep === 0 ? hasData && postOwnerData?.title : hasCtaData && ctaData?.title}
      </h1>

      <div className="relative mt-12 mb-6 w-full flex-1">
        {graphStep === 0 && (
          <>
            {/* Loading State */}
            {isLoading && <ShimmerBar />}

            {/* No Data State */}
            {!isLoading && !hasData && <NoDataMessage />}

            {/* Data State */}
            {!isLoading && hasData && <ChartView chartData={data} />}
          </>
        )}

        {/* Step 1: show second graph using data2 */}
        {graphStep === 1 && (
          <>
            {/* Loading State */}
            {isLoading && <ShimmerBar />}

            {/* No Data State */}
            {!isLoading && !hasCtaData && <NoDataMessage />}

            {/* Data State */}
            {!isLoading && hasCtaData && <ChartView chartData={dataCta} />}
          </>
        )}
      </div>

      <div className="swiper_navigation_container absolute top-5 right-6 flex items-center justify-center gap-3">
        <button
          onClick={() => setGraphStep(0)}
          disabled={graphStep === 0}
          className={`prev_button prompt_selection_button relative z-10 w-fit rounded bg-[#1E1E1E] px-0.5 py-2 text-center text-xs hover:bg-[#2A2A2A] hover:!text-white 2xl:text-sm ${graphStep === 0 ? '!text-[#AFAFAF] opacity-50' : 'text-white transition-all duration-200 hover:scale-105'} `}
        >
          <ChevronLeft />
        </button>
        <button
          onClick={() => setGraphStep(1)}
          disabled={graphStep === 1}
          className={`prev_button prompt_selection_button relative z-10 w-fit rounded bg-[#1E1E1E] px-0.5 py-2 text-center text-xs ${graphStep === 1 ? '!text-[#AFAFAF] opacity-50' : 'text-white transition-all duration-200 hover:scale-105'} hover:bg-[#2A2A2A] 2xl:text-sm`}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
};

export default AdCountByPostOwner;
