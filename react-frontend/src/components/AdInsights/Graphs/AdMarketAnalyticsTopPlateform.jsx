import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

const AdMarketAnalyticsTopPlateform = () => {
  const engagementData = useSelector((state) => state.addie?.engagementData);
  const isLoading = useSelector((state) => state.addie?.loading);

  // Theme-aligned colors
  const COLORS = useMemo(() => ['#3AA0FF', '#86C5FF', '#A586FF', '#EFC6FD', '#D8E7FF'], []);

  // Check if data is available
  const hasData = engagementData?.chartData?.length > 0;
  const isEmpty = !isLoading && !hasData;

  // Transform API data for the pie chart
  const data = useMemo(() => {
    if (!engagementData?.chartData || !Array.isArray(engagementData.chartData)) {
      return [];
    }

    return engagementData.chartData.map((item, index) => ({
      name: item?.category || `Category ${index + 1}`,
      value: item?.value || 0,
    }));
  }, [engagementData]);

  // Shimmer Loading Component
  const ShimmerLoader = () => (
    <div className="animate-pulse">
      {/* Header Shimmer */}
      <div className="mb-8 flex justify-center">
        <div className="mx-auto h-7 w-80 rounded bg-gray-700"></div>
      </div>

      <div className="flex w-full flex-col items-center justify-center gap-0 lg:mt-6 lg:flex-row lg:gap-0">
        {/* Chart Container Shimmer */}
        <div className="w-[380px] flex-none scale-75 md:scale-100">
          <div className="relative flex h-[380px] items-center justify-center rounded-full bg-gray-800/50">
            {/* Pie chart segments shimmer */}
            <div className="absolute inset-0 overflow-hidden rounded-full">
              {[...Array(4)].map((_, index) => (
                <div
                  key={index}
                  className="absolute h-1/2 w-1/2 bg-gray-700/70"
                  style={{
                    transformOrigin: '100% 100%',
                    transform: `rotate(${index * 90}deg) skewY(60deg)`,
                  }}
                ></div>
              ))}
            </div>
            {/* Center circle */}
            <div className="absolute z-10 h-32 w-32 rounded-full bg-[#0D0D0D]"></div>
          </div>
        </div>

        {/* Legend Shimmer */}
        <div className="flex w-40 items-center justify-center 2xl:w-52">
          <div className="flex flex-row flex-wrap gap-5 lg:flex-col 2xl:gap-8">
            {[...Array(4)].map((_, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 rounded-full bg-gray-700"></div>
                <div className="h-4 w-20 rounded bg-gray-700"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // No Data Component
  const NoDataState = () => (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-gray-200 bg-gray-100">
        <div className="text-3xl">📊</div>
      </div>
      <h3 className="mb-2 text-xl font-medium text-[#AFAFAF]">No Data Available</h3>
      <p className="max-w-md text-center text-sm text-[#7E7E7E]">
        No data available for the pie chart. Add some data points to visualize your distribution.
      </p>
    </div>
  );

  if (isLoading) {
    return (
      <div className="backdrop-blur-100 w-full max-w-7xl rounded-3xl border border-white/10 bg-[#0D0D0D]/50 p-8">
        <ShimmerLoader />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="backdrop-blur-100 w-full max-w-7xl rounded-3xl border border-white/20 bg-[#0D0D0D]/50 p-8">
        <NoDataState />
      </div>
    );
  }

  return (
    <div
      id="tour_engagement_comparison_graph"
      className="backdrop-blur-100 w-full max-w-7xl rounded-3xl border border-white/20 bg-[#0D0D0D]/50 p-8"
    >
      <h1 className="w-full text-center text-lg font-medium text-[#AFAFAF] 2xl:text-2xl">
        {engagementData?.title || 'Engagement Comparison Across Ad Formats'}
      </h1>

      <div className="flex w-full flex-col items-center justify-center gap-0 lg:mt-6 lg:flex-row lg:gap-0 xl:mt-0 2xl:mt-6">
        {/* Chart (left) */}
        <div className="w-[380px] flex-none scale-75 2xl:scale-100">
          <ResponsiveContainer width="100%" height={380}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={0}
                outerRadius={180}
                paddingAngle={0}
                stroke="#0D0D0D"
                strokeWidth={0}
              >
                {data?.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                    style={{ outline: 'none' }}
                    cursor="pointer"
                    onMouseEnter={(e) => {
                      e.target.style.transform = 'scale(1.025)';
                      e.target.style.transition = 'transform 0.3s ease';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'scale(1)';
                    }}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: '#0D0D0D80',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  padding: '10px 12px',
                }}
                itemStyle={{ color: '#ffffff' }}
                formatter={(value, name) => [`${value}`, name]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend (right, centered) */}
        <div className="flex w-40 items-center justify-center 2xl:w-52">
          <div className="flex flex-row flex-wrap gap-5 lg:flex-col 2xl:gap-8">
            {data?.map((item, idx) => (
              <div key={item?.name} className="flex items-center gap-2">
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full"
                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                />
                <span className="text-sm whitespace-nowrap text-[#AFAFAF] 2xl:text-base">
                  {item?.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdMarketAnalyticsTopPlateform;
