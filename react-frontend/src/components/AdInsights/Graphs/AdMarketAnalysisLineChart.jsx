import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

const AdMarketAnalysisLineChart = () => {
  const analyticsData = useSelector((state) => state.addie?.analyticsData);
  const isLoading = useSelector((state) => state.addie?.loading); // Assuming you have loading state

  // Exact colors from Figma
  const platformColors = {
    youtube: '#3AA0FF',
    google: '#A586FF',
    instagram: '#EFC6FD',
    facebook: '#D8E7FF',
    pinterest: '#FF6B6B',
  };

  // Check if data is available
  const hasData = analyticsData?.analyticsChart?.chartData?.length > 0;
  const isEmpty = !isLoading && !hasData;

  // Extract data from API response
  const statsArray = useMemo(() => {
    if (isEmpty) return Array(4).fill({ value: '0', label: 'No data available' });

    return [
      {
        value: analyticsData?.cards?.card1?.value || '0',
        label: analyticsData?.cards?.card1?.caption || 'Total number of ads',
      },
      {
        value: analyticsData?.cards?.card2?.value || '0',
        label: analyticsData?.cards?.card2?.caption || 'Total ads in the month of September',
      },
      {
        value: analyticsData?.cards?.card3?.value || '0',
        label: analyticsData?.cards?.card3?.caption || 'Most active season',
      },
      {
        value: analyticsData?.cards?.card4?.value || '0',
        label: analyticsData?.cards?.card4?.caption || 'Top performing network',
      },
    ];
  }, [analyticsData, isEmpty]);

  // Transform chart data from API
  const data = useMemo(() => {
    if (isEmpty) return [];

    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    const chartData = analyticsData?.analyticsChart?.chartData;
    if (!chartData || chartData?.length === 0) return [];

    return months?.map((month, index) => {
      const dataPoint = { month };

      chartData?.forEach((network) => {
        if (network?.data && network?.data[index] !== undefined) {
          dataPoint[network?.name?.toLowerCase()] = network?.data[index];
        }
      });

      return dataPoint;
    });
  }, [analyticsData, isEmpty]);

  const formatYAxis = (val) => {
    if (val === 0) return '0';
    if (val >= 1000) return `${val / 1000}M`;
    return `${val}k`;
  };

  // Shimmer Loading Component
  const ShimmerLoader = () => (
    <div className="animate-pulse">
      {/* Header Shimmer */}
      <div className="mb-6 flex items-start justify-between">
        <div className="mx-auto h-7 w-64 rounded bg-gray-700"></div>
      </div>

      <div className="flex w-full flex-col items-center justify-center gap-4 lg:flex-row">
        {/* Chart Container Shimmer */}
        <div className="backdrop-blur-100 rounded-10 w-full flex-1 overflow-hidden bg-[#1C1C1C]/50 p-3 lg:w-auto 2xl:p-4">
          {/* Legend Shimmer */}
          <div className="mb-3 flex flex-wrap items-center justify-center gap-4 py-5 2xl:gap-8">
            {Object.keys(platformColors)?.map((platform) => (
              <div key={platform} className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-gray-700"></div>
                <div className="h-4 w-16 rounded bg-gray-700"></div>
              </div>
            ))}
          </div>

          {/* Chart Area Shimmer */}
          <div className="relative h-[300px] rounded-lg bg-gray-800/50">
            {/* Grid Lines Shimmer */}
            <div className="absolute inset-0 flex flex-col justify-between">
              {[...Array(6)]?.map((_, i) => (
                <div key={i} className="h-px w-full bg-gray-700/50"></div>
              ))}
            </div>

            {/* Data Lines Shimmer */}
            <div className="absolute inset-0">
              {Object.keys(platformColors)?.map((_, index) => (
                <div
                  key={index}
                  className="absolute top-0 h-full w-full"
                  style={{
                    background: `bg-gray-700/50`,
                    animationDelay: `${index * 0.2}s`,
                  }}
                ></div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats Column Shimmer */}
        <div className="grid w-full grid-cols-2 gap-2 sm:gap-4 md:grid-cols-1 lg:w-auto lg:grid-rows-4">
          {[...Array(4)]?.map((_, i) => (
            <div
              key={i}
              className="rounded-10 flex flex-col items-center justify-center gap-2 bg-[#1C1C1C]/50 p-[18px] px-4 text-center 2xl:p-5 2xl:px-12"
            >
              <div className="h-7 w-16 rounded bg-gray-700"></div>
              <div className="h-4 w-24 rounded bg-gray-700"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // No Data Component
  const NoDataState = () => (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-gray-200 bg-gray-100">
        <div className="text-3xl">📈</div>
      </div>
      <h3 className="mb-2 text-xl font-medium text-[#AFAFAF]">No Data Available</h3>
      <p className="max-w-md text-center text-sm text-[#7E7E7E]">
        There's no analytics data to display at the moment. Please check back later or ensure your
        data sources are connected.
      </p>
    </div>
  );

  if (isLoading) {
    return (
      <div className="backdrop-blur-100 rounded-20 w-full border border-white/10 bg-[#0D0D0D]/50 p-4 2xl:p-6">
        <ShimmerLoader />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="backdrop-blur-100 rounded-20 h-[500px] w-full border border-white/20 bg-[#0D0D0D]/50 p-4 2xl:p-6">
        <NoDataState />
      </div>
    );
  }

  return (
    <div
      id="tour_overall_market_analysis_graph"
      className="backdrop-blur-100 rounded-20 w-full border border-white/20 bg-[#0D0D0D]/50 p-4 2xl:p-6"
    >
      {/* Header Section */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="w-full text-center text-lg font-medium text-[#AFAFAF] 2xl:text-2xl">
          {analyticsData?.title || 'Overall advertisement market analysis'}
        </h1>
      </div>

      <div className="flex w-full flex-col items-center justify-center gap-3 lg:flex-row 2xl:gap-4">
        {/* Chart Container */}
        <div className="backdrop-blur-100 rounded-10 w-full overflow-hidden bg-[#1C1C1C]/50 p-3 lg:w-auto 2xl:flex-1 2xl:p-4">
          {/* Custom Legend on top of chart */}
          <div className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 py-2 2xl:gap-x-8 2xl:gap-y-2 2xl:py-5">
            {Object.keys(platformColors)?.map((platform) => (
              <div key={platform} className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: platformColors[platform] }}
                />
                <span className="text-xs text-[#9CA3AF] capitalize 2xl:text-sm">{platform}</span>
              </div>
            ))}
          </div>
          <div className="h-full w-full focus:outline-none">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#2F2F2F" strokeDasharray="4 6" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#AFAFAF', fontSize: 12, fontFamily: 'Public Sans, sans-serif' }}
                  tickLine={false}
                  tickMargin={6}
                  axisLine={true}
                />
                <YAxis
                  domain={[0, 'dataMax + 100']}
                  tickFormatter={formatYAxis}
                  tick={{ fill: '#AFAFAF', fontSize: 12, fontFamily: 'Public Sans, sans-serif' }}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: '#111',
                    border: '1px solid #2A2A2A',
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: '#AFAFAF' }}
                  formatter={(value, name) => [
                    `${value}`,
                    name ? name?.charAt(0)?.toUpperCase() + name?.slice(1) : '',
                  ]}
                />
                {Object.keys(platformColors)?.map((platform) => (
                  <Line
                    key={platform}
                    type="linear"
                    dataKey={platform}
                    stroke={platformColors[platform]}
                    strokeWidth={2.5}
                    dot={false}
                    strokeLinejoin="miter"
                    strokeLinecap="butt"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Stats Column */}
        <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-1 lg:w-auto lg:grid-rows-4 xl:gap-3 2xl:gap-4">
          {statsArray?.map((stat, i) => (
            <div
              key={i}
              className="rounded-10 flex flex-col items-center justify-center gap-0.5 bg-[#1C1C1C]/50 p-[16px] px-4 text-center 2xl:px-12 2xl:py-[22px]"
            >
              <p className="text-base font-semibold text-white 2xl:text-xl">{stat?.value}</p>
              <p className="text-xs text-[#AFAFAF] 2xl:text-sm">{stat?.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdMarketAnalysisLineChart;
